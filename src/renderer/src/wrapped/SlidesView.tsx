import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import * as htmlToImage from 'html-to-image'
import { PDFDocument } from 'pdf-lib'

import { clamp } from './format'
import { asReport, getYearLabel, type PeriodKey } from './report'
import type { SlideDef, ThemeId } from './slideTypes'

import Slide01Cover from './slides/Slide01Cover'
import Slide02TotalMessages from './slides/Slide02TotalMessages'
import Slide03SentVsReceived from './slides/Slide03SentVsReceived'
import Slide04MostActiveMonth from './slides/Slide04MostActiveMonth'
import Slide05MostActiveHour from './slides/Slide05MostActiveHour'
import Slide06NightRatio from './slides/Slide06NightRatio'
import Slide07TopPersonMessages from './slides/Slide07TopPersonMessages'
import Slide08TopPersonMutuality from './slides/Slide08TopPersonMutuality'
import Slide09FastestReplyPerson from './slides/Slide09FastestReplyPerson'
import Slide10IgnoredMostPerson from './slides/Slide10IgnoredMostPerson'
import Slide11WordCloud from './slides/Slide11WordCloud'
import Slide12EmojiTop from './slides/Slide12EmojiTop'
import Slide13MediaCounts from './slides/Slide13MediaCounts'
import Slide14LongestMessage from './slides/Slide14LongestMessage'
import Slide15LongestStreak from './slides/Slide15LongestStreak'
import Slide16LongestSilence from './slides/Slide16LongestSilence'
import Slide17DayPerson from './slides/Slide17DayPerson'
import Slide18NightPerson from './slides/Slide18NightPerson'
import Slide19Achievements from './slides/Slide19Achievements'
import Slide20End from './slides/Slide20End'

const SLIDE_W = 1080
const SLIDE_H = 1920

const slides: SlideDef[] = [
  { id: 's1', title: 'Cover', Component: Slide01Cover },
  { id: 's2', title: 'Total Messages', Component: Slide02TotalMessages },
  { id: 's3', title: 'Sent vs Received', Component: Slide03SentVsReceived },
  { id: 's4', title: 'Most Active Month', Component: Slide04MostActiveMonth },
  { id: 's5', title: 'Most Active Hour', Component: Slide05MostActiveHour },
  { id: 's6', title: 'Night Ratio', Component: Slide06NightRatio },
  { id: 's7', title: 'Top Person (Messages)', Component: Slide07TopPersonMessages },
  { id: 's8', title: 'Top Person (Mutuality)', Component: Slide08TopPersonMutuality },
  { id: 's9', title: 'Fastest Reply', Component: Slide09FastestReplyPerson },
  { id: 's10', title: 'Most Ignored', Component: Slide10IgnoredMostPerson },
  { id: 's11', title: 'Word Cloud', Component: Slide11WordCloud },
  { id: 's12', title: 'Top Emojis', Component: Slide12EmojiTop },
  { id: 's13', title: 'Media Counts', Component: Slide13MediaCounts },
  { id: 's14', title: 'Longest Message', Component: Slide14LongestMessage },
  { id: 's15', title: 'Longest Streak', Component: Slide15LongestStreak },
  { id: 's16', title: 'Longest Silence', Component: Slide16LongestSilence },
  { id: 's17', title: 'Day Person', Component: Slide17DayPerson },
  { id: 's18', title: 'Night Person', Component: Slide18NightPerson },
  { id: 's19', title: 'Achievements', Component: Slide19Achievements },
  { id: 's20', title: 'Final Slide', Component: Slide20End }
]

type SlidesViewProps = {
  report: unknown
  period: PeriodKey
  onPeriodToggle: () => void
  onOpenDetails: () => void
  theme: ThemeId
  onThemeChange: (t: ThemeId) => void
}

type ExportKind = 'png' | 'pdf'
type ExportState = {
  running: boolean
  kind: ExportKind
  current: number
  total: number
  message: string
  error?: string
  outputDir?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const pad2 = (n: number) => String(n).padStart(2, '0')

async function capturePngBytes(node: HTMLElement): Promise<Uint8Array> {
  try { await document.fonts?.ready } catch { }
  const blob = await htmlToImage.toBlob(node, {
    cacheBust: true,
    backgroundColor: '#05070a',
    width: SLIDE_W,
    height: SLIDE_H,
    pixelRatio: 1,
    style: { transform: 'none' }
  })
  if (!blob) throw new Error('Failed to render slide')
  return new Uint8Array(await blob.arrayBuffer())
}

export default function SlidesView({
  report, period, onPeriodToggle, onOpenDetails, theme, onThemeChange
}: SlidesViewProps): JSX.Element {
  const parsed = useMemo(() => asReport(report), [report])
  const year = getYearLabel(report)
  const periodLabel = period === 'all_time' ? 'ALL' : year

  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [exportState, setExportState] = useState<ExportState | null>(null)
  const [exportSlideIndex, setExportSlideIndex] = useState<number | null>(null)
  const [scale, setScale] = useState(0.36)

  const stageRef = useRef<HTMLDivElement>(null)
  const exportStageRef = useRef<HTMLDivElement>(null)
  const lastWheelAtRef = useRef(0)

  const exporting = exportState?.running ?? false

  const go = useCallback((delta: number) => {
    if (exporting) return
    setIndex((prev) => clamp(prev + delta, 0, slides.length - 1))
    setDirection(delta >= 0 ? 1 : -1)
  }, [exporting])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (exporting) return
      const key = e.key
      if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(key)) {
        e.preventDefault(); go(1)
      } else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(key)) {
        e.preventDefault(); go(-1)
      } else if (key === 'Home') {
        e.preventDefault(); setIndex(0); setDirection(-1)
      } else if (key === 'End') {
        e.preventDefault(); setIndex(slides.length - 1); setDirection(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [go, exporting])

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (exporting) return
      const now = Date.now()
      if (now - lastWheelAtRef.current < 520) return
      if (Math.abs(e.deltaY) < 22) return
      lastWheelAtRef.current = now
      go(e.deltaY > 0 ? 1 : -1)
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => window.removeEventListener('wheel', onWheel)
  }, [go, exporting])

  useLayoutEffect(() => {
    const update = () => {
      const s = Math.min((window.innerWidth - 32) / SLIDE_W, (window.innerHeight - 32) / SLIDE_H)
      setScale(clamp(s, 0.28, 0.92))
    }
    update(); window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const writeOutputFile = useCallback(async (dirPath: string, filename: string, bytes: Uint8Array) => {
    const res = await window.tgwr.writeOutputFile(dirPath, filename, bytes)
    if (!res.ok) throw new Error(res.error ?? `Failed to write ${filename}`)
  }, [])

  const runExportTask = useCallback(async (kind: ExportKind) => {
    if (exporting) return
    const dir = await window.tgwr.pickOutputDir()
    if (!dir) return

    setExportState({ running: true, kind, current: 0, total: slides.length, message: 'Starting...', outputDir: dir })

    try {
      const pdf = kind === 'pdf' ? await PDFDocument.create() : null

      for (let i = 0; i < slides.length; i++) {
        setExportState(prev => prev ? { ...prev, current: i, message: `Rendering slide ${i+1}...` } : null)
        setExportSlideIndex(i)
        await nextFrame(); await nextFrame(); await sleep(520)

        const bytes = await capturePngBytes(exportStageRef.current!)

        if (pdf) {
          const img = await pdf.embedPng(bytes)
          pdf.addPage([SLIDE_W, SLIDE_H]).drawImage(img, { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H })
        } else {
          await writeOutputFile(dir, `slide_${pad2(i + 1)}.png`, bytes)
        }
      }

      if (pdf) {
        setExportState(prev => prev ? { ...prev, message: 'Saving PDF...' } : null)
        await writeOutputFile(dir, 'tgwr_wrapped.pdf', await pdf.save())
      }

      setExportState(prev => prev ? { ...prev, running: false, message: `Done! Check: ${dir}` } : null)
      setTimeout(() => setExportState(null), 3000)
    } catch (err: any) {
      setExportState(prev => prev ? { ...prev, running: false, error: err.message } : null)
    } finally {
      setExportSlideIndex(null)
    }
  }, [exporting, writeOutputFile])

  const ActiveSlide = slides[index].Component
  const ExportSlide = exportSlideIndex !== null ? slides[exportSlideIndex].Component : null

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#05070a]">
      {/* HUD */}
      <div className="pointer-events-none absolute left-6 top-6 z-20 flex w-[calc(100%-48px)] justify-between">
        <div className="flex gap-3">
          <div className="pointer-events-auto rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/70">
            {index + 1} / {slides.length}
          </div>
          <div className="pointer-events-auto rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/70">
            {periodLabel}
          </div>
        </div>
      </div>

      {/* Основная сцена */}
      <div className="flex h-full w-full items-center justify-center">
        <motion.div
          ref={stageRef}
          style={{ width: SLIDE_W, height: SLIDE_H, scale, transformOrigin: 'center' }}
          className="relative rounded-[48px] border border-white/10 bg-[#05070a] shadow-2xl"
        >
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={index}
              custom={direction}
              initial={{ opacity: 0, y: direction > 0 ? 100 : -100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: direction > 0 ? -100 : 100 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="h-full w-full"
            >
              <ActiveSlide {...{ report: parsed, period, onPeriodToggle, theme, onThemeChange }} />
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>

{/* Тулбар управления (Перенесли в ПРАВЫЙ ВЕРХНИЙ УГОЛ) */}
      {!exporting && (
        <div className="fixed top-6 right-6 z-[100] flex items-center gap-4 rounded-full border border-white/10 bg-black/80 px-6 py-3 shadow-2xl backdrop-blur-xl">

          {/* Стрелки навигации */}
          <div className="flex items-center gap-2">
            <button onClick={() => go(-1)} className="p-2 text-slate-400 transition hover:text-white">↑</button>
            <button onClick={() => go(1)} className="p-2 text-slate-400 transition hover:text-white">↓</button>
          </div>

          <div className="h-4 w-[1px] bg-white/20" />

          {/* Кнопка Детали */}
          <button
            type="button"
            onClick={onOpenDetails}
            className="flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-widest text-slate-300 transition hover:text-white"
          >
            Детали
          </button>

          <div className="h-4 w-[1px] bg-white/20" />

          {/* Выбор темы */}
          <div className="flex items-center gap-2">
            {(['neon', 'cyber', 'midnight'] as ThemeId[]).map((t) => (
              <button
                key={t}
                onClick={() => onThemeChange(t)}
                className={[
                  'px-3 py-1 text-[10px] font-bold uppercase tracking-tighter transition rounded-full',
                  theme === t ? 'bg-white/20 text-white' : 'text-slate-500 hover:text-slate-300'
                ].join(' ')}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="h-4 w-[1px] bg-white/20" />

          {/* Кнопки Экспорта */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => runExportTask('png')}
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-400 bg-cyan-500/10 rounded-full transition hover:bg-cyan-500/20"
            >
              PNG
            </button>
            <button
              onClick={() => runExportTask('pdf')}
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-purple-400 bg-purple-500/10 rounded-full transition hover:bg-purple-500/20"
            >
              PDF
            </button>
          </div>
        </div>
      )}

      {/* Скрытая сцена для экспорта */}
      {ExportSlide && (
        <div className="fixed left-[-2000px]" ref={exportStageRef}>
          <div style={{ width: SLIDE_W, height: SLIDE_H }} className="bg-[#05070a]">
            <ExportSlide {...{ report: parsed, period, onPeriodToggle, theme, onThemeChange, exporting: true }} />
          </div>
        </div>
      )}

      {/* Прогресс экспорта */}
      {exportState && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[200] bg-black/80 p-4 rounded-2xl border border-white/10 w-80 shadow-2xl backdrop-blur-md">
          <div className="text-xs font-bold tracking-widest text-white/50 mb-1">{exportState.kind.toUpperCase()} EXPORT</div>
          <div className="text-sm font-semibold text-white mb-3">{exportState.message}</div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-500 transition-all duration-300" style={{ width: `${(exportState.current/exportState.total)*100}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}