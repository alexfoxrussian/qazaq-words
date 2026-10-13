import { createId } from '../utils/id'
import { liveQuery } from 'dexie'
import type { Answer, TrainingSession } from '../../entities/models'
import { buildQueue, evaluateAnswer, scheduleNextReview } from '../../entities/training/domain'
import { database, type QazaqDatabase } from './database'
import { ValidationError } from './errors'

export interface TrainingSnapshot { session: TrainingSession | null; answers: Answer[] }

export function createTrainingRepository(db: QazaqDatabase) {
  async function assertOwner(profileId: string) {
    if (!await db.profiles.get(profileId) || (await db.appMeta.get('activeProfileId'))?.value !== profileId) {
      throw new ValidationError('Активный профиль изменился. Откройте тренировку заново.')
    }
  }
  async function plan(profileId: string, topicId: string, now: number, random: () => number) {
    if (topicId && !await db.topics.get(topicId)) throw new ValidationError('Выбранная тема удалена. Выберите другую тему.')
    const settings = await db.settings.get(profileId)
    return buildQueue(await db.words.toArray(), await db.progress.where('profileId').equals(profileId).toArray(), topicId, settings?.sessionLength === 0 ? Infinity : settings?.sessionLength ?? 10, now, random)
  }
  return {
    async setSessionLength(profileId: string, sessionLength: number) {
      if (!Number.isSafeInteger(sessionLength) || sessionLength < 0) throw new ValidationError('Укажите целое положительное число вопросов.')
      await db.transaction('rw', [db.profiles, db.appMeta, db.settings], async () => {
        await assertOwner(profileId)
        if (!await db.settings.get(profileId)) throw new ValidationError('Настройки профиля не найдены.')
        await db.settings.update(profileId, { sessionLength })
      })
    },
    async prepare(profileId: string, topicId: string, now = Date.now()) {
      return db.transaction('r', [db.profiles, db.appMeta, db.words, db.topics, db.settings, db.progress], async () => {
        await assertOwner(profileId)
        return { ...await plan(profileId, topicId, now, () => 0.5), topics: (await db.topics.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'ru')) }
      })
    },
    observePreparation(profileId: string, topicId: string) { return liveQuery(() => this.prepare(profileId, topicId)) },
    async snapshot(profileId: string): Promise<TrainingSnapshot> {
      return db.transaction('r', [db.sessions, db.answers], async () => {
        const active = await db.sessions.where('[profileId+status]').equals([profileId, 'active']).first()
        const session = active ?? await db.sessions.where('[profileId+startedAt]').between([profileId, -Infinity], [profileId, Infinity]).last() ?? null
        const answers = session ? (await db.answers.where('sessionId').equals(session.id).toArray()).sort((a, b) => a.questionIndex - b.questionIndex) : []
        return { session, answers }
      })
    },
    observe(profileId: string) { return liveQuery(() => this.snapshot(profileId)) },
    async start(profileId: string, topicId: string, now = Date.now()) {
      return db.transaction('rw', [db.profiles, db.appMeta, db.words, db.topics, db.settings, db.progress, db.sessions], async () => {
        await assertOwner(profileId)
        if (await db.sessions.where('[profileId+status]').equals([profileId, 'active']).count()) throw new ValidationError('Уже есть активная тренировка. Продолжите её или завершите.')
        const queue = await plan(profileId, topicId, now, Math.random)
        if (!queue.questions.length) throw new ValidationError(queue.skippedCount ? 'Для этой тренировки нужны слова хотя бы с четырьмя разными переводами. Другие переводы того же казахского слова не подходят как неверные варианты.' : 'В словаре нет подходящих слов. Добавьте слова или смените тему.')
        const session: TrainingSession = { id: createId(), profileId, status: 'active', startedAt: now, targetCount: queue.questions.length, answeredCount: 0, correctCount: 0, queueSnapshots: queue.questions, cursor: 0 }
        await db.sessions.add(session)
        return session
      })
    },
    async answer(profileId: string, sessionId: string, questionIndex: number, selectedIndex: number, now = Date.now()) {
      return db.transaction('rw', [db.profiles, db.appMeta, db.words, db.answers, db.progress, db.sessions], async () => {
        await assertOwner(profileId)
        const session = await db.sessions.get(sessionId)
        if (!session || session.profileId !== profileId) throw new ValidationError('Тренировка не принадлежит этому профилю.')
        const question = session.queueSnapshots[questionIndex]
        if (!Number.isInteger(questionIndex) || !question) throw new ValidationError('Вопрос не найден.')
        const isCorrect = evaluateAnswer(question, selectedIndex)
        const existing = await db.answers.where('[sessionId+questionIndex]').equals([sessionId, questionIndex]).first()
        if (existing) return existing
        if (session.status !== 'active' || session.cursor !== questionIndex) throw new ValidationError('Тренировка уже завершена или этот вопрос недоступен.')
        if (!await db.words.get(question.wordId)) throw new ValidationError('Слово удалено. Завершите тренировку.')
        const previous = await db.progress.get([profileId, question.wordId])
        const next = scheduleNextReview(previous?.stage ?? 0, isCorrect, now)
        const answer: Answer = { id: createId(), profileId, sessionId, wordId: question.wordId, questionIndex, kazakhSnapshot: question.kazakh, russianSnapshot: question.russian, optionsSnapshot: [...question.options], selectedIndex, correctIndex: question.correctIndex, isCorrect, answeredAt: now }
        await db.answers.add(answer)
        await db.progress.put({ profileId, wordId: question.wordId, ...next, lastAnsweredAt: now, correctCount: (previous?.correctCount ?? 0) + Number(isCorrect), incorrectCount: (previous?.incorrectCount ?? 0) + Number(!isCorrect) })
        const cursor = session.cursor + 1
        const completed = cursor === session.targetCount
        await db.sessions.update(sessionId, { cursor, answeredCount: session.answeredCount + 1, correctCount: session.correctCount + Number(isCorrect), ...(completed ? { status: 'completed', endedAt: now } : {}) })
        return answer
      })
    },
    async interrupt(profileId: string, sessionId: string) {
      await db.transaction('rw', [db.profiles, db.appMeta, db.sessions], async () => {
        await assertOwner(profileId)
        const session = await db.sessions.get(sessionId)
        if (!session || session.profileId !== profileId) throw new ValidationError('Тренировка не принадлежит этому профилю.')
        if (session.status === 'active') await db.sessions.update(sessionId, { status: 'interrupted', endedAt: Date.now() })
      })
    },
  }
}

export const trainingRepository = createTrainingRepository(database)
