import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatInt } from '../format'
import { getEmojiTop, getPeriod } from '../report'
import type { SlideCommonProps } from '../slideTypes'

export default function Slide12EmojiTop({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const emojis = getEmojiTop(p).slice(0, 12)

  return (
    <SlideFrame kicker="Emoji" title="Твои эмодзи" subtitle="Топ эмодзи (в тексте и sticker_emoji)." >
      <div className="flex h-full flex-col justify-center">
        <div className="rounded-[44px] border border-white/10 bg-white/5 p-10">
          {emojis.length === 0 ? (
            <div className="text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.9)]">
              Пока пусто — эмодзи не найдены.
            </div>
          ) : (
            /* Сетка 4 колонки — это 3 ряда для 12 элементов. Идеально для вертикального кадра. */
            <div className="grid grid-cols-4 gap-6">
              {emojis.map((e, idx) => (
                <motion.div
                  key={`${e.emoji}-${idx}`}
                  // Заглушка анимации для экспорта
                  initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  // Мгновенное появление при сохранении в файл
                  transition={{
                    duration: 0.25,
                    delay: exporting ? 0 : Math.min(0.25, idx * 0.03)
                  }}
                  className="rounded-3xl border border-white/10 bg-white/5 px-6 py-6"
                >
                  <div className="text-[44px]">{e.emoji}</div>
                  <div className="mt-2 text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                    Count
                  </div>
                  <div className="mt-2 text-[18px] font-bold text-slate-50">
                    {formatInt(e.count)}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SlideFrame>
  )
}