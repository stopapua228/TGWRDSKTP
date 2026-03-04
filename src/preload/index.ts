import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

const IPC_WORKER_EVENT = 'tgwr:worker-event' as const
const IPC_WORKER_SEND = 'tgwr:worker-send' as const
const IPC_PICK_EXPORT_DIR = 'tgwr:pick-export-dir' as const
const IPC_LOAD_REPORT = 'tgwr:load-report' as const

export type WorkerEventPayload = unknown
export type WorkerEventCallback = (payload: WorkerEventPayload) => void

export type LoadReportResult =
  | {
      ok: true
      db_path: string
      report_path: string
      report: unknown
    }
  | {
      ok: false
      db_path: string
      report_path: string
      error: string
    }

export interface TgwrApi {
  onWorkerEvent: (cb: WorkerEventCallback) => () => void
  sendWorker: (cmdObj: Record<string, unknown>) => void
  pickExportDir: () => Promise<string | null>
  loadReport: (dbPath?: string) => Promise<LoadReportResult>
}

const api: TgwrApi = {
  onWorkerEvent: (cb: WorkerEventCallback) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      cb(payload)
    }

    ipcRenderer.on(IPC_WORKER_EVENT, listener)

    return () => {
      ipcRenderer.removeListener(IPC_WORKER_EVENT, listener)
    }
  },

  sendWorker: (cmdObj: Record<string, unknown>) => {
    ipcRenderer.send(IPC_WORKER_SEND, cmdObj)
  },

  pickExportDir: async (): Promise<string | null> => {
    const res: unknown = await ipcRenderer.invoke(IPC_PICK_EXPORT_DIR)
    return typeof res === 'string' && res.length > 0 ? res : null
  },

  loadReport: async (dbPath?: string): Promise<LoadReportResult> => {
    const payload = typeof dbPath === 'string' && dbPath.trim().length > 0 ? { db_path: dbPath } : {}
    const res: unknown = await ipcRenderer.invoke(IPC_LOAD_REPORT, payload)

    // We intentionally keep validation minimal; renderer handles missing fields defensively.
    if (typeof res === 'object' && res !== null) {
      const r = res as { ok?: unknown; db_path?: unknown; report_path?: unknown; report?: unknown; error?: unknown }
      const ok = r.ok === true
      const db_path = typeof r.db_path === 'string' ? r.db_path : ''
      const report_path = typeof r.report_path === 'string' ? r.report_path : ''
      if (ok) {
        return { ok: true, db_path, report_path, report: r.report }
      }
      const error = typeof r.error === 'string' ? r.error : 'Failed to load report'
      return { ok: false, db_path, report_path, error }
    }

    return {
      ok: false,
      db_path: '',
      report_path: '',
      error: 'Invalid IPC response'
    }
  }
}

contextBridge.exposeInMainWorld('tgwr', api)
