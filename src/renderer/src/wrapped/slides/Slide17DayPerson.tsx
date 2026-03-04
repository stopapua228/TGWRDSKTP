import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatInt } from '../format'
import { getDayNightPerson, getPeriod } from '../report'
import type { SlideCommonProps } from '../slideTypes'

export default function Slide17DayPerson({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const person = getDayNightPerson(p, 'day_person')

  return (
    <SlideFrame
      kicker="Day"
      title="Дневной человек"
      subtitle="С кем чаще всего переписываешься днём (06:00–17:59)."
    >
      <div className="flex h-full flex-col justify-center">
        <motion.div
          // Магия для экспорта: убираем начальное смещение и прозрачность
          initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          // Убираем задержку, чтобы рендерер не ждал вхолостую
          transition={{ duration: 0.35, delay: exporting ? 0 : 0.06 }}
          className="rounded-[44px] border border-white/10 bg-white/5 p-10"
        >
          <div className="text-[22px] font-semibold text-slate-100">{person?.name ?? '—'}</div>

          <div className="mt-6 text-[92px] font-bold leading-none">
            <span className="tgwr-gradient-text">
              {person ? formatInt(person.messages) : '—'}
            </span>
          </div>

          <div className="mt-4 text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.92)]">
            сообщений в дневной зоне
          </div>

          {!person && (
            <div className="mt-8 text-[13px] text-[rgba(var(--tgwr-muted-rgb),0.85)]">
              Пока не определено.
            </div>
          )}
        </motion.div>
      </div>
    </SlideFrame>
  )
}