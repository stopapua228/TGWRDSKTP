import { motion } from 'framer-motion'
import React, { useMemo } from 'react'
import SlideFrame from '../SlideFrame'
import { formatDateYYYYMMDD, formatInt, formatMonth } from '../format'
import { getActiveDaysCount, getDailyActivity, getMostActiveDay, getMostActiveMonth, getPeriod } from '../report'
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

function normalizeHeatmap(values: number[], targetCells = 365): number[] {
  if (targetCells <= 0) return []
  if (values.length === 0) return Array.from({ length: targetCells }, () => 0)
  if (values.length === targetCells) return values.slice()

  if (values.length < targetCells) {
    return values.concat(Array.from({ length: targetCells - values.length }, () => 0))
  }

  const out: number[] = []
  for (let i = 0; i < targetCells; i += 1) {
    const start = Math.floor((i * values.length) / targetCells)
    const end = Math.floor(((i + 1) * values.length) / targetCells)
    const slice = values.slice(start, Math.max(start + 1, end))
    const sum = slice.reduce((acc, item) => acc + item, 0)
    out.push(Math.round(sum / slice.length))
  }
  return out
}

function buildBuckets(values: number[]): number[] {
  const nonZero = values.filter((value) => value > 0).sort((a, b) => a - b)
  if (nonZero.length === 0) return []

  const pick = (ratio: number): number => {
    const index = Math.min(nonZero.length - 1, Math.floor((nonZero.length - 1) * ratio))
    return nonZero[index]
  }

  return [pick(0.2), pick(0.4), pick(0.6), pick(0.8)]
}

function getHeatLevel(value: number, buckets: number[]): number {
  if (value <= 0) return 0
  if (buckets.length === 0) return 1
  if (value <= buckets[0]) return 1
  if (value <= buckets[1]) return 2
  if (value <= buckets[2]) return 3
  if (value <= buckets[3]) return 4
  return 5
}

function getHeatFill(level: number): string {
  switch (level) {
    case 1:
      return 'rgba(var(--tgwr-accent1-rgb),0.18)'
    case 2:
      return 'rgba(var(--tgwr-accent1-rgb),0.34)'
    case 3:
      return 'rgba(var(--tgwr-accent1-rgb),0.58)'
    case 4:
      return 'rgba(var(--tgwr-accent2-rgb),0.72)'
    case 5:
      return 'rgba(var(--tgwr-accent2-rgb),0.96)'
    default:
      return 'rgba(var(--tgwr-border-rgb),0.12)'
  }
}

export default function Slide04MostActiveMonth({ report, period, exporting }: SlideCommonProps): JSX.Element {
  const p = getPeriod(report, period)
  const month = getMostActiveMonth(p)
  const peakDay = getMostActiveDay(p)
  const activeDays = getActiveDaysCount(p)
  const dailyActivity = getDailyActivity(p)

  const heatmapValues = useMemo(() => {
    const source = dailyActivity.map((item) => item.count)
    return normalizeHeatmap(source, 365)
  }, [dailyActivity])

  const heatmapBuckets = useMemo(() => buildBuckets(heatmapValues), [heatmapValues])

  const svgLayout = useMemo(() => {
    const columns = 23
    const rows = Math.ceil(heatmapValues.length / columns)
    const gap = 8
    const viewWidth = 820
    const viewHeight = 620
    const cellSize = Math.floor(
      Math.min(
        (viewWidth - gap * (columns - 1)) / columns,
        (viewHeight - gap * Math.max(0, rows - 1)) / Math.max(1, rows)
      )
    )
    const gridWidth = columns * cellSize + gap * (columns - 1)
    const gridHeight = rows * cellSize + gap * Math.max(0, rows - 1)
    const baseX = (viewWidth - gridWidth) / 2
    const baseY = (viewHeight - gridHeight) / 2

    return { columns, rows, gap, cellSize, viewWidth, viewHeight, baseX, baseY }
  }, [heatmapValues.length])

  const legendLevels = [0, 1, 2, 3, 4, 5]

  return (
    <SlideFrame
      kicker="IW$"
      title={<span className="tgwr-gradient-text font-semibold">Самый активный месяц</span>}
      subtitle="Каждый день как твоя маленькая история"
    >
      <div className="flex h-full min-h-0 flex-col gap-8">
        <div className="grid grid-cols-3 gap-6">
          <MetricCard
            label="Максимум за месяц"
            value={<span className="tgwr-gradient-text">{formatInt(month?.count ?? 0)}</span>}
            hint={month ? `${formatMonth(month.value)}` : 'Нет данных'}
            accent
            delay={0.02}
            exporting={exporting}
          />
          <MetricCard
            label="Активных дней"
            value={<span className="tgwr-gradient-text">{formatInt(activeDays)}</span>}
            hint="Сколько дней в этом году ты писал"
            delay={0.08}
            exporting={exporting}
          />
          <MetricCard
            label="Самый жаркий день"
            value={<span className="tgwr-gradient-text">{peakDay?.value ? formatDateYYYYMMDD(peakDay.value).slice(0, 5) : '—'}</span>}
            hint={peakDay ? `${formatInt(peakDay.count)} сообщений за день` : 'Нет данных'}
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
                365 days map
              </div>
              <div className="mt-3 text-[18px] font-semibold text-slate-100">Одна клетка = один день</div>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.20em] text-[rgba(var(--tgwr-muted-rgb),0.70)]">
                low
              </div>
              {legendLevels.map((level) => (
                <div
                  key={level}
                  className="h-4 w-4 rounded-[5px] border border-white/10"
                  style={{ background: getHeatFill(level) }}
                />
              ))}
              <div className="text-[11px] font-semibold uppercase tracking-[0.20em] text-[rgba(var(--tgwr-muted-rgb),0.70)]">
                high
              </div>
            </div>
          </div>

          <div className="mt-7 flex min-h-0 flex-1 items-center justify-center rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(var(--tgwr-card-rgb),0.44),rgba(var(--tgwr-card-rgb),0.18))] px-6 py-6">
            <svg
              viewBox={`0 0 ${svgLayout.viewWidth} ${svgLayout.viewHeight}`}
              className="h-full w-full"
              role="img"
              aria-label="Year activity heatmap"
            >
              {Array.from({ length: svgLayout.rows }).map((_, rowIndex) => {
                const rowStart = rowIndex * svgLayout.columns
                const rowValues = heatmapValues.slice(rowStart, rowStart + svgLayout.columns)
                const rowWidth = rowValues.length * svgLayout.cellSize + Math.max(0, rowValues.length - 1) * svgLayout.gap
                const rowOffsetX = svgLayout.baseX + (svgLayout.columns * svgLayout.cellSize + (svgLayout.columns - 1) * svgLayout.gap - rowWidth) / 2
                const y = svgLayout.baseY + rowIndex * (svgLayout.cellSize + svgLayout.gap)

                return rowValues.map((value, columnIndex) => {
                  const x = rowOffsetX + columnIndex * (svgLayout.cellSize + svgLayout.gap)
                  const level = getHeatLevel(value, heatmapBuckets)
                  return (
                    <rect
                      key={`${rowIndex}-${columnIndex}`}
                      x={x}
                      y={y}
                      width={svgLayout.cellSize}
                      height={svgLayout.cellSize}
                      rx={Math.max(4, svgLayout.cellSize * 0.22)}
                      fill={getHeatFill(level)}
                      stroke="rgba(255,255,255,0.05)"
                      strokeWidth="1"
                    />
                  )
                })
              })}
            </svg>
          </div>
        </motion.div>
      </div>
    </SlideFrame>
  )
}
