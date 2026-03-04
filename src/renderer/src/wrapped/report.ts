import { asNumber, asRecord, asString, getArray, getNumber, getRecord, getString, isRecord } from './safe'

export type PeriodKey = 'all_time' | 'year'

export function asReport(data: unknown): Record<string, unknown> | null {
  return asRecord(data)
}

export function getMeta(report: unknown): Record<string, unknown> {
  return asRecord(isRecord(report) ? report.meta : null) ?? {}
}

export function getYearLabel(report: unknown): string {
  const meta = getMeta(report)
  const y = meta.msk_year_used
  return typeof y === 'number' && Number.isFinite(y) ? String(y) : 'YEAR'
}

export function getPeriod(report: unknown, period: PeriodKey): Record<string, unknown> {
  const periods = isRecord(report) ? report.periods : null
  if (!isRecord(periods)) return {}
  const p = periods[period]
  return asRecord(p) ?? {}
}

export function getTotalMessages(p: Record<string, unknown>): number {
  // Worker uses total_messages.
  return getNumber(p, 'total_messages', 0)
}

export function getSentMessages(p: Record<string, unknown>): number {
  return getNumber(p, 'sent_messages', 0)
}

export function getReceivedMessages(p: Record<string, unknown>): number {
  return getNumber(p, 'received_messages', 0)
}

export function getMostActiveMonth(p: Record<string, unknown>): { value: string; count: number } | null {
  const m = getRecord(p, 'most_active_month')
  if (!m) return null
  return { value: getString(m, 'value', ''), count: getNumber(m, 'count', 0) }
}

export function getMostActiveHour(p: Record<string, unknown>): { value: string; count: number } | null {
  const m = getRecord(p, 'most_active_hour')
  if (!m) return null
  return { value: getString(m, 'value', ''), count: getNumber(m, 'count', 0) }
}

export function getNightRatio(p: Record<string, unknown>): { count: number; ratio: number } {
  return {
    count: getNumber(p, 'night_messages_count', 0),
    ratio: getNumber(p, 'night_messages_ratio', 0)
  }
}

export function getTop10(p: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const arr = getArray(p, key)
  return arr.map((x) => asRecord(x) ?? {}).filter((x) => Object.keys(x).length > 0)
}

export function pickFirst(arr: Record<string, unknown>[]): Record<string, unknown> | null {
  return arr.length > 0 ? arr[0] : null
}

export function getPersonName(item: Record<string, unknown> | null): string {
  if (!item) return '—'
  const dn = getString(item, 'display_name', '')
  if (dn) return dn
  const pid = getString(item, 'peer_from_id', '')
  if (pid) return pid
  return '—'
}

export function getPersonId(item: Record<string, unknown> | null): string {
  if (!item) return ''
  return getString(item, 'peer_from_id', '')
}

export function getReplyChampion(p: Record<string, unknown>, key: 'who_you_reply_fastest' | 'who_you_ignore_most'):
  | { name: string; seconds: number }
  | null {
  const obj = getRecord(p, key)
  if (!obj) return null
  const name = getString(obj, 'display_name', '') || getString(obj, 'peer_from_id', '')
  const seconds = getNumber(obj, 'median_reply_seconds', 0)
  if (!name) return null
  return { name, seconds }
}

export function getDayNightPerson(
  p: Record<string, unknown>,
  key: 'day_person' | 'night_person'
): { name: string; messages: number } | null {
  const obj = getRecord(p, key)
  if (!obj) return null
  const name = getString(obj, 'display_name', '') || getString(obj, 'peer_from_id', '')
  const messages = getNumber(obj, 'messages', 0)
  if (!name) return null
  return { name, messages }
}

export function getLongestMessage(p: Record<string, unknown>): {
  length: number
  snippet: string
  name: string
} | null {
  const obj = getRecord(p, 'longest_message_sent')
  if (!obj) return null
  const length = getNumber(obj, 'length_chars', 0)
  const snippet = getString(obj, 'snippet', '')
  const name = getString(obj, 'display_name', '') || getString(obj, 'peer_from_id', '')
  if (!snippet && length <= 0) return null
  return { length, snippet, name: name || '—' }
}

export function getLongestStreak(p: Record<string, unknown>): {
  days: number
  start: string
  end: string
} | null {
  const obj = getRecord(p, 'longest_streak_days')
  if (!obj) return null
  const days = getNumber(obj, 'length_days', 0)
  const start = getString(obj, 'start_date', '')
  const end = getString(obj, 'end_date', '')
  if (days <= 0) return null
  return { days, start, end }
}



export function getLongestPersonStreak(
  report: unknown,
  period: PeriodKey
): { lengthDays: number; start: string; end: string; peerFromId: string; displayName: string } | null {
  const p = getPeriod(report, period)
  const s = getRecord(p, 'longest_person_streak')
  if (!s) return null

  const lengthDays = getNumber(s, 'length_days', 0)
  if (!Number.isFinite(lengthDays) || lengthDays <= 0) return null

  const peerFromId = getString(s, 'peer_from_id')
  const displayName = getString(s, 'display_name') || peerFromId || 'Unknown'
  const start = getString(s, 'start_date')
  const end = getString(s, 'end_date')

  return { lengthDays, start, end, peerFromId, displayName }
}
export function getLongestSilence(p: Record<string, unknown>): {
  gapSeconds: number
  chatName: string
} | null {
  const obj = getRecord(p, 'longest_silence_gap')
  if (!obj) return null
  const gapSeconds = getNumber(obj, 'gap_seconds', 0)
  const chatName = getString(obj, 'chat_name', '')
  if (gapSeconds <= 0) return null
  return { gapSeconds, chatName: chatName || '—' }
}

export function getMediaCounts(p: Record<string, unknown>): Record<string, number> {
  const obj = getRecord(p, 'media_counts')
  const get = (k: string) => getNumber(obj ?? {}, k, 0)
  return {
    photo: get('photo'),
    video: get('video'),
    voice: get('voice'),
    sticker: get('sticker'),
    gif: get('gif'),
    file: get('file'),
    other: get('other')
  }
}

export function getEmojiTop(p: Record<string, unknown>): { emoji: string; count: number }[] {
  const arr = getArray(p, 'top_emojis')
  const out: { emoji: string; count: number }[] = []
  for (const it of arr) {
    const obj = asRecord(it)
    if (!obj) continue
    const emoji = asString(obj.emoji, '')
    const count = asNumber(obj.count, 0)
    if (!emoji) continue
    out.push({ emoji, count })
  }
  return out
}

export function getWordCloud(p: Record<string, unknown>): { word: string; weight: number }[] {
  const cloud: Record<string, unknown> | null = getRecord(p, 'word_cloud')
  const out: { word: string; weight: number }[] = []

  if (cloud) {
    for (const [k, v] of Object.entries(cloud)) {
      const w = asNumber(v, 0)
      if (!k || w <= 0) continue
      out.push({ word: k, weight: w })
    }
  }

  // Fallback: top_words: array of {word,count}
  if (out.length === 0) {
    const arr = getArray(p, 'top_words')
    for (const it of arr) {
      const obj = asRecord(it)
      if (!obj) continue
      const word = getString(obj, 'word', '')
      const weight = getNumber(obj, 'count', 0)
      if (!word || weight <= 0) continue
      out.push({ word, weight })
    }
  }

  out.sort((a, b) => b.weight - a.weight)
  return out
}

export function getAchievements(report: unknown): Record<string, unknown>[] {
  if (!isRecord(report)) return []
  const arr = Array.isArray(report.achievements) ? report.achievements : []
  return arr.map((x) => asRecord(x) ?? {}).filter((x) => Object.keys(x).length > 0)
}
