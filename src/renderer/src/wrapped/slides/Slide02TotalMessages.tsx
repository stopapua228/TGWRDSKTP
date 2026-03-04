import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatInt } from '../format'
import { getPeriod, getTotalMessages, getYearLabel } from '../report'
import type { SlideCommonProps } from '../slideTypes'

export default function Slide02TotalMessages({
  report,
  period,
  onPeriodToggle,
  exporting
}: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const total = getTotalMessages(p)
  const year = getYearLabel(report)

  const periodLabel = period === 'all_time' ? 'All-time' : year

  return (
    <SlideFrame
      kicker="Activity"
      title="Сколько сообщений"
      subtitle="Один факт — один слайд. Переключай период и смотри как меняется картина."
      footerHint={exporting ? undefined : "Toggle влияет на все слайды."}
    >
      <div className="flex h-full flex-col justify-between">
        <div>
          {/* Переключатель периодов: теперь снова КНОПКИ и без выделения текста */}
          <div className="inline-flex select-none items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              // Возвращаем клик только если мы не в режиме экспорта
              onClick={period === 'all_time' || exporting ? undefined : onPeriodToggle}
              className={[
                'rounded-full px-4 py-2 text-sm font-semibold transition',
                period === 'all_time'
                  ? 'bg-white/10 text-slate-50 cursor-default'
                  : 'text-[rgba(var(--tgwr-muted-rgb),0.8)] hover:bg-white/10 hover:text-slate-100'
              ].join(' ')}
            >
              All-time
            </button>
            <button
              type="button"
              onClick={period === 'year' || exporting ? undefined : onPeriodToggle}
              className={[
                'rounded-full px-4 py-2 text-sm font-semibold transition',
                period === 'year'
                  ? 'bg-white/10 text-slate-50 cursor-default'
                  : 'text-[rgba(var(--tgwr-muted-rgb),0.8)] hover:bg-white/10 hover:text-slate-100'
              ].join(' ')}
            >
              {year}
            </button>
          </div>

          <div className="mt-10">
            <div className="select-none text-[13px] font-semibold uppercase tracking-[0.42em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
              Total messages · {periodLabel}
            </div>

            <motion.div
              initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: exporting ? 0 : 0.08 }}
              className="mt-5 text-[110px] font-bold leading-none"
            >
              <span className="tgwr-gradient-text select-none">{formatInt(total)}</span>
            </motion.div>

            <motion.div
              initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: exporting ? 0 : 0.13 }}
              className="mt-6 max-w-[860px] text-[18px] leading-relaxed text-slate-100/90"
            >
              Это все сообщения, которые попали в экспорт и в базу. Без фильтров. Как есть.
            </motion.div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
            <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
              Next
            </div>
            <div className="mt-2 text-[18px] font-semibold text-slate-100">Sent vs received</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
            <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
              Context
            </div>
            <div className="mt-2 text-[18px] font-semibold text-slate-100">Локальный анализ</div>
          </div>
        </div>
      </div>
    </SlideFrame>
  )
}