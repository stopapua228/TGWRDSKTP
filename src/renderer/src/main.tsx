import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import './styles.css'

declare global {
  interface Window {
    tgwr: {
      onWorkerEvent: (cb: (payload: unknown) => void) => () => void
      sendWorker: (cmdObj: Record<string, unknown>) => void

      pickExportDir: () => Promise<string | null>
      pickOutputDir: () => Promise<string | null>

      writeOutputFile: (
        dirPath: string,
        filename: string,
        bytes: Uint8Array
      ) => Promise<{ ok: true; path: string } | { ok: false; error?: string }>

      loadReport: (
        dbPath?: string
      ) => Promise<
        | { ok: true; db_path: string; report_path: string; report: unknown }
        | { ok: false; db_path?: string; report_path?: string; error?: string }
      >
    }
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)