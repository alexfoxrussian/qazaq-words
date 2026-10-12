import { liveQuery } from 'dexie'
import type { Answer, TrainingSession } from '../../entities/models'
import { buildQueue, evaluateAnswer } from '../../entities/training/domain'
import { dictionaryRepository } from '../../shared/db/dictionaryRepository'
import type { TrainingSnapshot } from '../../shared/db/trainingRepository'

// Guest sessions never enter IndexedDB; only the shared dictionary is read.
export function createGuestRepository(dictionary = dictionaryRepository) {
  let session: TrainingSession | null = null
  let answers: Answer[] = []
  let length = 10
  return {
    get sessionLength() { return length },
    reset() { session = null; answers = []; length = 10 },
    async setSessionLength(_profileId: string, value: number) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Укажите целое положительное число вопросов.')
      length = value
    },
    async prepare(_profileId: string, topicId: string) {
      const { words, topics } = await dictionary.snapshot()
      if (topicId && !topics.some((topic) => topic.id === topicId)) throw new Error('Выбранная тема удалена.')
      return { ...buildQueue(words, [], topicId, length === 0 ? Infinity : length, Date.now(), Math.random), topics }
    },
    observePreparation(profileId: string, topicId: string) { return liveQuery(() => this.prepare(profileId, topicId)) },
    async snapshot(): Promise<TrainingSnapshot> { return structuredClone({ session, answers }) },
    async start(profileId: string, topicId: string) {
      if (session?.status === 'active') throw new Error('Сначала завершите текущую тренировку.')
      const queue = await this.prepare(profileId, topicId)
      if (!queue.questions.length) throw new Error('Для тренировки нужны слова хотя бы с четырьмя разными переводами.')
      answers = []
      session = { id: crypto.randomUUID(), profileId, status: 'active', startedAt: Date.now(), targetCount: queue.questions.length, answeredCount: 0, correctCount: 0, queueSnapshots: queue.questions, cursor: 0 }
      return structuredClone(session)
    },
    async answer(profileId: string, sessionId: string, questionIndex: number, selectedIndex: number) {
      if (!session || session.id !== sessionId || session.profileId !== profileId) throw new Error('Тренировка недоступна.')
      const existing = answers.find((answer) => answer.questionIndex === questionIndex)
      if (existing) return structuredClone(existing)
      if (session.status !== 'active' || session.cursor !== questionIndex) throw new Error('Вопрос недоступен.')
      const question = session.queueSnapshots[questionIndex]
      if (!question) throw new Error('Вопрос не найден.')
      const isCorrect = evaluateAnswer(question, selectedIndex)
      const answer: Answer = { id: crypto.randomUUID(), profileId, sessionId, wordId: question.wordId, questionIndex, kazakhSnapshot: question.kazakh, russianSnapshot: question.russian, optionsSnapshot: [...question.options], selectedIndex, correctIndex: question.correctIndex, isCorrect, answeredAt: Date.now() }
      answers.push(answer)
      session.cursor++; session.answeredCount++; session.correctCount += Number(isCorrect)
      if (session.cursor === session.targetCount) { session.status = 'completed'; session.endedAt = Date.now() }
      return structuredClone(answer)
    },
    async interrupt(_profileId: string, sessionId: string) {
      if (session?.id === sessionId && session.status === 'active') { session.status = 'interrupted'; session.endedAt = Date.now() }
    },
  }
}
export const guestRepository = createGuestRepository()
