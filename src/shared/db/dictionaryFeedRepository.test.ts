import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { QazaqDatabase } from './database'
import { createDictionaryFeedRepository } from './dictionaryFeedRepository'
import { createProfileRepository } from './profileRepository'
import { createBackupRepository } from './backupRepository'
import { validateBackup } from '../../features/import-export/backup'
import bootstrap from '../../../imports/general-dictionary.json'
import { DEFAULT_DICTIONARY_URL, LEGACY_DICTIONARY_URL } from '../../entities/word/dictionaryFeed'

let db: QazaqDatabase
beforeEach(async () => {
  db = new QazaqDatabase(`feed-${crypto.randomUUID()}`)
  await createProfileRepository(db).initialize()
})
afterEach(async () => { await db.delete() })
const feed = { format: 'qazaq-words-dictionary', version: 1, topics: ['Природа'], words: [
  { kazakh: 'ағаш', russian: 'дерево', topics: ['Природа'] },
  { kazakh: 'алма', russian: 'яблоко', topics: [] },
] }
const apply = (value: unknown = feed) => createDictionaryFeedRepository(db).apply(value, DEFAULT_DICTIONARY_URL)

it('первый гостевой запуск получает настоящий словарь без создания профиля или истории', async () => {
  await apply(bootstrap)
  expect(await db.words.count()).toBe(7703)
  expect(await db.topics.count()).toBe(23)
  expect(await db.profiles.count()).toBe(0)
  expect(await db.answers.count()).toBe(0)
  expect(await db.progress.count()).toBe(0)
}, 20000)

it('смена источника сохраняет локальные удаления, снятые теги и прогресс', async () => {
  const repository = createDictionaryFeedRepository(db)
  await repository.apply(feed, LEGACY_DICTIONARY_URL)
  const tree = (await db.words.toArray()).find((word) => word.kazakh === 'ағаш')!
  const apple = (await db.words.toArray()).find((word) => word.kazakh === 'алма')!
  const profileId = await createProfileRepository(db).create('Первый')
  await db.progress.add({ profileId, wordId: tree.id, stage: 3, dueAt: 1000, lastAnsweredAt: 100, correctCount: 3, incorrectCount: 0 })
  const progress = await db.progress.toArray()
  await db.words.update(tree.id, { topicIds: [] })
  await db.words.delete(apple.id)
  const updated = { ...feed, words: [...feed.words, { kazakh: 'су', russian: 'вода', topics: ['Природа'] }] }
  await repository.apply(updated, DEFAULT_DICTIONARY_URL, 0, true)
  expect(await db.words.count()).toBe(2)
  expect((await db.words.get(tree.id))?.topicIds).toEqual([])
  expect(await db.words.get(apple.id)).toBeUndefined()
  expect(await db.progress.toArray()).toEqual(progress)
  await repository.apply(updated, DEFAULT_DICTIONARY_URL, 0, true)
  expect(await db.words.count()).toBe(2)
})

it('одновременные обновления не дублируют слова и сохраняют прогресс обоих профилей', async () => {
  await apply()
  const word = (await db.words.toArray())[0]
  const profiles = createProfileRepository(db)
  for (const name of ['Первый', 'Второй']) {
    const profileId = await profiles.create(name)
    await db.progress.add({ profileId, wordId: word.id, stage: 3, dueAt: 1000, lastAnsweredAt: 100, correctCount: 3, incorrectCount: 0 })
  }
  const active = await db.appMeta.get('activeProfileId')
  const profileId = active?.key === 'activeProfileId' ? active.value! : ''
  const session = { id: 'active-session', profileId, status: 'active' as const, startedAt: 0, targetCount: 1, answeredCount: 0, correctCount: 0, cursor: 0, queueSnapshots: [{ wordId: word.id, kazakh: word.kazakh, russian: word.russian, options: [word.russian, 'a', 'b', 'c'], correctIndex: 0 }] }
  await db.sessions.add(session)
  const progress = await db.progress.toArray()
  await db.words.add({ id: 'local', kazakh: 'жер', russian: 'земля', topicIds: [], createdAt: 0, updatedAt: 0 })
  await Promise.all([apply(), apply()])
  expect(await db.words.count()).toBe(3)
  expect(await db.progress.toArray()).toEqual(progress)
  expect(await db.words.get(word.id)).toEqual(word)
  expect(await db.sessions.get(session.id)).toEqual(session)
})

it('не возвращает удалённые слова, локально изменённый перевод и снятые темы', async () => {
  await apply()
  const words = await db.words.toArray()
  const tree = words.find((word) => word.kazakh === 'ағаш')!
  const apple = words.find((word) => word.kazakh === 'алма')!
  await db.words.update(tree.id, { topicIds: [] })
  await db.words.update(apple.id, { russian: 'яблочко' })
  await apply()
  expect((await db.words.get(tree.id))?.topicIds).toEqual([])
  expect(await db.words.count()).toBe(2)
  expect((await db.words.get(apple.id))?.russian).toBe('яблочко')
  await db.words.delete(tree.id)
  await db.topics.clear()
  await apply()
  expect(await db.words.count()).toBe(1)
  expect(await db.topics.count()).toBe(0)
})

it('новые внешние темы добавляются, удаление из внешнего файла не удаляет локальные слова', async () => {
  await apply()
  await apply({ ...feed, topics: [...feed.topics, 'Еда'], words: [{ ...feed.words[0], topics: ['Природа', 'Еда'] }] })
  expect(await db.words.count()).toBe(2)
  const tree = (await db.words.toArray()).find((word) => word.kazakh === 'ағаш')!
  expect(tree.topicIds).toHaveLength(2)
})

it('откатывает весь импорт при ошибке записи и отклоняет повреждённый JSON до записи', async () => {
  db.words.hook('creating', (_key, word) => { if (word.kazakh === 'алма') throw new Error('disk failure') })
  await expect(apply()).rejects.toThrow('disk failure')
  expect(await db.words.count()).toBe(0)
  expect(await db.topics.count()).toBe(0)
  expect(await db.appMeta.get('dictionaryFeed')).toBeUndefined()
  await expect(apply({ ...feed, words: [{ ...feed.words[0], topics: ['несуществующая'] }] })).rejects.toThrow()
  expect(await db.words.count()).toBe(0)
})

it('backup сохраняет намерение удаления; старые backup принимаются, повреждённые метаданные отклоняются', async () => {
  await apply()
  await db.words.delete((await db.words.toArray())[0].id)
  const data = {
    profiles: [], settings: [], progress: [], sessions: [], answers: [],
    words: await db.words.toArray(), topics: await db.topics.toArray(), appMeta: await db.appMeta.toArray(),
  }
  const backup = { format: 'qazaq-words-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), data }
  expect(validateBackup(backup).data.appMeta).toEqual(data.appMeta)
  expect(() => validateBackup({ ...backup, data: { ...data, appMeta: data.appMeta.filter((item) => item.key !== 'dictionaryFeed') } })).not.toThrow()
  expect(() => validateBackup({ ...backup, data: { ...data, appMeta: data.appMeta.map((item) => item.key === 'dictionaryFeed' ? { ...item, value: { ...item.value, seenWords: ['bad'] } } : item) } })).toThrow()
  await db.words.clear()
  await createBackupRepository(db).restore(backup, true)
  await apply()
  expect(await db.words.count()).toBe(1)
})

