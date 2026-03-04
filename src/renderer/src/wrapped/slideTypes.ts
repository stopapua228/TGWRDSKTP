import type { UnknownReport } from './report'

export type ThemeId = 'neon' | 'cyber' | 'midnight'
export type PeriodKey = 'all_time' | 'year'

export type SlideCommonProps = {
  report: UnknownReport
  period: PeriodKey
  onPeriodToggle: () => void

  theme: ThemeId
  onThemeChange: (t: ThemeId) => void

  // Export actions (E1)
  onExportPngPack?: () => void
  onExportPdf?: () => void
  exporting?: boolean
}

export type SlideComponent = (props: SlideCommonProps) => JSX.Element

export type SlideDef = {
  id: string
  title: string
  Component: SlideComponent
}