import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { QazaqDatabase } from '../../shared/db/database'
import { createDictionaryRepository } from '../../shared/db/dictionaryRepository'
import { createGuestRepository } from './guestRepository'

let db: QazaqDatabase
beforeEach(async () => {
  db = new QazaqDatabase(`guest-${crypto.randomUUID()}`)
  await db.words.bulkAdd(['ағаш', 'әже', 'бала', 'алма'].map((kazakh, index) => ({ id: String(index), kazakh, russian: ['дерево', 'бабушка', 'ребёнок', 'яблоко'][index], topicIds: [], createdAt: index, updatedAt: index })))
})
afterEach(async () => { await db.delete() })

it('completes a guest session with duplicate-answer protection and never writes results', async () => {
  const guest = createGuestRepository(createDictionaryRepository(db))
  const session = await guest.start('guest', '')
  for (let i = 0; i < session.targetCount; i++) {
    const answer = await guest.answer('guest', session.id, i, session.queueSnapshots[i].correctIndex)
    expect(await guest.answer('guest', session.id, i, session.queueSnapshots[i].correctIndex)).toEqual(answer)
  }
  expect((await guest.snapshot()).session).toMatchObject({ status: 'completed', answeredCount: 4, correctCount: 4 })
  expect(await Promise.all([db.profiles.count(), db.progress.count(), db.answers.count(), db.sessions.count(), db.settings.count()])).toEqual([0, 0, 0, 0, 0])
  expect(await db.words.count()).toBe(4)
  guest.reset()
  expect(await guest.snapshot()).toEqual({ session: null, answers: [] })
})

it('keeps guest settings and interruption in memory and a fresh instance starts empty', async () => {
  const dictionary = createDictionaryRepository(db)
  const guest = createGuestRepository(dictionary)
  await guest.setSessionLength('guest', 2)
  const session = await guest.start('guest', '')
  expect(session.targetCount).toBe(2)
  await guest.interrupt('guest', session.id)
  expect((await guest.snapshot()).session?.status).toBe('interrupted')
  expect(await createGuestRepository(dictionary).snapshot()).toEqual({ session: null, answers: [] })
  expect(await db.sessions.count()).toBe(0)
})

it('waits for a correction on the final word and retains the first-attempt error', async () => {
  const guest = createGuestRepository(createDictionaryRepository(db))
  await guest.setSessionLength('guest', 1)
  const session = await guest.start('guest', '')
  const correct = session.queueSnapshots[0].correctIndex
  await guest.answer('guest', session.id, 0, (correct + 1) % 4)
  await guest.answer('guest', session.id, 0, (correct + 2) % 4)
  expect((await guest.snapshot()).session).toMatchObject({ status: 'active', cursor: 0, answeredCount: 1 })
  await guest.answer('guest', session.id, 0, correct)
  expect((await guest.snapshot()).session).toMatchObject({ status: 'completed', cursor: 1, answeredCount: 1, correctCount: 0 })
  expect((await guest.snapshot()).answers).toHaveLength(1)
  expect(await db.answers.count()).toBe(0)
})
