import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { ellipsize, formatInt } from '../format'
import { getLongestMessage, getPeriod } from '../report'
import type { SlideCommonProps } from '../slideTypes'

export default function Slide14LongestMessage({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const m = getLongestMessage(p)

  return (
    <SlideFrame
      kicker="Text"
      title="Самое длинное сообщение"
      subtitle="Длиннее — не значит лучше, но это забавно."
    >
      <div className="flex h-full flex-col justify-center">
        <motion.div
          // Отключаем анимацию появления при экспорте
          initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: exporting ? 0 : 0.06 }}
          className="rounded-[44px] border border-white/10 bg-white/5 p-10"
        >
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-[20px] font-semibold text-slate-100">{m?.name ?? '—'}</div>
              <div className="mt-3 text-[13px] font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                Length
              </div>
              <div className="mt-2 text-[28px] font-bold text-slate-50">
                {m ? formatInt(m.length) : '—'} chars
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-semibold text-[rgba(var(--tgwr-muted-rgb),0.85)]">
              snippet
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-white/10 bg-black/20 p-7">
            {/* whitespace-pre-wrap и break-words важны для корректного переноса длинных слов при рендеринге в PNG */}
            <div className="whitespace-pre-wrap break-words text-[18px] leading-relaxed text-slate-100">
              {m?.snippet ? ellipsize(m.snippet, 420) : '—'}
            </div>
          </div>

          {!m && (
            <div className="mt-6 text-[13px] text-[rgba(var(--tgwr-muted-rgb),0.85)]">
              Нужны исходящие текстовые сообщения.
            </div>
          )}
        </motion.div>
      </div>
    </SlideFrame>
  )
}