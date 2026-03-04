import { motion } from 'framer-motion'
import React, { useMemo } from 'react'
import SlideFrame from '../SlideFrame'
import { clamp, formatInt } from '../format'
import { getPeriod, getReceivedMessages, getSentMessages, getTotalMessages } from '../report'
import type { SlideCommonProps } from '../slideTypes'

export default function Slide03SentVsReceived({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const sent = getSentMessages(p)
  const received = getReceivedMessages(p)
  const total = getTotalMessages(p)

  const sentRatio = useMemo(() => {
    if (total <= 0) return 0
    return clamp(sent / total, 0, 1)
  }, [sent, total])

  const sentPct = Math.round(sentRatio * 100)

  return (
    <SlideFrame kicker="Direction" title="Ты пишешь или тебе пишут" subtitle="Соотношение исходящих и входящих." >
      <div className="flex h-full flex-col justify-between">
        <div className="mt-8 grid grid-cols-2 gap-8">
          <div className="rounded-3xl border border-white/10 bg-white/5 px-7 py-7">
            <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
              Sent
            </div>
            <div className="mt-3 text-[52px] font-bold leading-none text-slate-50">{formatInt(sent)}</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 px-7 py-7">
            <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
              Received
            </div>
            <div className="mt-3 text-[52px] font-bold leading-none text-slate-50">{formatInt(received)}</div>
          </div>
        </div>

        <div className="mt-10 rounded-3xl border border-white/10 bg-white/5 p-7">
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                Balance
              </div>
              <div className="mt-2 text-[18px] font-semibold text-slate-100">
                {sentPct}% sent · {100 - sentPct}% received
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                Total
              </div>
              <div className="mt-2 text-[18px] font-semibold text-slate-100">{formatInt(total)}</div>
            </div>
          </div>

          <div className="mt-5 h-3 overflow-hidden rounded-full border border-white/10 bg-white/5">
            {/* ГЛАВНОЕ ИЗМЕНЕНИЕ: Прогресс-бар
                Если идет экспорт — сразу выставляем финальную ширину.
            */}
            <motion.div
              initial={exporting ? { width: `${sentPct}%` } : { width: 0 }}
              animate={{ width: `${sentPct}%` }}
              transition={{ duration: exporting ? 0 : 0.55, ease: "easeOut" }}
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(var(--tgwr-accent1-rgb),0.75),rgba(var(--tgwr-accent2-rgb),0.65))] shadow-[0_0_26px_rgba(var(--tgwr-accent1-rgb),0.18)]"
            />
          </div>

          <div className="mt-4 text-[13px] text-[rgba(var(--tgwr-muted-rgb),0.80)]">
            Если исходящих = 0 — значит self_from_id не определён или from_id отсутствуют в данных.
          </div>
        </div>
      </div>
    </SlideFrame>
  )
}