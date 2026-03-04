import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatDateYYYYMMDD, formatInt } from '../format'
import { getLongestPersonStreak, getLongestStreak, getPeriod } from '../report'
import type { SlideCommonProps } from '../slideTypes'

export default function Slide15LongestStreak({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const streak = getLongestStreak(p)
  const personStreak = getLongestPersonStreak(report, period)

  return (
    <SlideFrame
      kicker="Consistency"
      title="Самая длинная серия"
      subtitle="Дни подряд с хотя бы 1 сообщением."
    >
      <div className="flex h-full flex-col justify-center">
        <motion.div
          // Гарантируем видимость контента при экспорте
          initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: exporting ? 0 : 0.06 }}
          className="rounded-[44px] border border-white/10 bg-white/5 p-10"
        >
          <div className="text-[13px] font-semibold uppercase tracking-[0.42em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
            Longest streak
          </div>

          <div className="mt-4 text-[100px] font-bold leading-none">
            <span className="tgwr-gradient-text">{streak ? formatInt(streak.days) : '—'}</span>
            <span className="ml-3 text-[52px] font-bold text-slate-100">дней</span>
          </div>

          <div className="mt-6 text-[18px] text-[rgba(var(--tgwr-muted-rgb),0.92)]">
            {streak ? `${formatDateYYYYMMDD(streak.start)} → ${formatDateYYYYMMDD(streak.end)}` : '—'}
          </div>

          {personStreak ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/50">
                Самый длинный стрик с человеком
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2">
                <div className="text-[22px] font-semibold text-white">{personStreak.displayName}</div>
                <div className="text-[22px] font-bold text-white">{formatInt(personStreak.lengthDays)} дней</div>
              </div>
              {personStreak.start && personStreak.end ? (
                <div className="mt-2 text-[12px] text-white/60">
                  {`${formatDateYYYYMMDD(personStreak.start)} → ${formatDateYYYYMMDD(personStreak.end)}`}
                </div>
              ) : null}
            </div>
          ) : null}

          {!streak && (
            <div className="mt-8 text-[13px] text-[rgba(var(--tgwr-muted-rgb),0.85)]">
              Нужны корректные timestamp’ы сообщений.
            </div>
          )}
        </motion.div>
      </div>
    </SlideFrame>
  )
}