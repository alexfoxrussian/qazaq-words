import 'fake-indexeddb/auto'
import { createSettingsRepository } from './settingsRepository'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QazaqDatabase } from './database'
import { createProfileRepository } from './profileRepository'
import { createDictionaryRepository, ConfirmationRequired } from './dictionaryRepository'
import { createTrainingRepository } from './trainingRepository'
import { createBackupRepository } from './backupRepository'
import { parseBackup, validateBackup, type Backup } from '../../features/import-export/backup'
let db: QazaqDatabase, repo: ReturnType<typeof createBackupRepository>, saved: Backup
beforeEach(async () => {
  db = new QazaqDatabase(`backup-${crypto.randomUUID()}`); repo = createBackupRepository(db)
  const profiles = createProfileRepository(db); await profiles.initialize()
  const first = await profiles.create('Первый'); await profiles.create('Второй'); await profiles.select(first)
  const dictionary = createDictionaryRepository(db), training = createTrainingRepository(db)
  for (let i = 0; i < 4; i++) await dictionary.saveWord({ kazakh: `Fixture Ә ${i}`, russian: `Вариант ${i}`, topicIds: [] })
  const session = await training.start(first, '', 1000)
  for (let i = 0; i < 4; i++) await training.answer(first, session.id, i, session.queueSnapshots[i].correctIndex, 2000 + i)
  await dictionary.removeWord((await db.words.get(session.queueSnapshots[0].wordId))!, true)
  saved = await repo.export()
})
afterEach(async () => { await db.delete() })
describe('полный backup', () => {
  it('восстанавливает два профиля, историю удалённого слова, прогресс и настройки после перезагрузки', async () => {
    expect(validateBackup(saved).data.answers).toHaveLength(4)
    expect(saved.data.words).toHaveLength(3)
    await expect(repo.restore(saved)).rejects.toBeInstanceOf(ConfirmationRequired)
    await db.settings.update(saved.data.profiles[0].id, { palette: 'violet' })
    await repo.restore(saved, true); db.close(); await db.open()
    expect((await repo.export()).data).toEqual(saved.data)
  })
  it('откатывает очистку всех таблиц при сбое последующей записи', async () => {
    const before = (await repo.export()).data
    const fail = () => { throw new Error('restore failure') }
    db.answers.hook('creating', fail)
    await expect(repo.restore(saved, true)).rejects.toThrow('restore failure')
    db.answers.hook('creating').unsubscribe(fail)
    expect((await repo.export()).data).toEqual(before)
  })
  it('сохраняет и восстанавливает активный сеанс с прежними снимками и ответом', async () => {
    const dictionary = createDictionaryRepository(db), profiles = createProfileRepository(db), training = createTrainingRepository(db)
    await dictionary.saveWord({ kazakh: 'Fixture новый', russian: 'Новый вариант', topicIds: [] })
    const owner = (await profiles.snapshot()).activeProfile!.id
    const session = await training.start(owner, '', 3000)
    await training.answer(owner, session.id, 0, (session.queueSnapshots[0].correctIndex + 1) % 4, 4000)
    const activeBackup = await repo.export()
    await training.interrupt(owner, session.id)
    await repo.restore(activeBackup, true)
    expect((await training.snapshot(owner)).session).toMatchObject({ status: 'active', cursor: 0, answeredCount: 1 })
    expect((await training.snapshot(owner)).session?.queueSnapshots).toEqual(session.queueSnapshots)
    await training.answer(owner, session.id, 0, session.queueSnapshots[0].correctIndex, 5000)
    expect((await training.snapshot(owner)).session).toMatchObject({ cursor: 1, answeredCount: 1, correctCount: 0 })
    expect((await training.snapshot(owner)).answers[0].isCorrect).toBe(false)
    expect(validateBackup(await repo.export()).data.sessions.find((item) => item.id === session.id)?.cursor).toBe(1)
  })
  it.each(['version', 'duplicate', 'reference', 'index', 'correctness', 'counter', 'options', 'settings', 'progress', 'meta'])('отклоняет повреждение %s без записи', async (kind) => {
    const invalid = structuredClone(saved)
    switch (kind) {
      case 'version': Object.assign(invalid, { schemaVersion: 2 }); break
      case 'duplicate': invalid.data.profiles.push(invalid.data.profiles[0]); break
      case 'reference': invalid.data.answers[0].profileId = 'missing'; break
      case 'index': invalid.data.answers[0].selectedIndex = 4; break
      case 'correctness': invalid.data.answers[0].isCorrect = false; break
      case 'counter': invalid.data.sessions[0].answeredCount = 3; break
      case 'options': invalid.data.sessions[0].queueSnapshots[0].options[1] = invalid.data.sessions[0].queueSnapshots[0].options[0]; break
      case 'settings': invalid.data.settings = []; break
      case 'progress': invalid.data.progress[0].stage = 6; break
      case 'meta': invalid.data.appMeta = []; break
    }
    await expect(repo.restore(invalid, true)).rejects.toThrow('Неверная резервная копия')
    expect((await repo.export()).data).toEqual(saved.data)
  })
  it('отклоняет повреждённый JSON, превышение размера и формат отдельного словаря', () => {
    expect(() => parseBackup('{')).toThrow('JSON')
    expect(() => parseBackup(' '.repeat(25 * 1024 * 1024 + 1))).toThrow('25 MiB')
    expect(() => validateBackup({ format: 'qazaq-words-dictionary' })).toThrow('отдельный импорт')
  })
  it('разрешает пустую базу с корректными метаданными для первого запуска', async () => {
    const blank = { ...saved, data: { profiles: [], words: [], topics: [], progress: [], sessions: [], answers: [], settings: [], appMeta: [{ key: 'activeProfileId', value: null }, { key: 'initialized', value: true }] } }
    await repo.restore(blank, true)
    expect((await createProfileRepository(db).snapshot()).activeProfile).toBeNull()
    expect((await repo.export()).data.profiles).toHaveLength(0)
  })
})

it('старый backup получает стандартный шрифт без изменения входного объекта', async () => {
  const legacy = structuredClone(saved)
  for (const settings of legacy.data.settings) Reflect.deleteProperty(settings, 'fontSize')
  const upgraded = validateBackup(legacy)
  expect(upgraded.data.settings.every((settings) => settings.fontSize === 'standard')).toBe(true)
  expect('fontSize' in legacy.data.settings[0]).toBe(false)
  await repo.restore(legacy, true)
  expect((await repo.export()).data.settings).toEqual(upgraded.data.settings)
  const invalid = structuredClone(saved)
  Object.assign(invalid.data.settings[0], { fontSize: 'huge' })
  await expect(repo.restore(invalid, true)).rejects.toThrow('шрифта')
  expect((await repo.export()).data.settings).toEqual(upgraded.data.settings)
})


it('backup переносит фото профиля и отклоняет внешние и SVG-изображения без записи', async () => {
  const id = saved.data.profiles[0].id
  const photo = 'data:image/jpeg;base64,/9j/2Q=='
  await createProfileRepository(db).setPhoto(id, photo)
  const backup = await repo.export()
  await createProfileRepository(db).setPhoto(id, null)
  await repo.restore(backup, true)
  expect((await db.profiles.get(id))?.avatarDataUrl).toBe(photo)
  for (const value of ['https://example.com/avatar.png', 'data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,not-base64']) {
    const invalid = structuredClone(backup)
    invalid.data.profiles[0].avatarDataUrl = value
    await expect(repo.restore(invalid, true)).rejects.toThrow('фото')
    expect((await db.profiles.get(id))?.avatarDataUrl).toBe(photo)
  }
})


it('старый Modern New из backup становится Modern без изменения исходного файла', async () => {
  const profiles = createProfileRepository(db), settings = createSettingsRepository(db)
  const owner = (await profiles.snapshot()).activeProfile!.id
  await settings.save(owner, { colorMode: 'dark', palette: 'gray', visualStyle: 'modern' })
  const backup = await repo.export()
  await settings.save(owner, { colorMode: 'light', palette: 'blue', visualStyle: 'modern' })
  expect((await profiles.snapshot()).settings?.visualStyle).toBe('modern')
  const legacyBackup = structuredClone(backup)
  const legacySettings = legacyBackup.data.settings.find((item) => item.profileId === owner)! as { visualStyle: string }
  legacySettings.visualStyle = 'modern-new'
  await repo.restore(legacyBackup, true); db.close(); await db.open()
  expect(legacySettings.visualStyle).toBe('modern-new')
  expect((await profiles.snapshot()).settings?.visualStyle).toBe('modern')
  expect((await db.settings.toArray()).find((item) => item.profileId !== owner)?.visualStyle).toBe('modern')
  expect((await profiles.snapshot()).settings?.palette).toBe('gray')
  expect((await repo.export()).data.answers).toEqual(backup.data.answers)
})
