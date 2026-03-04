import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { formatInt } from '../format'
import { getMediaCounts, getPeriod } from '../report'
import type { SlideCommonProps } from '../slideTypes'

type Item = { key: string; label: string; icon: string }

const ITEMS: Item[] = [
  { key: 'photo', label: 'Фото', icon: '🖼️' },
  { key: 'video', label: 'Видео', icon: '🎬' },
  { key: 'voice', label: 'Voice', icon: '🎙️' },
  { key: 'sticker', label: 'Стикеры', icon: '🧩' },
  { key: 'gif', label: 'GIF', icon: '✨' },
  { key: 'file', label: 'Файлы', icon: '📎' },
  { key: 'other', label: 'Другое', icon: '📦' }
]

export default function Slide13MediaCounts({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const media = getMediaCounts(p)

  return (
    <SlideFrame kicker="Media" title="Медиа-режим" subtitle="Сколько вложений и медиа." >
      <div className="flex h-full flex-col justify-center">
        <div className="rounded-[44px] border border-white/10 bg-white/5 p-10">
          {/* Сетка остается прежней, 3 колонки отлично вписываются в 1080px */}
          <div className="grid grid-cols-3 gap-6">
            {ITEMS.map((it, idx) => {
              const value = media[it.key] ?? 0
              return (
                <motion.div
                  key={it.key}
                  // Замораживаем анимацию для чистого снимка при экспорте
                  initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  // Убираем каскадную задержку (stagger) при экспорте
                  transition={{
                    duration: 0.25,
                    delay: exporting ? 0 : Math.min(0.25, idx * 0.03)
                  }}
                  className="rounded-3xl border border-white/10 bg-white/5 px-7 py-6"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-[28px]">{it.icon}</div>
                    <div className="text-[18px] font-bold text-slate-50">{formatInt(value)}</div>
                  </div>
                  <div className="mt-3 text-[13px] font-semibold uppercase tracking-[0.34em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                    {it.label}
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </div>
    </SlideFrame>
  )
}