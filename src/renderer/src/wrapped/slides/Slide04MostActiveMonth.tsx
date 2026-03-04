import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatInt, formatMonth } from '../format'
import { getMostActiveMonth, getPeriod } from '../report'
import type { SlideCommonProps } from '../slideTypes'

export default function Slide04MostActiveMonth({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const m = getMostActiveMonth(p)

  const value = m?.value ?? ''
  const count = m?.count ?? 0

  return (
    <SlideFrame
      kicker="Peak"
      title="Самый активный месяц"
      subtitle="Когда Telegram был на максималках."
    >
      <div className="flex h-full flex-col justify-center">
        <motion.div
          // Если идет экспорт — отключаем анимацию появления
          initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          // Убираем задержку, чтобы рендерер сразу видел результат
          transition={{ duration: 0.35, delay: exporting ? 0 : 0.08 }}
          className="rounded-[40px] border border-white/10 bg-white/5 p-10"
        >
          <div className="text-[20px] font-semibold text-slate-100">
            {formatMonth(value)}
          </div>

          <div className="mt-4 text-[84px] font-bold leading-none">
            <span className="tgwr-gradient-text">{formatInt(count)}</span>
          </div>

          <div className="mt-4 text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.92)]">
            сообщений в этом месяце
          </div>
        </motion.div>
      </div>
    </SlideFrame>
  )
}