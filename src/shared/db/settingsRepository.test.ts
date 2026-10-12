import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { QazaqDatabase } from './database'
import { createProfileRepository } from './profileRepository'
import { createSettingsRepository } from './settingsRepository'
it('оформление сохраняется отдельно, прежняя длина не меняется и сбой откатывает настройки', async () => {
  const db = new QazaqDatabase(`appearance-${crypto.randomUUID()}`)
  try {
    const profiles = createProfileRepository(db); await profiles.initialize()
    const first = await profiles.create('Первый'), second = await profiles.create('Второй')
    const settings = createSettingsRepository(db)
    await settings.save(second, { colorMode: 'dark', palette: 'amber', visualStyle: 'pixel', fontSize: 'maximum' })
    await expect(settings.save(first, { colorMode: 'light', palette: 'blue', visualStyle: 'modern' })).rejects.toThrow('профиль')
    db.close(); await db.open()
    expect(await db.settings.get(second)).toMatchObject({ colorMode: 'dark', palette: 'amber', visualStyle: 'pixel', fontSize: 'maximum', sessionLength: 10 })
    expect((await db.settings.get(first))?.fontSize).toBe('standard')
    await expect(settings.save(second, { colorMode: 'dark', palette: 'amber', visualStyle: 'pixel', fontSize: 'invalid' as 'standard' })).rejects.toThrow('шрифта')
    const fail = () => { throw new Error('settings failure') }
    db.settings.hook('updating', fail)
    await expect(settings.save(second, { colorMode: 'light', palette: 'blue', visualStyle: 'modern' })).rejects.toThrow('settings failure')
    db.settings.hook('updating').unsubscribe(fail)
    expect((await db.settings.get(second))?.palette).toBe('amber')
  } finally { await db.delete() }
})

it('миграция v1 сохраняет профиль и настройки, добавляя стандартный шрифт', async () => {
  const name = `migration-${crypto.randomUUID()}`
  const legacy = new Dexie(name)
  legacy.version(1).stores({ profiles: 'id, createdAt', words: 'id, createdAt, *topicIds', topics: 'id, name', progress: '[profileId+wordId], profileId, wordId, [profileId+dueAt]', sessions: 'id, profileId, [profileId+startedAt], [profileId+status]', answers: 'id, profileId, sessionId, [profileId+answeredAt], &[sessionId+questionIndex]', settings: 'profileId', appMeta: 'key' })
  await legacy.table('profiles').add({ id: 'p', name: 'Профиль', createdAt: 1, updatedAt: 1 })
  const old = { profileId: 'p', colorMode: 'dark', palette: 'violet', visualStyle: 'orient', sessionLength: 30 }
  await legacy.table('settings').add(old); legacy.close()
  const db = new QazaqDatabase(name)
  try {
    await db.open()
    expect(await db.settings.get('p')).toEqual({ ...old, fontSize: 'standard' })
    expect((await db.profiles.get('p'))?.name).toBe('Профиль')
  } finally { await db.delete() }
})


it('миграция v3→v4 переименовывает Modern New, сохраняя профили, слова и другие стили', async () => {
  const name = `style-migration-${crypto.randomUUID()}`
  const legacy = new Dexie(name)
  legacy.version(3).stores({ profiles: 'id, createdAt', words: 'id, createdAt, *topicIds', topics: 'id, name', progress: '[profileId+wordId], profileId, wordId, [profileId+dueAt]', sessions: 'id, profileId, [profileId+startedAt], [profileId+status]', answers: 'id, profileId, sessionId, [profileId+answeredAt], &[sessionId+questionIndex]', settings: 'profileId', appMeta: 'key' })
  await legacy.table('profiles').add({ id: 'p', name: 'Сохранённый', createdAt: 1, updatedAt: 1 })
  await legacy.table('words').add({ id: 'word', kazakh: 'әже', russian: 'бабушка', topicIds: [], createdAt: 1, updatedAt: 1 })
  await legacy.table('settings').bulkAdd([
    { profileId: 'p', visualStyle: 'modern-new', fontSize: 'large', palette: 'emerald' },
    { profileId: 'retro', visualStyle: 'retro' },
    { profileId: 'modern', visualStyle: 'modern' },
  ])
  legacy.close()
  const db = new QazaqDatabase(name)
  try {
    await db.open()
    expect(await db.settings.get('p')).toMatchObject({ visualStyle: 'modern', fontSize: 'large', palette: 'emerald' })
    expect((await db.settings.get('retro'))?.visualStyle).toBe('retro')
    expect((await db.settings.get('modern'))?.visualStyle).toBe('modern')
    expect((await db.profiles.get('p'))?.name).toBe('Сохранённый')
    expect((await db.words.get('word'))?.kazakh).toBe('әже')
  } finally { await db.delete() }
})
