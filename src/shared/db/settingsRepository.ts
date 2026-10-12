import type { ProfileSettings } from '../../entities/models'
import { database, type QazaqDatabase } from './database'
import { ValidationError } from './errors'
export function createSettingsRepository(db: QazaqDatabase) {
  return {
    async save(profileId: string, patch: Pick<ProfileSettings, 'colorMode' | 'palette' | 'visualStyle'> & Partial<Pick<ProfileSettings, 'fontSize'>>) {
      if (!['light', 'dark', 'system'].includes(patch.colorMode) || !['blue', 'emerald', 'amber', 'violet'].includes(patch.palette) || !['modern', 'retro', 'pixel', 'orient'].includes(patch.visualStyle)) throw new ValidationError('Неверное оформление.')
      if (patch.fontSize !== undefined && !['standard', 'large', 'maximum'].includes(patch.fontSize)) throw new ValidationError('Неверный размер шрифта.')
      await db.transaction('rw', [db.profiles, db.appMeta, db.settings], async () => {
        if ((await db.appMeta.get('activeProfileId'))?.value !== profileId || !await db.profiles.get(profileId)) throw new ValidationError('Активный профиль изменился.')
        if (!await db.settings.get(profileId)) throw new ValidationError('Настройки не найдены.')
        await db.settings.update(profileId, patch)
      })
    },
  }
}
export const settingsRepository = createSettingsRepository(database)
