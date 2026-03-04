import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatHour, formatInt } from '../format'
import { getMostActiveHour, getPeriod } from '../report'
import type { SlideCommonProps } from '../slideTypes'

// Добавляем exporting в пропсы
export default function Slide05MostActiveHour({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const h = getMostActiveHour(p)

  const value = h?.value ?? ''
  const count = h?.count ?? 0

  return (
    <SlideFrame kicker="Rhythm" title="Твой час силы" subtitle="В какое время ты активнее всего." >
      <div className="flex h-full flex-col justify-center">
        <div className="grid grid-cols-2 gap-8">
          {/* Первая карточка: Час */}
          <motion.div
            initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: exporting ? 0 : 0.06 }}
            className="rounded-[40px] border border-white/10 bg-white/5 p-9"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
              Top hour
            </div>
            <div className="mt-4 text-[76px] font-bold leading-none text-slate-50">{formatHour(value)}</div>
            <div className="mt-4 text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.9)]">по MSK</div>
          </motion.div>

          {/* Вторая карточка: Сообщения */}
          <motion.div
            initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: exporting ? 0 : 0.12 }}
            className="rounded-[40px] border border-white/10 bg-white/5 p-9"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
              Messages
            </div>
            <div className="mt-4 text-[76px] font-bold leading-none">
              <span className="tgwr-gradient-text">{formatInt(count)}</span>
            </div>
            <div className="mt-4 text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.9)]">в этом часу</div>
          </motion.div>
        </div>
      </div>
    </SlideFrame>
  )
}