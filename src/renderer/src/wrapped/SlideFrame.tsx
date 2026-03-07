import { motion } from 'framer-motion'
import React from 'react'

type Props = {
  kicker?: string
  title: React.ReactNode
  subtitle?: string
  footerHint?: string
  children: React.ReactNode
}

export default function SlideFrame({ kicker, title, subtitle, footerHint, children }: Props): JSX.Element {
  return (
    <div
      className={[
        'tgwr-scanlines relative h-full w-full overflow-hidden rounded-[44px] border',
        'border-[rgba(var(--tgwr-border-rgb),0.22)]',
        'bg-[rgba(var(--tgwr-card-rgb),0.60)]',
        'shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_40px_140px_rgba(0,0,0,0.65)]'
      ].join(' ')}
    >
      {/* glows */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[rgba(var(--tgwr-accent1-rgb),0.22)] blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-44 -right-44 h-[560px] w-[560px] rounded-full bg-[rgba(var(--tgwr-accent2-rgb),0.18)] blur-[130px]" />


      <div className="relative flex h-full w-full flex-col px-[84px] py-[90px]">
        <div className="min-h-[150px]">
          {kicker ? (
            <div className="text-[13px] font-semibold uppercase tracking-[0.42em] text-[rgba(var(--tgwr-muted-rgb),0.85)]">
              {kicker}
            </div>
          ) : null}

          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="mt-5 text-[72px] font-semibold leading-[0.98] text-slate-100"
          >
            {title}
          </motion.h2>

          {subtitle ? (
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.05 }}
              className="mt-5 max-w-[840px] text-[18px] leading-relaxed text-[rgba(var(--tgwr-muted-rgb),0.92)]"
            >
              {subtitle}
            </motion.p>
          ) : null}
        </div>

        <div className="mt-10 flex-1">{children}</div>

        {footerHint ? (
          <div className="mt-10 text-[13px] font-medium text-[rgba(var(--tgwr-muted-rgb),0.75)]">{footerHint}</div>
        ) : null}
      </div>
    </div>
  )
}
