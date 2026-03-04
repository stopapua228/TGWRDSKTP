import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatSecondsHuman } from '../format'
import { getLongestSilence, getPeriod } from '../report'
import type { SlideCommonProps } from '../slideTypes'

export default function Slide16LongestSilence({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const s = getLongestSilence(p)

  return (
    <SlideFrame
      kicker="Gaps"
      title="Самая длинная пауза"
      subtitle="Максимальный разрыв между двумя сообщениями в одном чате."
    >
      <div className="flex h-full flex-col justify-center">
        <motion.div
          // Если идет экспорт — приземляем контент мгновенно
          initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          // Убираем задержку для скорости рендеринга
          transition={{ duration: 0.35, delay: exporting ? 0 : 0.06 }}
          className="rounded-[44px] border border-white/10 bg-white/5 p-10"
        >
          <div className="text-[22px] font-semibold text-slate-100">{s?.chatName ?? '—'}</div>

          <div className="mt-6 text-[96px] font-bold leading-none">
            <span className="tgwr-gradient-text">
              {s ? formatSecondsHuman(s.gapSeconds) : '—'}
            </span>
          </div>

          <div className="mt-4 text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.92)]">
            между сообщениями
          </div>

          {!s && (
            <div className="mt-8 text-[13px] text-[rgba(var(--tgwr-muted-rgb),0.85)]">
              Нужно минимум два сообщения в чате.
            </div>
          )}
        </motion.div>
      </div>
    </SlideFrame>
  )
}