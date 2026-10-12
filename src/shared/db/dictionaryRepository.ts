import { liveQuery } from 'dexie'
import type { Topic, Word } from '../../entities/models'
import { cleanText, normalizeText } from '../utils/text'
import { database, type QazaqDatabase } from './database'
import { ValidationError } from './errors'
import { validateDictionaryFile, type DictionaryFile } from '../../entities/word/dictionaryTransfer'

export interface WordDraft { kazakh: string; russian: string; topicIds: string[] }
export interface DictionarySnapshot { words: Word[]; topics: Topic[] }
export class ConfirmationRequired extends Error {
  constructor(public readonly reasons: string[]) { super(reasons.join(' ')) }
}

function requiredText(value: string, label: string, limit: number) {
  const result = cleanText(value)
  if (!result) throw new ValidationError(`Заполните поле «${label}».`)
  if (result.length > limit) throw new ValidationError(`Поле «${label}» должно быть не длиннее ${limit} символов.`)
  return result
}

function assertUnchanged(current: Word | Topic | undefined, original: Word | Topic) {
  if (!current) throw new ValidationError('Запись уже удалена. Закройте форму и обновите список.')
  if (JSON.stringify(current) !== JSON.stringify(original)) {
    throw new ValidationError('Запись изменилась в другой вкладке. Закройте форму и откройте её заново.')
  }
}

export function createDictionaryRepository(db: QazaqDatabase) {
  const tables = [db.words, db.topics, db.progress, db.sessions]
  async function checkAndInterrupt(reasons: string[], confirmed: boolean) {
    const active = await db.sessions.filter((session) => session.status === 'active').toArray()
    if (active.length) reasons.push('Активные тренировки будут прерваны. Уже сохранённые ответы останутся в истории.')
    if (reasons.length && !confirmed) throw new ConfirmationRequired(reasons)
    const now = Date.now()
    for (const session of active) await db.sessions.update(session.id, { status: 'interrupted', endedAt: now })
  }
  return {
    async snapshot(): Promise<DictionarySnapshot> {
      return db.transaction('r', [db.words, db.topics], async () => ({
        words: await db.words.orderBy('createdAt').toArray(),
        topics: (await db.topics.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      }))
    },
    observe() { return liveQuery(() => this.snapshot()) },
    async exportDictionary(): Promise<DictionaryFile> {
      const snapshot = await this.snapshot()
      const names = new Map(snapshot.topics.map((topic) => [topic.id, topic.name]))
      return validateDictionaryFile({ format: 'qazaq-words-dictionary', version: 1, topics: snapshot.topics.map((topic) => topic.name), words: snapshot.words.map((word) => ({ kazakh: word.kazakh, russian: word.russian, topics: word.topicIds.map((id) => names.get(id)) })) })
    },
    async importDictionary(value: unknown, confirmed = false) {
      const file = validateDictionaryFile(value)
      return db.transaction('rw', tables, async () => {
        await checkAndInterrupt(['Импорт дополнит общий словарь. Совпадающие пары слов и переводов сохранят прогресс; их темы будут объединены. Разные переводы одного казахского слова сохранятся как отдельные записи.'], confirmed)
        const now = Date.now()
        const topics = new Map((await db.topics.toArray()).map((topic) => [normalizeText(topic.name), topic]))
        let addedTopics = 0, addedWords = 0, mergedWords = 0
        for (const name of file.topics) {
          const key = normalizeText(name)
          if (topics.has(key)) continue
          const topic: Topic = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now }
          await db.topics.add(topic); topics.set(key, topic); addedTopics++
        }
        const pairKey = (kazakh: string, russian: string) => JSON.stringify([normalizeText(kazakh), normalizeText(russian)])
        const words = new Map((await db.words.toArray()).map((word) => [pairKey(word.kazakh, word.russian), word]))
        for (const item of file.words) {
          const topicIds = item.topics.map((name) => topics.get(normalizeText(name))!.id)
          const existing = words.get(pairKey(item.kazakh, item.russian))
          if (existing) {
            const merged = [...new Set([...existing.topicIds, ...topicIds])].sort()
            if (JSON.stringify([...existing.topicIds].sort()) !== JSON.stringify(merged)) await db.words.update(existing.id, { topicIds: merged, updatedAt: now })
            mergedWords++
          } else {
            await db.words.add({ id: crypto.randomUUID(), kazakh: item.kazakh, russian: item.russian, topicIds: topicIds.sort(), createdAt: now, updatedAt: now }); addedWords++
          }
        }
        return { addedTopics, addedWords, mergedWords }
      })
    },
    async saveWord(draft: WordDraft, original?: Word, confirmed = false) {
      const kazakh = requiredText(draft.kazakh, 'Казахское слово', 200)
      const russian = requiredText(draft.russian, 'Русский перевод', 200)
      const topicIds = [...new Set(draft.topicIds)].sort()
      return db.transaction('rw', tables, async () => {
        if (original) assertUnchanged(await db.words.get(original.id), original)
        for (const id of topicIds) if (!await db.topics.get(id)) throw new ValidationError('Выбранная тема удалена. Откройте форму заново.')
        const otherWords = (await db.words.toArray()).filter((word) => word.id !== original?.id)
        const sameKazakh = otherWords.filter((word) => normalizeText(word.kazakh) === normalizeText(kazakh))
        if (sameKazakh.some((word) => normalizeText(word.russian) === normalizeText(russian))) {
          throw new ValidationError('Такая пара слова и перевода уже есть в словаре.')
        }
        const textChanged = !!original && (kazakh !== original.kazakh || russian !== original.russian)
        const reasons: string[] = []
        if (sameKazakh.length) reasons.push('Это казахское слово уже есть с другим переводом. Проверьте, что новый перевод действительно нужен.')
        if (textChanged) reasons.push('Изменение текста сбросит прогресс этого слова у всех профилей. Исторические ответы сохранятся.')
        await checkAndInterrupt(reasons, confirmed)
        if (textChanged) await db.progress.where('wordId').equals(original!.id).delete()
        const now = Date.now()
        const word: Word = { id: original?.id ?? crypto.randomUUID(), kazakh, russian, topicIds, createdAt: original?.createdAt ?? now, updatedAt: now }
        await db.words.put(word)
        return word.id
      })
    },
    async removeWord(original: Word, confirmed = false) {
      await db.transaction('rw', tables, async () => {
        assertUnchanged(await db.words.get(original.id), original)
        await checkAndInterrupt(['Слово и его текущий прогресс будут удалены у всех профилей. Исторические ответы сохранятся.'], confirmed)
        await db.progress.where('wordId').equals(original.id).delete()
        await db.words.delete(original.id)
      })
    },
    async saveTopic(value: string, original?: Topic, confirmed = false) {
      const name = requiredText(value, 'Название темы', 80)
      return db.transaction('rw', tables, async () => {
        if (original) assertUnchanged(await db.topics.get(original.id), original)
        if ((await db.topics.toArray()).some((topic) => topic.id !== original?.id && normalizeText(topic.name) === normalizeText(name))) {
          throw new ValidationError('Тема с таким названием уже существует.')
        }
        await checkAndInterrupt([], confirmed)
        const now = Date.now()
        const topic: Topic = { id: original?.id ?? crypto.randomUUID(), name, createdAt: original?.createdAt ?? now, updatedAt: now }
        await db.topics.put(topic)
        return topic.id
      })
    },
    async removeTopic(original: Topic, confirmed = false) {
      await db.transaction('rw', tables, async () => {
        assertUnchanged(await db.topics.get(original.id), original)
        await checkAndInterrupt(['Тема будет снята со всех слов и удалена. Слова, прогресс и история сохранятся.'], confirmed)
        const words = await db.words.where('topicIds').equals(original.id).toArray()
        for (const word of words) await db.words.update(word.id, { topicIds: word.topicIds.filter((id) => id !== original.id), updatedAt: Date.now() })
        await db.topics.delete(original.id)
      })
    },
  }
}

export const dictionaryRepository = createDictionaryRepository(database)
