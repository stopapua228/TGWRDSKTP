import { motion } from 'framer-motion'
import React, { useMemo } from 'react'
import SlideFrame from '../SlideFrame'
import { clamp } from '../format'
import { getPeriod, getWordCloud } from '../report'
import type { SlideCommonProps } from '../slideTypes'

export default function Slide11WordCloud({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const words = useMemo(() => getWordCloud(p).slice(0, 50), [p])

  const { minW, maxW } = useMemo(() => {
    let min = Number.POSITIVE_INFINITY
    let max = 0
    for (const w of words) {
      min = Math.min(min, w.weight)
      max = Math.max(max, w.weight)
    }
    if (!Number.isFinite(min)) min = 0
    return { minW: min, maxW: max }
  }, [words])

  const sizeFor = (weight: number): number => {
    if (maxW <= minW) return 30
    const t = (weight - minW) / (maxW - minW)
    return clamp(18 + t * 54, 18, 72)
  }

  return (
    <SlideFrame
      kicker="Words"
      title="Слова года"
      subtitle="Топ-слова (без стоп-слов и ссылок). Простая word-cloud визуализация."
    >
      <div className="flex h-full flex-col justify-center">
        <div className="rounded-[44px] border border-white/10 bg-white/5 p-10">
          <div className="flex flex-wrap items-center justify-start gap-x-6 gap-y-4">
            {words.length === 0 ? (
              <div className="text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.9)]">
                Пока пусто — нет текста в исходящих.
              </div>
            ) : (
              words.map((w, idx) => (
                <motion.span
                  key={`${w.word}-${idx}`}
                  // На экспорте отключаем анимацию влета, чтобы не поймать пустой кадр
                  initial={exporting ? { opacity: 0.92, y: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 0.92, y: 0 }}
                  // Убираем ступенчатую задержку (stagger) для мгновенного рендера в файл
                  transition={{
                    duration: 0.25,
                    delay: exporting ? 0 : Math.min(0.22, idx * 0.01)
                  }}
                  style={{
                    fontSize: `${sizeFor(w.weight)}px`,
                    lineHeight: 1,
                    letterSpacing: '-0.02em',
                    transform: `translateZ(0)`
                  }}
                  className={[
                    'select-none font-semibold',
                    idx % 5 === 0
                      ? 'text-[rgba(var(--tgwr-accent1-rgb),0.95)]'
                      : idx % 7 === 0
                        ? 'text-[rgba(var(--tgwr-accent2-rgb),0.90)]'
                        : 'text-slate-100'
                  ].join(' ')}
                >
                  {w.word}
                </motion.span>
              ))
            )}
          </div>
        </div>
      </div>
    </SlideFrame>
  )
}