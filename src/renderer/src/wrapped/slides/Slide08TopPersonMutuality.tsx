import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatInt, formatPercent01 } from '../format'
import { getPeriod, getPersonName, getTop10, pickFirst } from '../report'
import type { SlideCommonProps } from '../slideTypes'
import { getNumber } from '../safe'

export default function Slide08TopPersonMutuality({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const arr = getTop10(p, 'top_10_people_by_mutuality')
  const top = pickFirst(arr)

  const name = getPersonName(top)
  const total = top ? getNumber(top, 'total_messages', 0) : 0
  const diff = top ? getNumber(top, 'abs_diff', 0) : 0
  const ratio = top ? getNumber(top, 'imbalance_ratio', 0) : 0

  return (
    <SlideFrame
      kicker="Balance"
      title="Самая взаимная переписка"
      subtitle="Минимальный дисбаланс sent/received при большом объёме."
    >
      <div className="flex h-full flex-col justify-center">
        <motion.div
          // При экспорте отключаем анимацию "взлета"
          initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          // Убираем задержку для мгновенного рендера в файл
          transition={{ duration: 0.35, delay: exporting ? 0 : 0.06 }}
          className="rounded-[44px] border border-white/10 bg-white/5 p-10"
        >
          <div className="text-[22px] font-semibold text-slate-100">{name}</div>

          <div className="mt-6 grid grid-cols-3 gap-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
              <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                Total
              </div>
              <div className="mt-2 text-[28px] font-bold text-slate-50">{formatInt(total)}</div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
              <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                Abs diff
              </div>
              <div className="mt-2 text-[28px] font-bold text-slate-50">{formatInt(diff)}</div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
              <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                Imbalance
              </div>
              <div className="mt-2 text-[28px] font-bold">
                <span className="tgwr-gradient-text">{formatPercent01(ratio)}</span>
              </div>
            </div>
          </div>

          {arr.length === 0 ? (
            <div className="mt-8 text-[13px] text-[rgba(var(--tgwr-muted-rgb),0.85)]">
              Пусто: этот рейтинг требует хотя бы 2000 сообщений с человеком и корректного is_out.
            </div>
          ) : (
            <div className="mt-8 text-[13px] text-[rgba(var(--tgwr-muted-rgb),0.85)]">
              Чем меньше процент — тем ровнее диалог.
            </div>
          )}
        </motion.div>
      </div>
    </SlideFrame>
  )
}