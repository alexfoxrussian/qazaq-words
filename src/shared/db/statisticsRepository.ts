import { liveQuery } from 'dexie'
import { summarizeStatistics, type Period } from '../../entities/answer/statistics'
import { database, type QazaqDatabase } from './database'
import { ValidationError } from './errors'

export function createStatisticsRepository(db: QazaqDatabase) {
  return {
    async snapshot(profileId: string, period: Period, now = Date.now()) {
      return db.transaction('r', [db.profiles, db.words, db.progress, db.answers, db.sessions], async () => {
        if (!await db.profiles.get(profileId)) throw new ValidationError('Профиль удалён. Выберите другой профиль.')
        const [words, progress, answers, sessions] = await Promise.all([
          db.words.toArray(), db.progress.where('profileId').equals(profileId).toArray(),
          db.answers.where('profileId').equals(profileId).toArray(), db.sessions.where('profileId').equals(profileId).toArray(),
        ])
        return summarizeStatistics(words, progress, answers, sessions, period, now)
      })
    },
    observe(profileId: string, period: Period) { return liveQuery(() => this.snapshot(profileId, period)) },
  }
}
export const statisticsRepository = createStatisticsRepository(database)
