import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatInt, formatPercent01 } from '../format'
import { getNightRatio, getPeriod, getTotalMessages } from '../report'
import type { SlideCommonProps } from '../slideTypes'

export default function Slide06NightRatio({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const night = getNightRatio(p)
  const total = getTotalMessages(p)

  return (
    <SlideFrame
      kicker="Late hours"
      title="Ночные сообщения"
      subtitle="00:00–05:59 по MSK."
    >
      <div className="flex h-full flex-col justify-center">
        <div className="grid grid-cols-2 gap-8">
          {/* Первая карточка: Процент */}
          <motion.div
            initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: exporting ? 0 : 0.06 }}
            className="rounded-[40px] border border-white/10 bg-white/5 p-9"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
              Night ratio
            </div>
            <div className="mt-4 text-[82px] font-bold leading-none">
              <span className="tgwr-gradient-text">{formatPercent01(night.ratio)}</span>
            </div>
            <div className="mt-4 text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.9)]">
              доля ночных сообщений
            </div>
          </motion.div>

          {/* Вторая карточка: Количество */}
          <motion.div
            initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: exporting ? 0 : 0.12 }}
            className="rounded-[40px] border border-white/10 bg-white/5 p-9"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
              Count
            </div>
            <div className="mt-4 text-[76px] font-bold leading-none text-slate-50">
              {formatInt(night.count)}
            </div>
            <div className="mt-4 text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.9)]">
              из {formatInt(total)} сообщений
            </div>
          </motion.div>
        </div>
      </div>
    </SlideFrame>
  )
}