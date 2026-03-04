import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, constants as fsConstants, promises as fsp } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const IPC_WORKER_EVENT = 'tgwr:worker-event' as const
const IPC_WORKER_SEND = 'tgwr:worker-send' as const
const IPC_PICK_EXPORT_DIR = 'tgwr:pick-export-dir' as const
const IPC_PICK_OUTPUT_DIR = 'tgwr:pick-output-dir' as const
const IPC_WRITE_OUTPUT_FILE = 'tgwr:write-output-file' as const
const IPC_LOAD_REPORT = 'tgwr:load-report' as const

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
interface JsonObject {
  [key: string]: JsonValue
}

interface WorkerStatusEvent {
  type: 'worker_status'
  status: 'ok' | 'fail'
  message: string
  ts: string
}

interface WorkerHostEvent {
  type: 'worker_host_event'
  level: 'info' | 'error'
  message: string
  ts: string
  details?: JsonObject
}

let mainWindow: BrowserWindow | null = null

let workerProc: ChildProcessWithoutNullStreams | null = null
let workerStdoutBuffer = ''
let workerCommandUsed: string | null = null

let pendingEvents: unknown[] = []
let lastKnownStatus: WorkerStatusEvent = {
  type: 'worker_status',
  status: 'fail',
  message: 'Worker not started',
  ts: new Date().toISOString()
}

function nowIso(): string {
  return new Date().toISOString()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canSendToRenderer(): boolean {
  if (!mainWindow) return false
  if (mainWindow.isDestroyed()) return false
  const wc = mainWindow.webContents
  if (wc.isDestroyed()) return false
  return wc.getURL().length > 0 && !wc.isLoading()
}

function emitToRenderer(payload: unknown): void {
  if (canSendToRenderer() && mainWindow) {
    mainWindow.webContents.send(IPC_WORKER_EVENT, payload)
    return
  }
  pendingEvents.push(payload)
}

function flushPendingEvents(): void {
  if (!canSendToRenderer() || !mainWindow) return
  const wc = mainWindow.webContents
  const toFlush = pendingEvents
  pendingEvents = []
  for (const ev of toFlush) {
    wc.send(IPC_WORKER_EVENT, ev)
  }
}

function emitStatus(status: 'ok' | 'fail', message: string): void {
  const ev: WorkerStatusEvent = { type: 'worker_status', status, message, ts: nowIso() }
  lastKnownStatus = ev
  emitToRenderer(ev)
}

function emitHost(level: 'info' | 'error', message: string, details?: JsonObject): void {
  const ev: WorkerHostEvent = {
    type: 'worker_host_event',
    level,
    message,
    ts: nowIso(),
    ...(details ? { details } : {})
  }
  emitToRenderer(ev)
}

function sendToWorker(cmdObj: unknown): void {
  if (!workerProc || workerProc.stdin.destroyed) {
    emitStatus('fail', 'Worker not running')
    emitToRenderer({
      type: 'worker_send_fail',
      message: 'Worker not running',
      ts: nowIso(),
      cmd: isPlainObject(cmdObj) ? cmdObj : { valueType: typeof cmdObj }
    })
    return
  }

  let line: string
  try {
    line = JSON.stringify(cmdObj)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emitToRenderer({
      type: 'worker_send_fail',
      message: 'Failed to serialize command',
      ts: nowIso(),
      error: msg
    })
    return
  }

  try {
    workerProc.stdin.write(`${line}\n`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emitStatus('fail', `Failed to write to worker stdin: ${msg}`)
  }
}

function handleWorkerStdoutChunk(text: string): void {
  workerStdoutBuffer += text

  while (true) {
    const nl = workerStdoutBuffer.indexOf('\n')
    if (nl === -1) break

    const rawLine = workerStdoutBuffer.slice(0, nl)
    workerStdoutBuffer = workerStdoutBuffer.slice(nl + 1)

    const line = rawLine.trim().replace(/\r$/, '')
    if (!line) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitToRenderer({
        type: 'worker_parse_error',
        message: msg,
        ts: nowIso(),
        line
      })
      continue
    }

    emitToRenderer(parsed)
  }
}

function attachWorker(proc: ChildProcessWithoutNullStreams): void {
  workerStdoutBuffer = ''

  proc.stdout.on('data', (chunk: Buffer) => {
    handleWorkerStdoutChunk(chunk.toString('utf8'))
  })

  proc.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    const lines = text.split(/\r?\n/)
    for (const ln of lines) {
      const t = ln.trim()
      if (!t) continue
      emitToRenderer({
        type: 'worker_stderr',
        ts: nowIso(),
        text: t
      })
    }
  })

  proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    workerProc = null
    workerCommandUsed = null
    emitStatus('fail', `Worker exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
  })

  proc.on('error', (err: Error) => {
    emitStatus('fail', `Worker process error: ${err.message}`)
  })
}

function startWorker(): void {
  if (workerProc) return

  const scriptPath = join(process.cwd(), 'worker', 'tgwr_worker.py')
  const mkArgs = (cmd: string): string[] => {
    if (process.platform === 'win32' && cmd === 'py') return ['-3', '-u', scriptPath]
    return ['-u', scriptPath]
  }

  const candidates: string[] = process.platform === 'win32' ? ['py', 'python'] : ['python', 'python3']

  const tried: string[] = []

  const trySpawn = (idx: number): void => {
    if (idx >= candidates.length) {
      emitStatus(
        'fail',
        `Python not found (tried: ${tried.join(', ')}). Install Python 3 and ensure it is on PATH.`
      )
      return
    }

    const cmd = candidates[idx]
    tried.push(cmd)

    const proc = spawn(cmd, mkArgs(cmd), {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    const onError = (err: Error & { code?: string }) => {
      if (err.code === 'ENOENT') {
        proc.removeAllListeners()
        trySpawn(idx + 1)
        return
      }

      emitStatus('fail', `Failed to start worker via "${cmd}": ${err.message}`)
      emitHost('error', 'Worker spawn error', {
        cmd,
        message: err.message
      })
    }

    proc.once('error', onError)

    proc.once('spawn', () => {
      proc.removeListener('error', onError)

      workerProc = proc
      workerCommandUsed = cmd

      attachWorker(proc)

      emitStatus('ok', `Worker started (${cmd})`)
      emitHost('info', 'Worker connected', {
        cmd: workerCommandUsed ?? cmd,
        scriptPath
      })

      // Kick off a ping to detect the worker quickly in the UI.
      sendToWorker({ cmd: 'ping' })
    })
  }

  emitHost('info', 'Starting worker…', { script: scriptPath })
  trySpawn(0)
}

function createWindow(): void {
  const preloadCandidates = [
    join(process.cwd(), 'dist', 'preload', 'index.mjs'),
    join(process.cwd(), 'dist', 'preload', 'index.js'),
    join(__dirname, '../preload/index.mjs'),
    join(__dirname, '../preload/index.js')
  ]

  const preloadPath = preloadCandidates.find((p) => existsSync(p))

  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    show: true,
    backgroundColor: '#05070a',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.setMenuBarVisibility(false)
  mainWindow = win

  win.webContents.on('did-finish-load', () => {
    flushPendingEvents()
    emitToRenderer(lastKnownStatus)
  })

  const devUrl =
    (typeof process.env.VITE_DEV_SERVER_URL === 'string' && process.env.VITE_DEV_SERVER_URL.length > 0
      ? process.env.VITE_DEV_SERVER_URL
      : undefined) ??
    (typeof process.env.ELECTRON_RENDERER_URL === 'string' && process.env.ELECTRON_RENDERER_URL.length > 0
      ? process.env.ELECTRON_RENDERER_URL
      : undefined)

  if (!app.isPackaged && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })
}

async function isDirWritable(dirPath: string): Promise<boolean> {
  try {
    await fsp.access(dirPath, fsConstants.W_OK)
    const probe = join(dirPath, `.tgwr_write_probe_${process.pid}_${Date.now()}`)
    await fsp.writeFile(probe, 'x', { encoding: 'utf8' })
    await fsp.unlink(probe)
    return true
  } catch {
    return false
  }
}

async function computeDbPath(): Promise<{ db_path: string; location: 'exe' | 'userData' }> {
  // In dev, process.execPath points to Electron inside node_modules, and writing the DB next to it is confusing.
  // Keep everything in userData during development; when packaged we can optionally prefer the exe dir.
  if (!app.isPackaged) {
    const userDataDir = app.getPath('userData')
    return { db_path: join(userDataDir, 'tgwr.db'), location: 'userData' }
  }

  const exeDir = dirname(process.execPath)
  const candidate = join(exeDir, 'tgwr.db')

  if (await isDirWritable(exeDir)) {
    return { db_path: candidate, location: 'exe' }
  }

  const userDataDir = app.getPath('userData')
  return { db_path: join(userDataDir, 'tgwr.db'), location: 'userData' }
}

function isSafeFilename(name: string): boolean {
  if (name.trim().length === 0) return false
  if (name.includes('..')) return false
  if (name.includes('/') || name.includes('\\')) return false
  return true
}

ipcMain.handle(IPC_PICK_EXPORT_DIR, async () => {
  const parent = mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined
  const res = await dialog.showOpenDialog(parent, {
    title: 'Select Telegram Desktop Export folder',
    properties: ['openDirectory', 'dontAddToRecent'],
    buttonLabel: 'Select folder'
  })
  if (res.canceled) return null
  return res.filePaths[0] ?? null
})

ipcMain.handle(IPC_PICK_OUTPUT_DIR, async () => {
  const parent = mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined
  const res = await dialog.showOpenDialog(parent, {
    title: 'Select folder to export TGWR slides',
    properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    buttonLabel: 'Select folder'
  })
  if (res.canceled) return null
  return res.filePaths[0] ?? null
})

ipcMain.handle(IPC_WRITE_OUTPUT_FILE, async (_event, payload: unknown) => {
  try {
    if (!isPlainObject(payload)) {
      return { ok: false, error: 'Invalid payload (expected object)' }
    }

    const dirPath = typeof payload.dir_path === 'string' ? payload.dir_path : ''
    const filename = typeof payload.filename === 'string' ? payload.filename : ''
    const bytesAny = payload.bytes as unknown

    if (dirPath.trim().length === 0) return { ok: false, error: 'dir_path is required' }
    if (!isSafeFilename(filename)) return { ok: false, error: 'Unsafe filename' }

    // Normalize bytes
    let bytes: Uint8Array
    if (bytesAny instanceof Uint8Array) {
      bytes = bytesAny
    } else if (bytesAny instanceof ArrayBuffer) {
      bytes = new Uint8Array(bytesAny)
    } else if (ArrayBuffer.isView(bytesAny)) {
      bytes = new Uint8Array(bytesAny.buffer, bytesAny.byteOffset, bytesAny.byteLength)
    } else {
      return { ok: false, error: 'bytes must be Uint8Array/ArrayBuffer' }
    }

    await fsp.mkdir(dirPath, { recursive: true })
    const outPath = join(dirPath, filename)
    await fsp.writeFile(outPath, Buffer.from(bytes))
    return { ok: true, path: outPath }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
})

ipcMain.handle(IPC_LOAD_REPORT, async (_event, args: unknown) => {
  try {
    // 1. Страховка аргументов: фронтенд может передать строку или объект
    let providedDbPath: string | null = null
    if (typeof args === 'string') {
      providedDbPath = args
    } else if (isPlainObject(args) && typeof args.db_path === 'string') {
      providedDbPath = args.db_path
    }

    let db_path: string
    if (providedDbPath && providedDbPath.trim().length > 0) {
      db_path = providedDbPath
    } else {
      const computed = await computeDbPath()
      db_path = computed.db_path
    }

    // 2. ГЛАВНОЕ ИСПРАВЛЕНИЕ: Ищем именно 'report.json' в папке с базой данных, как это делает Python
    const report_path = join(dirname(db_path), 'report.json')

    if (!existsSync(report_path)) {
      return { ok: false, db_path, report_path, error: `report.json not found at: ${report_path}` }
    }

    // 3. Читаем и отдаем
    const txt = await fsp.readFile(report_path, { encoding: 'utf8' })
    const report = JSON.parse(txt) as unknown
    return { ok: true, db_path, report_path, report }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
})

async function forwardImportExport(cmdObj: Record<string, unknown>): Promise<void> {
  const exportDir = cmdObj.export_dir
  const mode = cmdObj.mode

  if (typeof exportDir !== 'string' || exportDir.trim().length === 0) {
    emitToRenderer({
      type: 'ipc_invalid_cmd',
      ts: nowIso(),
      message: 'import_export requires export_dir: string'
    })
    return
  }
  if (typeof mode !== 'string' || mode.trim().length === 0) {
    emitToRenderer({
      type: 'ipc_invalid_cmd',
      ts: nowIso(),
      message: 'import_export requires mode: string'
    })
    return
  }

  const { db_path, location } = await computeDbPath()
  emitHost('info', 'DB path selected', { db_path, location, export_dir: exportDir, mode })

  const forwarded: Record<string, unknown> = { ...cmdObj, db_path }
  sendToWorker(forwarded)
}

ipcMain.on(IPC_WORKER_SEND, (_event, cmdObj: unknown) => {
  if (!isPlainObject(cmdObj)) {
    emitToRenderer({
      type: 'ipc_invalid_cmd',
      ts: nowIso(),
      message: 'Expected an object command payload',
      receivedType: Array.isArray(cmdObj) ? 'array' : typeof cmdObj
    })
    return
  }

  const cmd = cmdObj.cmd
  if (cmd === 'import_export') {
    void forwardImportExport(cmdObj)
    return
  }

  sendToWorker(cmdObj)
})

app.on('before-quit', () => {
  if (workerProc && !workerProc.killed) {
    try {
      workerProc.kill()
    } catch {
      // no-op
    }
  }
})

app.whenReady().then(() => {
  createWindow()
  startWorker()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      startWorker()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})