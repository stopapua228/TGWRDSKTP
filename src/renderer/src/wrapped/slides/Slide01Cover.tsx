import { motion } from 'framer-motion'
import React from 'react'
import SlideFrame from '../SlideFrame'
import { getYearLabel } from '../report'
import type { SlideCommonProps, ThemeId } from '../slideTypes'

function ThemeChip({ id, active, onClick, exporting }: { id: ThemeId; active: boolean; onClick: () => void; exporting?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      onClick={exporting ? undefined : onClick}
      className={[
        'rounded-full border px-4 py-2 text-sm font-semibold transition',
        active
          ? 'border-[rgba(var(--tgwr-border-rgb),0.34)] bg-white/10 text-slate-50 shadow-[0_0_22px_rgba(var(--tgwr-accent1-rgb),0.16)]'
          : 'border-white/10 bg-white/5 text-[rgba(var(--tgwr-muted-rgb),0.85)]',
        !active && exporting ? 'hidden' : '', // На экспорте оставляем только выбранную тему
        exporting ? 'cursor-default' : 'hover:bg-white/10'
      ].join(' ')}
    >
      {id}
    </button>
  )
}

export default function Slide01Cover({ report, theme, onThemeChange, exporting }: SlideCommonProps): JSX.Element {
  const year = getYearLabel(report)

  return (
    <SlideFrame
      kicker="Telegram Wrapped"
      title="TGWR"
      subtitle="Твой Telegram — в цифрах. Полностью локально. Без серверов."
      // Прячем инструкцию по навигации в PDF/PNG
      footerHint={exporting ? undefined : "Колесо мыши / стрелки — листать. Кнопка “Детали” — таблицы топ-10."}
    >
      <div className="flex h-full flex-col justify-between">
        <div className="mt-6">
          <motion.div
            initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: exporting ? 0 : 0.1 }}
            className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-4"
          >
            <div className="h-3 w-3 rounded-full bg-[rgba(var(--tgwr-accent1-rgb),0.95)] shadow-[0_0_26px_rgba(var(--tgwr-accent1-rgb),0.45)]" />
            <div className="text-sm font-semibold text-slate-100">Год (MSK):</div>
            <div className="text-lg font-bold tracking-tight text-slate-50">{year}</div>
          </motion.div>

          <motion.div
            initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: exporting ? 0 : 0.16 }}
            className="mt-10"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.38em] text-[rgba(var(--tgwr-muted-rgb),0.75)]">
              {exporting ? 'Active Theme' : 'Theme'}
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <ThemeChip id="neon" active={theme === 'neon'} onClick={() => onThemeChange('neon')} exporting={exporting} />
              <ThemeChip id="cyber" active={theme === 'cyber'} onClick={() => onThemeChange('cyber')} exporting={exporting} />
              <ThemeChip id="midnight" active={theme === 'midnight'} onClick={() => onThemeChange('midnight')} exporting={exporting} />
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: exporting ? 0 : 0.22 }}
          className={`${exporting ? '' : 'tgwr-float'} mt-12 rounded-3xl border border-white/10 bg-white/5 px-8 py-7`}
        >
          <div className="text-[13px] font-semibold uppercase tracking-[0.34em] text-[rgba(var(--tgwr-muted-rgb),0.80)]">
            Wrapped
          </div>
          <div className="mt-3 text-[18px] leading-relaxed text-slate-100">
            Красивый. Короткий. <span className="tgwr-gradient-text font-semibold">Твой.</span>
          </div>
        </motion.div>
      </div>
    </SlideFrame>
  )
}