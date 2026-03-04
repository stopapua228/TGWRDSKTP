import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { getAchievements } from '../report'
import type { SlideCommonProps } from '../slideTypes'
import { getBoolean, getNumber, getString } from '../safe'

export default function Slide19Achievements({ report, exporting }: SlideCommonProps): JSX.Element {
  const achievements = getAchievements(report)

  return (
    <SlideFrame
      kicker="Achievements"
      title="Ачивки"
      subtitle="Небольшие титулы за стиль общения."
      // Скрываем подсказку про скролл на экспорте, чтобы не смущать людей в PDF
      footerHint={exporting ? undefined : "Свайп/скролл по горизонтали."}
    >
      <div className="flex h-full flex-col justify-center">
        <div className="rounded-[44px] border border-white/10 bg-white/5 p-10">

          {/* ГЛАВНОЕ ИЗМЕНЕНИЕ:
              Если идет экспорт, меняем overflow-x-auto на flex-wrap.
              Так ачивки выстроятся в несколько рядов и все попадут в кадр.
          */}
          <div className={[
            "flex gap-6",
            exporting
              ? "flex-wrap justify-center overflow-visible"
              : "overflow-x-auto pb-4 custom-scrollbar"
          ].join(' ')}>

            {achievements.length === 0 ? (
              <div className="text-[16px] text-[rgba(var(--tgwr-muted-rgb),0.9)]">Пока пусто.</div>
            ) : (
              achievements.map((a, idx) => {
                const earned = getBoolean(a, 'earned', false)
                const title = getString(a, 'title', getString(a, 'id', ''))
                const desc = getString(a, 'description', '')
                const score = getNumber(a, 'score', 0)

                return (
                  <motion.div
                    key={getString(a, 'id', String(idx))}
                    // Отключаем анимацию при экспорте, чтобы поймать финальное состояние
                    initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: exporting ? 0 : Math.min(0.25, idx * 0.03) }}
                    className={[
                      'min-w-[320px] max-w-[320px] rounded-[34px] border px-7 py-7 transition-all',
                      earned
                        ? 'border-[rgba(var(--tgwr-accent1-rgb),0.35)] bg-[rgba(var(--tgwr-accent1-rgb),0.10)] shadow-[0_0_34px_rgba(var(--tgwr-accent1-rgb),0.12)]'
                        : 'border-white/10 bg-white/5'
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="text-[18px] font-semibold text-slate-100">{title}</div>
                      <div
                        className={[
                          'rounded-full border px-3 py-1 text-xs font-semibold',
                          earned
                            ? 'border-[rgba(var(--tgwr-accent1-rgb),0.35)] bg-white/5 text-slate-50'
                            : 'border-white/10 bg-white/5 text-[rgba(var(--tgwr-muted-rgb),0.85)]'
                        ].join(' ')}
                      >
                        {earned ? 'EARNED' : 'LOCKED'}
                      </div>
                    </div>

                    <div className="mt-3 text-[14px] leading-relaxed text-[rgba(var(--tgwr-muted-rgb),0.95)]">{desc}</div>

                    <div className="mt-6 flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                        score
                      </div>
                      <div className="text-sm font-bold text-slate-100">{score}</div>
                    </div>

                    <div className="mt-5 text-[12px] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
                      badge: <span className="font-mono">{getString(a, 'badge_image_path', '')}</span>
                    </div>
                  </motion.div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </SlideFrame>
  )
}