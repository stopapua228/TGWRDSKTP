import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatInt } from '../format'
import { getPeriod, getPersonName, getTop10, pickFirst } from '../report'
import type { SlideCommonProps } from '../slideTypes'
import { getNumber } from '../safe'

export default function Slide07TopPersonMessages({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const arr = getTop10(p, 'top_10_people_by_messages')
  const top = pickFirst(arr)

  const name = getPersonName(top)
  const total = top ? getNumber(top, 'total_messages', 0) : 0
  const sent = top ? getNumber(top, 'sent_messages', 0) : 0
  const received = top ? getNumber(top, 'received_messages', 0) : 0

  return (
    <SlideFrame kicker="People" title="Топ персона" subtitle="С кем больше всего сообщений." >
      <div className="flex h-full flex-col justify-center">
        <motion.div
          // Отключаем "взлет" карточки при экспорте
          initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          // Убираем задержку, чтобы захватить финальные цифры мгновенно
          transition={{ duration: 0.35, delay: exporting ? 0 : 0.06 }}
          className="rounded-[44px] border border-white/10 bg-white/5 p-10"
        >
          <div className="text-[22px] font-semibold text-slate-100">{name}</div>

          <div className="mt-5 text-[92px] font-bold leading-none">
            <span className="tgwr-gradient-text">{formatInt(total)}</span>
          </div>

          <div className="mt-4 text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.92)]">
            сообщений всего
          </div>

          <div className="mt-8 grid grid-cols-2 gap-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
              <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                Sent
              </div>
              <div className="mt-2 text-[26px] font-bold text-slate-50">
                {formatInt(sent)}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
              <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                Received
              </div>
              <div className="mt-2 text-[26px] font-bold text-slate-50">
                {formatInt(received)}
              </div>
            </div>
          </div>

          {!arr.length && (
            <div className="mt-6 text-[13px] text-[rgba(var(--tgwr-muted-rgb),0.85)]">
              Пока пусто: проверь self_from_id / peer_from_id в БД.
            </div>
          )}
        </motion.div>
      </div>
    </SlideFrame>
  )
}