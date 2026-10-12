import { validateAvatar } from '../../entities/profile/photo'
import { liveQuery } from 'dexie'
import { defaultSettings, type Profile, type ProfileSettings } from '../../entities/models'
import { database, type QazaqDatabase } from './database'
import { ActiveSessionError, ValidationError } from './errors'

export interface ProfileSnapshot {
  profiles: Profile[]
  activeProfile: Profile | null
  settings: ProfileSettings | null
}

function validateName(value: string) {
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (!name) throw new ValidationError('Введите имя профиля.')
  if (name.length > 80) throw new ValidationError('Имя профиля должно быть не длиннее 80 символов.')
  return name
}

export function createProfileRepository(db: QazaqDatabase) {
  const profileTables = [db.profiles, db.settings, db.appMeta, db.sessions]
  async function ensureProfile(id: string) {
    if (!await db.profiles.get(id)) throw new ValidationError('Профиль больше не существует. Выберите другой профиль.')
  }
  async function assertCanSwitch(nextId: string | null, confirmed: boolean) {
    const meta = await db.appMeta.get('activeProfileId')
    if (typeof meta?.value === 'string' && meta.value !== nextId) {
      const active = await db.sessions.where('[profileId+status]').equals([meta.value, 'active']).toArray()
      if (active.length && !confirmed) throw new ActiveSessionError()
      for (const session of active) await db.sessions.update(session.id, { status: 'interrupted', endedAt: Date.now() })
    }
  }
  return {
    async initialize() {
      // Explicit open lets the retry button attempt opening again after a failure.
      await db.open()
      await db.transaction('rw', profileTables, async () => {
        const meta = await db.appMeta.get('activeProfileId')
        if (!meta || (typeof meta.value === 'string' && !await db.profiles.get(meta.value))) {
          await db.appMeta.put({ key: 'activeProfileId', value: null })
        }
        for (const profile of await db.profiles.toArray()) {
          if (!await db.settings.get(profile.id)) await db.settings.add(defaultSettings(profile.id))
        }
        await db.appMeta.put({ key: 'initialized', value: true })
      })
    },
    async snapshot(): Promise<ProfileSnapshot> {
      return db.transaction('r', [db.profiles, db.settings, db.appMeta], async () => {
        const profiles = await db.profiles.orderBy('createdAt').toArray()
        const meta = await db.appMeta.get('activeProfileId')
        const activeProfile = profiles.find((profile) => profile.id === meta?.value) ?? null
        return { profiles, activeProfile, settings: activeProfile ? await db.settings.get(activeProfile.id) ?? null : null }
      })
    },
    observe() { return liveQuery(() => this.snapshot()) },
    async create(value: string, confirmed = false) {
      const name = validateName(value)
      const id = crypto.randomUUID()
      const now = Date.now()
      await db.transaction('rw', profileTables, async () => {
        await assertCanSwitch(id, confirmed)
        await db.profiles.add({ id, name, createdAt: now, updatedAt: now })
        await db.settings.add(defaultSettings(id))
        await db.appMeta.put({ key: 'activeProfileId', value: id })
      })
      return id
    },
    async select(id: string, confirmed = false) {
      await db.transaction('rw', profileTables, async () => {
        await ensureProfile(id)
        await assertCanSwitch(id, confirmed)
        await db.appMeta.put({ key: 'activeProfileId', value: id })
      })
    },
    async logout(confirmed = false) {
      await db.transaction('rw', profileTables, async () => {
        await assertCanSwitch(null, confirmed)
        await db.appMeta.put({ key: 'activeProfileId', value: null })
      })
    },
    async rename(id: string, value: string) {
      const name = validateName(value)
      await db.transaction('rw', db.profiles, async () => {
        await ensureProfile(id)
        await db.profiles.update(id, { name, updatedAt: Date.now() })
      })
    },
    async setPhoto(id: string, avatarDataUrl: string | null) {
      if (avatarDataUrl !== null) validateAvatar(avatarDataUrl)
      await db.transaction('rw', db.profiles, async () => {
        await ensureProfile(id)
        await db.profiles.update(id, { avatarDataUrl: avatarDataUrl ?? undefined, updatedAt: Date.now() })
      })
    },
    async remove(id: string) {
      await db.transaction('rw', [...profileTables, db.progress, db.answers], async () => {
        await ensureProfile(id)
        await db.progress.where('profileId').equals(id).delete()
        await db.answers.where('profileId').equals(id).delete()
        await db.sessions.where('profileId').equals(id).delete()
        await db.settings.delete(id)
        await db.profiles.delete(id)
        const meta = await db.appMeta.get('activeProfileId')
        if (meta?.value === id) await db.appMeta.put({ key: 'activeProfileId', value: null })
      })
    },
  }
}

export const profileRepository = createProfileRepository(database)
