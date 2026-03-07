import { motion } from 'framer-motion'
import React, { useMemo } from 'react'
import SlideFrame from '../SlideFrame'
import { formatHour, formatInt } from '../format'
import { getHourlyActivity, getMostActiveHour, getPeriod, getTotalMessages } from '../report'
import type { SlideCommonProps } from '../slideTypes'

type MetricCardProps = {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  accent?: boolean
  delay: number
  exporting?: boolean
}

function MetricCard({ label, value, hint, accent = false, delay, exporting }: MetricCardProps): JSX.Element {
  return (
    <motion.div
      initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: exporting ? 0 : 0.34, delay: exporting ? 0 : delay }}
      className={[
        'flex min-h-[220px] flex-col justify-between rounded-[38px] border px-7 py-7',
        accent
          ? 'border-[rgba(var(--tgwr-accent1-rgb),0.26)] bg-[linear-gradient(180deg,rgba(var(--tgwr-accent1-rgb),0.10),rgba(var(--tgwr-card-rgb),0.72))] shadow-[0_0_36px_rgba(var(--tgwr-accent1-rgb),0.10)]'
          : 'border-white/10 bg-white/5'
      ].join(' ')}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[rgba(var(--tgwr-muted-rgb),0.76)]">
        {label}
      </div>
      <div className="mt-5 text-[58px] font-bold leading-[0.92] text-slate-50">{value}</div>
      {hint ? <div className="mt-5 text-[16px] leading-snug text-[rgba(var(--tgwr-muted-rgb),0.90)]">{hint}</div> : <div />}
    </motion.div>
  )
}

export default function Slide05MostActiveHour({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const mostActiveHour = getMostActiveHour(p)
  const hourlyActivity = getHourlyActivity(p)
  const totalMessages = getTotalMessages(p)

  const peakHour = mostActiveHour?.value ?? '0'
  const peakCount = mostActiveHour?.count ?? 0

  const averagePerHour = hourlyActivity.length > 0
    ? Math.round(hourlyActivity.reduce((acc, item) => acc + item.count, 0) / hourlyActivity.length)
    : 0

  const chart = useMemo(() => {
    const values = hourlyActivity.map((item) => item.count)
    const maxValue = Math.max(...values, 1)
    const averageValue = averagePerHour

    const viewWidth = 844
    const viewHeight = 780
    const chartLeft = 18
    const chartRight = 18
    const chartTop = 34
    const chartBottom = 74
    const chartWidth = viewWidth - chartLeft - chartRight
    const chartHeight = viewHeight - chartTop - chartBottom
    const slotWidth = chartWidth / 24
    const barWidth = Math.min(22, Math.max(14, slotWidth - 10))
    const baselineY = chartTop + chartHeight
    const peakIndex = values.indexOf(maxValue)

    const averageY = baselineY - (averageValue / maxValue) * (chartHeight - 28)

    return {
      viewWidth,
      viewHeight,
      chartLeft,
      chartTop,
      chartHeight,
      chartWidth,
      slotWidth,
      barWidth,
      baselineY,
      peakIndex,
      maxValue,
      averageY
    }
  }, [hourlyActivity, averagePerHour])

  return (
    <SlideFrame
      kicker="IW$"
      title={<span className="tgwr-gradient-text font-semibold">Час-Пик</span>}
      subtitle="Иногда нам много 24 часов, а иногда малол"
    >
      <div className="flex h-full min-h-0 flex-col gap-8">
        <div className="grid grid-cols-3 gap-6">
          <MetricCard
            label="Самый активный час"
            value={formatHour(peakHour)}
            hint="Пик по московскому времени"
            accent
            delay={0.02}
            exporting={exporting}
          />
          <MetricCard
            label="Сообщений в этот час"
            value={<span className="tgwr-gradient-text">{formatInt(peakCount)}</span>}
            hint={totalMessages > 0 ? `${formatInt(totalMessages)} сообщений в выбранном периоде` : 'Нет данных'}
            delay={0.08}
            exporting={exporting}
          />
          <MetricCard
            label="Среднее / час"
            value={formatInt(averagePerHour)}
            hint="Удобная точка сравнения для всего графика"
            delay={0.14}
            exporting={exporting}
          />
        </div>

        <motion.div
          initial={exporting ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: exporting ? 0 : 0.38, delay: exporting ? 0 : 0.18 }}
          className="flex min-h-0 flex-1 flex-col rounded-[42px] border border-white/10 bg-[rgba(var(--tgwr-card-rgb),0.56)] px-8 py-7 shadow-[0_20px_80px_rgba(0,0,0,0.28)]"
        >
          <div className="flex items-center justify-between gap-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[rgba(var(--tgwr-muted-rgb),0.76)]">
                24 hours profile
              </div>
              <div className="mt-3 text-[18px] font-semibold text-slate-100">Высота столбца = активность в конкретный час</div>
            </div>

            <div className="rounded-full border border-[rgba(var(--tgwr-accent1-rgb),0.16)] bg-[rgba(var(--tgwr-accent1-rgb),0.10)] px-4 py-2 text-[12px] font-semibold text-slate-100">
              peak · {formatHour(peakHour)}
            </div>
          </div>

          <div className="mt-7 flex min-h-0 flex-1 items-center justify-center rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(var(--tgwr-card-rgb),0.44),rgba(var(--tgwr-card-rgb),0.18))] px-5 py-5">
            <svg viewBox={`0 0 ${chart.viewWidth} ${chart.viewHeight}`} className="h-full w-full" role="img" aria-label="Hourly activity chart">
              <defs>
                <linearGradient id="tgwr-hour-peak" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(var(--tgwr-accent2-rgb),1)" />
                  <stop offset="100%" stopColor="rgba(var(--tgwr-accent1-rgb),0.95)" />
                </linearGradient>
                <linearGradient id="tgwr-hour-regular" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(var(--tgwr-border-rgb),0.82)" />
                  <stop offset="100%" stopColor="rgba(var(--tgwr-border-rgb),0.36)" />
                </linearGradient>
              </defs>

              {[0.25, 0.5, 0.75].map((ratio) => {
                const y = chart.chartTop + chart.chartHeight * (1 - ratio)
                return (
                  <line
                    key={ratio}
                    x1={chart.chartLeft}
                    x2={chart.chartLeft + chart.chartWidth}
                    y1={y}
                    y2={y}
                    stroke="rgba(var(--tgwr-border-rgb),0.16)"
                    strokeWidth="1"
                    strokeDasharray="6 10"
                  />
                )
              })}

              <line
                x1={chart.chartLeft}
                x2={chart.chartLeft + chart.chartWidth}
                y1={chart.averageY}
                y2={chart.averageY}
                stroke="rgba(var(--tgwr-accent1-rgb),0.42)"
                strokeWidth="2"
                strokeDasharray="10 8"
              />

              <rect
                x={chart.chartLeft + chart.chartWidth - 122}
                y={chart.averageY - 16}
                width="110"
                height="28"
                rx="14"
                fill="rgba(var(--tgwr-accent1-rgb),0.10)"
                stroke="rgba(var(--tgwr-accent1-rgb),0.22)"
              />
              <text
                x={chart.chartLeft + chart.chartWidth - 67}
                y={chart.averageY + 3}
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill="rgba(255,255,255,0.86)"
              >
                avg · {formatInt(averagePerHour)}
              </text>

              {hourlyActivity.map((item, index) => {
                const ratio = chart.maxValue > 0 ? item.count / chart.maxValue : 0
                const height = Math.max(18, ratio * (chart.chartHeight - 28))
                const x = chart.chartLeft + chart.slotWidth * index + (chart.slotWidth - chart.barWidth) / 2
                const y = chart.baselineY - height
                const isPeak = index === chart.peakIndex

                return (
                  <g key={item.hour}>
                    <rect
                      x={x}
                      y={y}
                      width={chart.barWidth}
                      height={height}
                      rx={chart.barWidth / 2}
                      fill={isPeak ? 'url(#tgwr-hour-peak)' : 'url(#tgwr-hour-regular)'}
                    />

                    <text
                      x={x + chart.barWidth / 2}
                      y={chart.baselineY + 24}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight={isPeak ? '800' : '700'}
                      fill={isPeak ? 'rgba(var(--tgwr-accent1-rgb),0.95)' : 'rgba(var(--tgwr-muted-rgb),0.70)'}
                    >
                      {String(item.hour).padStart(2, '0')}
                    </text>

                    {isPeak ? (
                      <>
                        <rect
                          x={x + chart.barWidth / 2 - 48}
                          y={Math.max(10, y - 42)}
                          width="96"
                          height="28"
                          rx="14"
                          fill="rgba(var(--tgwr-accent2-rgb),0.12)"
                          stroke="rgba(var(--tgwr-accent2-rgb),0.26)"
                        />
                        <text
                          x={x + chart.barWidth / 2}
                          y={Math.max(10, y - 24)}
                          textAnchor="middle"
                          fontSize="12"
                          fontWeight="800"
                          fill="rgba(255,255,255,0.92)"
                        >
                          {formatInt(item.count)}
                        </text>
                      </>
                    ) : null}
                  </g>
                )
              })}
            </svg>
          </div>
        </motion.div>
      </div>
    </SlideFrame>
  )
}
