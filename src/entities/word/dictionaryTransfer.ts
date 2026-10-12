import { cleanText, normalizeText } from '../../shared/utils/text'
import { ValidationError } from '../../shared/db/errors'

export interface DictionaryFile {
  format: 'qazaq-words-dictionary'
  version: 1
  topics: string[]
  words: { kazakh: string; russian: string; topics: string[] }[]
}
export const MAX_DICTIONARY_BYTES = 25 * 1024 * 1024
export function validateDictionaryFile(value: unknown): DictionaryFile {
  const fail = (): never => { throw new ValidationError('Неверный формат словаря. Нужен JSON qazaq-words-dictionary версии 1.') }
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)
  const text = (item: unknown, limit: number): string => {
    if (typeof item !== 'string') return fail()
    const result = cleanText(item)
    if (!result || result.length > limit) return fail()
    return result
  }
  if (!object(value) || value.format !== 'qazaq-words-dictionary' || value.version !== 1 || !Array.isArray(value.topics) || !Array.isArray(value.words)) return fail()
  const topics = value.topics.map((item) => text(item, 80))
  const keys = new Set(topics.map(normalizeText))
  if (keys.size !== topics.length) throw new ValidationError('В файле повторяются названия тем.')
  const pairs = new Set<string>()
  const words = value.words.map((item) => {
    if (!object(item) || !Array.isArray(item.topics)) return fail()
    const kazakh = text(item.kazakh, 200), russian = text(item.russian, 200)
    const wordTopics = item.topics.map((topic) => text(topic, 80))
    if (new Set(wordTopics.map(normalizeText)).size !== wordTopics.length || wordTopics.some((topic) => !keys.has(normalizeText(topic)))) throw new ValidationError('У слова указана неизвестная или повторяющаяся тема.')
    const key = JSON.stringify([normalizeText(kazakh), normalizeText(russian)])
    if (pairs.has(key)) throw new ValidationError('В файле повторяется пара слова и перевода.')
    pairs.add(key)
    return { kazakh, russian, topics: wordTopics }
  })
  return { format: 'qazaq-words-dictionary', version: 1, topics, words }
}
export function parseDictionaryFile(text: string): DictionaryFile {
  if (new TextEncoder().encode(text).length > MAX_DICTIONARY_BYTES) throw new ValidationError('Файл превышает 25 MiB.')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new ValidationError('Не удалось прочитать JSON. Проверьте файл.') }
  return validateDictionaryFile(value)
}
