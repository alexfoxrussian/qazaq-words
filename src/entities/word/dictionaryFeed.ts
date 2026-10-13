import type { DictionaryFeedState } from '../models'
import { ValidationError } from '../../shared/db/errors'
import { normalizeText } from '../../shared/utils/text'

export const DEFAULT_DICTIONARY_URL = 'https://raw.githubusercontent.com/alexfoxrussian/qazaq-words/main/imports/general-dictionary.json'
export const LEGACY_DICTIONARY_URL = 'https://raw.githubusercontent.com/alexfoxrussian/qazaq-words/main/imports/user-dictionary.json'
export const pairKey = (kazakh: string, russian: string) => JSON.stringify([normalizeText(kazakh), normalizeText(russian)])
export const linkKey = (kazakh: string, russian: string, topic: string) => JSON.stringify([normalizeText(kazakh), normalizeText(russian), normalizeText(topic)])

export function validateFeedState(value: unknown): DictionaryFeedState {
  const fail = (): never => { throw new ValidationError('Неверные метаданные общего словаря.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const item = value as Record<string, unknown>
  if (typeof item.source !== 'string' || item.source.length > 2048) return fail()
  try { const url = new URL(item.source); if (url.protocol !== 'https:' || url.username || url.password) return fail() } catch { return fail() }
  if (!Number.isSafeInteger(item.checkedAt) || (item.checkedAt as number) < 0) return fail()
  for (const [field, count] of [['seenWords', 2], ['seenTopics', 0], ['seenLinks', 3]] as const) {
    const list = item[field]
    if (!Array.isArray(list) || list.length > 200000 || new Set(list).size !== list.length) return fail()
    for (const key of list) {
      if (typeof key !== 'string' || !key.trim() || key.length > 1100) return fail()
      if (!count) { if (key.length > 80) return fail(); continue }
      let parts: unknown
      try { parts = JSON.parse(key) } catch { return fail() }
      if (!Array.isArray(parts) || parts.length !== count || parts.some((part, index) => typeof part !== 'string' || !part.trim() || part.length > (index === 2 ? 80 : 200))) return fail()
    }
  }
  return value as DictionaryFeedState
}
