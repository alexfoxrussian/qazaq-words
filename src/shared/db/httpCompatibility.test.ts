import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { QazaqDatabase } from './database'
import { createProfileRepository } from './profileRepository'
import { createDictionaryRepository } from './dictionaryRepository'
import { createTrainingRepository } from './trainingRepository'
import { createGuestRepository } from '../../features/training/guestRepository'
import { createBackupRepository } from './backupRepository'
import { validateBackup } from '../../features/import-export/backup'

let db: QazaqDatabase | undefined
afterEach(async () => { vi.unstubAllGlobals(); await db?.delete() })

it('creates a profile, imports words and records profile/guest answers without randomUUID on LAN HTTP', async () => {
  const originalCrypto = crypto
  db = new QazaqDatabase(`http-${originalCrypto.randomUUID()}`)
  vi.stubGlobal('crypto', { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) })
  const profiles = createProfileRepository(db)
  await profiles.initialize()
  const profileId = await profiles.create('Телефон')
  const dictionary = createDictionaryRepository(db)
  await dictionary.importDictionary({
    format: 'qazaq-words-dictionary', version: 1, topics: ['Тест'],
    words: Array.from({ length: 4 }, (_, i) => ({ kazakh: `Сөз Ә ${i}`, russian: `Перевод ${i}`, topics: ['Тест'] })),
  }, true)
  const training = createTrainingRepository(db)
  const session = await training.start(profileId, '')
  for (let i = 0; i < 4; i++) await training.answer(profileId, session.id, i, session.queueSnapshots[i].correctIndex)
  const guest = createGuestRepository(dictionary)
  const guestSession = await guest.start('guest', '')
  const guestAnswer = await guest.answer('guest', guestSession.id, 0, guestSession.queueSnapshots[0].correctIndex)
  const backup = validateBackup(await createBackupRepository(db).export())
  expect(backup.data.answers).toHaveLength(4)
  expect(backup.data.progress).toHaveLength(4)
  expect(backup.data.sessions[0].status).toBe('completed')
  const ids = [profileId, session.id, guestSession.id, guestAnswer.id,
    ...backup.data.words.map((word) => word.id), ...backup.data.topics.map((topic) => topic.id),
    ...backup.data.answers.map((answer) => answer.id)]
  expect(new Set(ids).size).toBe(ids.length)
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
