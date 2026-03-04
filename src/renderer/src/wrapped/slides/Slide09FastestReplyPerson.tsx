import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatSecondsHuman } from '../format'
import { getPeriod, getReplyChampion } from '../report'
import type { SlideCommonProps } from '../slideTypes'

export default function Slide09FastestReplyPerson({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const champ = getReplyChampion(p, 'who_you_reply_fastest')

  return (
    <SlideFrame
      kicker="Replies"
      title="Кому отвечаешь быстрее всех"
      subtitle="Медианное время ответа на сообщения других."
    >
      <div className="flex h-full flex-col justify-center">
        <motion.div
          // Мгновенно фиксируем позицию и видимость при экспорте
          initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: exporting ? 0 : 0.06 }}
          className="rounded-[44px] border border-white/10 bg-white/5 p-10"
        >
          <div className="text-[22px] font-semibold text-slate-100">{champ?.name ?? '—'}</div>

          <div className="mt-6 text-[90px] font-bold leading-none">
            <span className="tgwr-gradient-text">
              {champ ? formatSecondsHuman(champ.seconds) : '—'}
            </span>
          </div>

          <div className="mt-4 text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.92)]">
            медиана ответа
          </div>

          {!champ && (
            <div className="mt-8 text-[13px] text-[rgba(var(--tgwr-muted-rgb),0.85)]">
              Нужны reply_to_msg_id + self_from_id, чтобы считать ответы.
            </div>
          )}
        </motion.div>
      </div>
    </SlideFrame>
  )
}