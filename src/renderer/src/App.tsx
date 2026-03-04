import React, { useCallback, useEffect, useMemo, useState } from 'react'
import DetailsView from './wrapped/DetailsView'
import SlidesView from './wrapped/SlidesView'
import type { PeriodKey } from './wrapped/report'
import type { ThemeId } from './wrapped/slideTypes'
import { isRecord } from './wrapped/safe'

type WorkerStatus = {
  status: 'ok' | 'fail'
  message: string
  ts?: string
}

type ImportProgress = {
  stage: string
  current: number
  total: number
  message?: string
}

type ImportSummary = {
  chats: number
  messages: number
  db_path: string
  db_size_bytes: number
  json_chats?: number
  html_chats?: number
  skipped_chats?: number
  unknown_html_chats?: number
}

type ReportBuildState = {
  running: boolean
  progress?: ImportProgress
  error?: string
}

function loadThemeFromStorage(): ThemeId {
  const v = localStorage.getItem('tgwr_theme')
  if (v === 'neon' || v === 'cyber' || v === 'midnight') return v
  return 'neon'
}

function applyTheme(theme: ThemeId): void {
  const cls = document.body.classList
  cls.remove('theme-neon', 'theme-cyber', 'theme-midnight')
  cls.add(`theme-${theme}`)
}

function formatBytes(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  if (v < 1024) return `${v} B`
  const kb = v / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(2)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

function progressPct(p?: ImportProgress): number {
  if (!p) return 0
  if (p.total <= 0) return 0
  return Math.max(0, Math.min(100, (p.current / p.total) * 100))
}

function stageLabel(stage: string): string {
  switch (stage) {
    case 'scan_files':
      return 'Поиск файлов'
    case 'parse_chat':
      return 'Парсинг чатов'
    case 'insert_db':
      return 'Запись в базу'
    case 'index_db':
      return 'Индексация'
    case 'compute_metrics':
      return 'Сбор метрик'
    default:
      return String(stage || '')
  }
}

export default function App(): JSX.Element {
  const [theme, setTheme] = useState<ThemeId>(() => loadThemeFromStorage())
  const [period, setPeriod] = useState<PeriodKey>('year')
  const [view, setView] = useState<'setup' | 'slides' | 'details'>('setup')

  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>({
    status: 'fail',
    message: 'Worker not started'
  })
  const [lastPongAt, setLastPongAt] = useState<number>(0)
  const [workerError, setWorkerError] = useState<string | null>(null)

  const [exportDir, setExportDir] = useState<string>('')

  const [importRunning, setImportRunning] = useState<boolean>(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | undefined>(undefined)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const [reportBuild, setReportBuild] = useState<ReportBuildState>({ running: false })

  const [dbPath, setDbPath] = useState<string | null>(null)
  const [reportPath, setReportPath] = useState<string | null>(null)
  const [report, setReport] = useState<unknown | null>(null)

  const [lastEvent, setLastEvent] = useState<unknown | null>(null)

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem('tgwr_theme', theme)
  }, [theme])

  const togglePeriod = useCallback(() => {
    setPeriod((p) => (p === 'all_time' ? 'year' : 'all_time'))
  }, [])

const loadReport = useCallback(async (dbPathArg?: string, isStartup = false): Promise<boolean> => {
    try {
      console.log('[TGWR] Попытка загрузки отчета. Путь:', dbPathArg, '| Старт:', isStartup)
      const res = await window.tgwr.loadReport(dbPathArg)
      console.log('[TGWR] Ответ от бекенда:', res)

      if (!res || !res.ok) {
        if (!isStartup) {
          setReportBuild(prev => ({
            ...prev,
            running: false,
            error: `Ошибка бекенда: ${res?.error || 'отчет не найден'}`
          }))
        }
        return false
      }

      if (!res.report) {
        if (!isStartup) {
          setReportBuild(prev => ({
            ...prev,
            running: false,
            error: `Отчет загружен, но данные отсутствуют.`
          }))
        }
        return false
      }

      // Страховка: если бекенд отдал JSON строкой, парсим его
      let parsedReport = res.report
      if (typeof parsedReport === 'string') {
        try {
          parsedReport = JSON.parse(parsedReport)
        } catch (e) {
          if (!isStartup) {
            setReportBuild(prev => ({ ...prev, running: false, error: 'Ошибка парсинга JSON отчета.' }))
          }
          return false
        }
      }

      console.log('[TGWR] Отчет успешно распарсен, переключаем на слайды!', parsedReport)

      setDbPath(res.db_path)
      setReportPath(res.report_path)
      setReport(parsedReport) // Передаем именно объект!
      setView('slides')

      // Сбрасываем ошибку, если загрузилось
      setReportBuild(prev => ({ ...prev, running: false, error: undefined }))
      return true
    } catch (err) {
      console.error('[TGWR] Ошибка IPC:', err)
      if (!isStartup) {
        setReportBuild(prev => ({
          ...prev,
          running: false,
          error: `Критическая ошибка IPC: ${String(err)}`
        }))
      }
      return false
    }
  }, [])

// Try to load existing report.json on startup.
  useEffect(() => {
    void loadReport(undefined, true) // true = это запуск, прячем красную ошибку
  }, [loadReport])

  // Subscribe to worker events
  useEffect(() => {
    return window.tgwr.onWorkerEvent((payload) => {
      setLastEvent(payload)

      if (!isRecord(payload)) return
      const type = payload.type

      // PONG = worker alive (we use this for heartbeat)
      if (type === 'pong') {
        const ver = typeof payload.version === 'string' ? payload.version : ''
        setLastPongAt(Date.now())
        setWorkerError(null)
        setWorkerStatus({
          status: 'ok',
          message: `Connected (pong${ver ? ` v${ver}` : ''})`,
          ts: new Date().toISOString()
        })
        return
      }

      if (type === 'worker_status') {
        const status = payload.status === 'ok' ? 'ok' : 'fail'
        const message = typeof payload.message === 'string' ? payload.message : ''
        if (status === 'ok') {
          setWorkerError(null)
          setWorkerStatus({
            status,
            message: message || 'Connected',
            ts: typeof payload.ts === 'string' ? payload.ts : new Date().toISOString()
          })
        } else {
          setWorkerStatus({
            status,
            message: message || 'Disconnected',
            ts: typeof payload.ts === 'string' ? payload.ts : new Date().toISOString()
          })
        }
        return
      }

      if (type === 'progress') {
        const stage = typeof payload.stage === 'string' ? payload.stage : ''

        // Compatible progress:
        // - new: { current, total, message }
        // - legacy: { percent, current_chat, current_file }
        const percent = typeof payload.percent === 'number' ? payload.percent : undefined
        const current =
          typeof payload.current === 'number'
            ? payload.current
            : typeof percent === 'number'
              ? percent
              : 0
        const total = typeof payload.total === 'number' && payload.total > 0 ? payload.total : 100

        let message = typeof payload.message === 'string' ? payload.message : undefined
        if (!message) {
          const cc = typeof payload.current_chat === 'string' ? payload.current_chat : ''
          const cf = typeof payload.current_file === 'string' ? payload.current_file : ''
          const parts = [cc, cf].map((s) => s.trim()).filter(Boolean)
          if (parts.length) message = parts.join(' — ')
        }

        const p: ImportProgress = { stage, current, total, message }

        if (stage === 'scan_files' || stage === 'parse_chat' || stage === 'insert_db' || stage === 'index_db') {
          setImportProgress(p)
          return
        }
        if (stage === 'compute_metrics') {
          setReportBuild((prev) => ({ ...prev, progress: p }))
          return
        }
        return
      }

      if (type === 'import_done') {
        const summary: ImportSummary = {
          chats: typeof payload.chats === 'number' ? payload.chats : 0,
          messages: typeof payload.messages === 'number' ? payload.messages : 0,
          db_path: typeof payload.db_path === 'string' ? payload.db_path : '',
          db_size_bytes: typeof payload.db_size_bytes === 'number' ? payload.db_size_bytes : 0,
          json_chats: typeof payload.json_chats === 'number' ? payload.json_chats : undefined,
          html_chats: typeof payload.html_chats === 'number' ? payload.html_chats : undefined,
          skipped_chats: typeof payload.skipped_chats === 'number' ? payload.skipped_chats : undefined,
          unknown_html_chats: typeof payload.unknown_html_chats === 'number' ? payload.unknown_html_chats : undefined
        }

        setImportRunning(false)
        setImportProgress(undefined)
        setImportError(null)
        setImportSummary(summary)
        setDbPath(summary.db_path)
        return
      }

      if (type === 'report_done') {
        setReportBuild({ running: false })
        const rp = typeof payload.report_path === 'string' ? payload.report_path : null
        if (rp) setReportPath(rp)
        void loadReport(dbPath ?? undefined)
        return
      }

      if (type === 'report_error') {
        const msg = typeof payload.message === 'string' ? payload.message : 'Report error'
        setReportBuild({ running: false, error: msg })
        return
      }

      if (type === 'import_error') {
        const msg = typeof payload.message === 'string' ? payload.message : 'Import error'
        setImportRunning(false)
        setImportError(msg)
        return
      }
    })
  }, [dbPath, loadReport])

  // Auto-ping + watchdog
  useEffect(() => {
    const pingEveryMs = 5000
    const pongTimeoutMs = 12000

    const doPing = () => {
      try {
        window.tgwr.sendWorker({ cmd: 'ping' })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setWorkerError(`Ping failed: ${msg}`)
        setWorkerStatus({ status: 'fail', message: 'Ping failed', ts: new Date().toISOString() })
      }
    }

    doPing()

    const pingTimer = setInterval(doPing, pingEveryMs)
    const watchdog = setInterval(() => {
      if (!lastPongAt) return
      const delta = Date.now() - lastPongAt
      if (delta > pongTimeoutMs) {
        setWorkerError(`No pong for ${Math.round(delta / 1000)}s`)
        setWorkerStatus({
          status: 'fail',
          message: `No pong for ${Math.round(delta / 1000)}s`,
          ts: new Date().toISOString()
        })
      }
    }, 1000)

    return () => {
      clearInterval(pingTimer)
      clearInterval(watchdog)
    }
  }, [lastPongAt])

  const canImport = workerStatus.status === 'ok' && exportDir.trim().length > 0 && !importRunning

  const onPickExportDir = useCallback(async () => {
    const dir = await window.tgwr.pickExportDir()
    if (!dir) return
    setExportDir(dir)
  }, [])

  const onStartImport = useCallback(() => {
    const dir = exportDir.trim()
    if (!dir) return

    setImportRunning(true)
    setImportProgress({ stage: 'scan_files', current: 0, total: 1 })
    setImportError(null)
    setImportSummary(null)
    setReport(null)
    setReportPath(null)

    window.tgwr.sendWorker({
      cmd: 'import_export',
      mode: 'desktop',
      export_dir: dir
    })
  }, [exportDir])

  const canBuildReport = !!dbPath && !reportBuild.running

  const onBuildReport = useCallback(() => {
    if (!dbPath) return
    setReportBuild({ running: true, progress: { stage: 'compute_metrics', current: 0, total: 1 } })
    window.tgwr.sendWorker({ cmd: 'build_report', db_path: dbPath })
  }, [dbPath, reportBuild.running])

  const mainContent = useMemo(() => {
    if (report && view === 'slides') {
      return (
        <SlidesView
          report={report}
          period={period}
          onPeriodToggle={togglePeriod}
          onOpenDetails={() => setView('details')}
          theme={theme}
          onThemeChange={setTheme}
        />
      )
    }

    if (report && view === 'details') {
      return (
        <DetailsView report={report} period={period} onPeriodToggle={togglePeriod} onClose={() => setView('slides')} />
      )
    }

    return (
      <div className="flex h-full w-full items-center justify-center px-6 py-10">
        <div className="w-full max-w-[920px] rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_40px_140px_rgba(0,0,0,0.65)]">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.42em] text-[rgba(var(--tgwr-muted-rgb),0.85)]">
                TGWR setup
              </div>
              <div className="mt-2 text-[32px] font-bold text-slate-100">Импорт → отчёт → wrapped</div>
              <div className="mt-2 text-[14px] text-[rgba(var(--tgwr-muted-rgb),0.9)]">
                Когда report.json готов — стартуем со слайдов.
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.34em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                worker
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-100">
                {workerStatus.status === 'ok' ? 'ONLINE' : 'OFFLINE'}
              </div>
              <div className="mt-1 max-w-[280px] text-xs text-[rgba(var(--tgwr-muted-rgb),0.85)]">
                {workerStatus.message}
              </div>
              {workerError ? (
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-100">
                  {workerError}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-8 grid gap-6">
            <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-[16px] font-semibold text-slate-100">1) Импорт Telegram Export</div>
                  <div className="mt-1 text-[13px] text-[rgba(var(--tgwr-muted-rgb),0.9)]">
                    Выбери папку экспорта Telegram Desktop.
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onPickExportDir}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                  >
                    Выбрать папку
                  </button>
                  <button
                    type="button"
                    disabled={!canImport}
                    onClick={onStartImport}
                    className={[
                      'rounded-full border px-4 py-2 text-sm font-semibold transition',
                      canImport
                        ? 'border-[rgba(var(--tgwr-accent1-rgb),0.35)] bg-[rgba(var(--tgwr-accent1-rgb),0.10)] text-slate-50 hover:bg-[rgba(var(--tgwr-accent1-rgb),0.16)]'
                        : 'border-white/10 bg-white/5 text-[rgba(var(--tgwr-muted-rgb),0.7)]'
                    ].join(' ')}
                  >
                    Импортировать
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.34em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                  export dir
                </div>
                <div className="mt-2 break-all font-mono text-xs text-slate-100/90">{exportDir || '—'}</div>
              </div>

              {importRunning ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-[rgba(var(--tgwr-muted-rgb),0.85)]">
                    <span>{importProgress ? stageLabel(importProgress.stage) : '…'}</span>
                    <span>{Math.round(progressPct(importProgress))}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full border border-white/10 bg-white/5">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,rgba(var(--tgwr-accent1-rgb),0.75),rgba(var(--tgwr-accent2-rgb),0.65))]"
                      style={{ width: `${progressPct(importProgress)}%` }}
                    />
                  </div>
                  {importProgress?.message ? (
                    <div className="mt-2 text-xs text-[rgba(var(--tgwr-muted-rgb),0.85)]">{importProgress.message}</div>
                  ) : null}
                </div>
              ) : null}

              {importError ? (
                <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
                  {importError}
                </div>
              ) : null}

              {importSummary ? (
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.34em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                      Chats
                    </div>
                    <div className="mt-1 text-xl font-bold text-slate-100">{importSummary.chats}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.34em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                      Messages
                    </div>
                    <div className="mt-1 text-xl font-bold text-slate-100">{importSummary.messages}</div>
                  </div>
                  <div className="col-span-2 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.34em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                      DB path
                    </div>
                    <div className="mt-2 break-all font-mono text-xs text-slate-100/90">{importSummary.db_path}</div>
                    <div className="mt-2 text-xs text-[rgba(var(--tgwr-muted-rgb),0.85)]">
                      size: {formatBytes(importSummary.db_size_bytes)}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-[16px] font-semibold text-slate-100">2) Отчёт (report.json)</div>
                  <div className="mt-1 text-[13px] text-[rgba(var(--tgwr-muted-rgb),0.9)]">
                    Генерация метрик и данных для 20 слайдов.
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={!canBuildReport}
                    onClick={onBuildReport}
                    className={[
                      'rounded-full border px-4 py-2 text-sm font-semibold transition',
                      canBuildReport
                        ? 'border-[rgba(var(--tgwr-accent2-rgb),0.35)] bg-[rgba(var(--tgwr-accent2-rgb),0.10)] text-slate-50 hover:bg-[rgba(var(--tgwr-accent2-rgb),0.16)]'
                        : 'border-white/10 bg-white/5 text-[rgba(var(--tgwr-muted-rgb),0.7)]'
                    ].join(' ')}
                  >
                    Сгенерировать отчёт
                  </button>
                </div>
              </div>

              {reportBuild.running ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-[rgba(var(--tgwr-muted-rgb),0.85)]">
                    <span>{stageLabel(reportBuild.progress?.stage ?? 'compute_metrics')}</span>
                    <span>{Math.round(progressPct(reportBuild.progress))}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full border border-white/10 bg-white/5">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,rgba(var(--tgwr-accent2-rgb),0.70),rgba(var(--tgwr-accent1-rgb),0.60))]"
                      style={{ width: `${progressPct(reportBuild.progress)}%` }}
                    />
                  </div>
                  {reportBuild.progress?.message ? (
                    <div className="mt-2 text-xs text-[rgba(var(--tgwr-muted-rgb),0.85)]">{reportBuild.progress.message}</div>
                  ) : null}
                </div>
              ) : null}

              {reportBuild.error ? (
                <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
                  {reportBuild.error}
                </div>
              ) : null}

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.34em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                  report path
                </div>
                <div className="mt-2 break-all font-mono text-xs text-slate-100/90">{reportPath || '—'}</div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                <div className="text-xs text-[rgba(var(--tgwr-muted-rgb),0.85)]">
                  Если report уже существует — TGWR попробует открыть его при запуске.
                </div>
                <button
                  type="button"
                  onClick={() => void loadReport(dbPath ?? undefined)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Открыть wrapped
                </button>
              </div>
            </div>

            <details className="rounded-[28px] border border-white/10 bg-white/5 p-6">
              <summary className="cursor-pointer select-none text-sm font-semibold text-slate-100">Last event (debug)</summary>
              <pre className="mt-4 max-h-[220px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-slate-100/90">
                {JSON.stringify(lastEvent, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      </div>
    )
  }, [
    canBuildReport,
    canImport,
    dbPath,
    exportDir,
    importError,
    importProgress,
    importRunning,
    importSummary,
    lastEvent,
    loadReport,
    onBuildReport,
    onPickExportDir,
    onStartImport,
    period,
    report,
    reportBuild.error,
    reportBuild.progress,
    reportBuild.running,
    reportPath,
    theme,
    togglePeriod,
    view,
    workerError,
    workerStatus.message,
    workerStatus.status
  ])

  return <div className="h-screen w-screen">{mainContent}</div>
}