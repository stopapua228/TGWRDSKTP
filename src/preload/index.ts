import { contextBridge, ipcRenderer } from 'electron'

const IPC_WORKER_EVENT = 'tgwr:worker-event' as const
const IPC_WORKER_SEND = 'tgwr:worker-send' as const
const IPC_PICK_EXPORT_DIR = 'tgwr:pick-export-dir' as const
const IPC_PICK_OUTPUT_DIR = 'tgwr:pick-output-dir' as const
const IPC_WRITE_OUTPUT_FILE = 'tgwr:write-output-file' as const
const IPC_LOAD_REPORT = 'tgwr:load-report' as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type LoadReportResult =
  | {
      ok: true
      db_path: string
      report_path: string
      report: unknown
    }
  | {
      ok: false
      db_path?: string
      report_path?: string
      error?: string
    }

export type WriteOutputFileResult =
  | {
      ok: true
      path: string
    }
  | {
      ok: false
      error?: string
    }

export interface TgwrApi {
  onWorkerEvent: (cb: (payload: unknown) => void) => () => void
  sendWorker: (cmdObj: Record<string, unknown>) => void

  pickExportDir: () => Promise<string | null>
  pickOutputDir: () => Promise<string | null>

  writeOutputFile: (dirPath: string, filename: string, bytes: Uint8Array) => Promise<WriteOutputFileResult>

  loadReport: (dbPath?: string) => Promise<LoadReportResult>
}

const api: TgwrApi = {
  onWorkerEvent: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(IPC_WORKER_EVENT, listener)
    return () => ipcRenderer.removeListener(IPC_WORKER_EVENT, listener)
  },

  sendWorker: (cmdObj) => {
    ipcRenderer.send(IPC_WORKER_SEND, cmdObj)
  },

  pickExportDir: async () => {
    const res = await ipcRenderer.invoke(IPC_PICK_EXPORT_DIR)
    return typeof res === 'string' ? res : null
  },

  pickOutputDir: async () => {
    const res = await ipcRenderer.invoke(IPC_PICK_OUTPUT_DIR)
    return typeof res === 'string' ? res : null
  },

  writeOutputFile: async (dirPath, filename, bytes) => {
    const res = await ipcRenderer.invoke(IPC_WRITE_OUTPUT_FILE, {
      dir_path: dirPath,
      filename,
      bytes
    })

    if (isPlainObject(res) && typeof res.ok === 'boolean') {
      if (res.ok) {
        return {
          ok: true,
          path: typeof res.path === 'string' ? res.path : ''
        }
      }

      return {
        ok: false,
        error: typeof res.error === 'string' ? res.error : 'Unknown error'
      }
    }

    return { ok: false, error: 'Invalid response from main process' }
  },

  loadReport: async (dbPath?: string) => {
    const res = await ipcRenderer.invoke(IPC_LOAD_REPORT, {
      db_path: dbPath
    })
    if (isPlainObject(res) && typeof res.ok === 'boolean') {
      return res as LoadReportResult
    }
    return { ok: false, error: 'Invalid response from main process' }
  }
}

contextBridge.exposeInMainWorld('tgwr', api)