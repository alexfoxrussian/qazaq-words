import { describe, expect, it } from 'vitest'
import type { Progress, Word } from '../models'
import { buildQueue, evaluateAnswer, scheduleNextReview } from './domain'
import { normalizeText } from '../../shared/utils/text'

const word = (id: string, russian = `Перевод ${id}`, topicIds: string[] = []): Word => ({ id, kazakh: `Слово ${id}`, russian, topicIds, createdAt: Number(id) || 0, updatedAt: 0 })
const progress = (wordId: string, dueAt: number): Progress => ({ profileId: 'profile', wordId, dueAt, stage: 1, lastAnsweredAt: 0, correctCount: 1, incorrectCount: 0 })

describe('интервалы и автоматическая проверка', () => {
  it.each([[0, 1], [1, 3], [2, 7], [3, 14], [4, 30], [5, 30]])('ступень %i получает интервал %i суток', (stage, days) => {
    expect(scheduleNextReview(stage, true, 12345)).toEqual({ stage: Math.min(stage + 1, 5), dueAt: 12345 + days * 86400000 })
  })
  it.each([0, 1, 2, 3, 4, 5])('ошибка со ступени %i сбрасывает её и назначает десять минут', (stage) => {
    expect(scheduleNextReview(stage, false, 12345)).toEqual({ stage: 0, dueAt: 612345 })
  })
  it('считает ровно 24 часа независимо от календарной границы', () => {
    const now = Date.parse('2026-10-09T23:59:00+05:00')
    expect(scheduleNextReview(0, true, now).dueAt - now).toBe(86400000)
  })
  it('проверяет индекс автоматически и отклоняет неоднозначные варианты', () => {
    const question = { wordId: 'id', kazakh: 'Ә', russian: 'Верный', options: ['Первый', 'Верный', 'Третий', 'Четвёртый'], correctIndex: 1 }
    expect([0, 1, 2, 3].map((index) => evaluateAnswer(question, index))).toEqual([false, true, false, false])
    expect(() => evaluateAnswer(question, 4)).toThrow()
    expect(() => evaluateAnswer({ ...question, options: ['Верный', ' верный ', 'Третий', 'Четвёртый'] }, 1)).toThrow()
    expect(() => evaluateAnswer({ ...question, correctIndex: 0 }, 0)).toThrow()
  })
})

describe('очередь и варианты', () => {
  it('выбирает новые слова из всего словаря до ограничения длины, сохраняя приоритет повторений', () => {
    const words = ['1', '2', '3', '4', '5', '6', '7', '8'].map((id) => word(id))
    const states = [progress('8', 50), progress('7', 200)]
    const first = buildQueue(words, states, '', 3, 100, () => 0).questions.map((item) => item.wordId)
    const second = buildQueue(words, states, '', 3, 100, () => .99).questions.map((item) => item.wordId)
    expect(first[0]).toBe('8')
    expect(second[0]).toBe('8')
    expect(first.slice(1)).not.toEqual(second.slice(1))
    expect(first).not.toContain('7')
    expect(second).not.toContain('7')
    expect(new Set(first).size).toBe(3)
    expect(words.map((item) => item.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })
  it('ставит просроченные первыми и добавляет будущие повторения после новых', () => {
    const words = ['1', '2', '3', '4', '5', '6'].map((id) => word(id))
    const states = [progress('3', 100), progress('4', 90), progress('1', 101)]
    const queue = buildQueue(words, states, '', 4, 100, () => .5)
    expect(queue.questions.map((item) => item.wordId)).toEqual(['4', '3', '2', '6'])
    expect(queue.dueCount).toBe(2)
    expect(queue.newCount).toBe(3)
    expect(queue.scheduledCount).toBe(1)
    expect(buildQueue(words, states, '', 10, 100, () => .5).questions.map((item) => item.wordId)).toEqual(['4', '3', '2', '6', '5', '1'])
  })
  it('использует отвлекающие из общего словаря при фильтре одной темы', () => {
    const words = [word('1', 'Один', ['topic']), word('2', 'Два'), word('3', 'Три'), word('4', 'Четыре')]
    const queue = buildQueue(words, [], 'topic', 10, 100, () => .5)
    expect(queue.questions).toHaveLength(1)
    expect(new Set(queue.questions[0].options)).toEqual(new Set(['Один', 'Два', 'Три', 'Четыре']))
  })
  it('не предлагает альтернативный перевод того же казахского слова как неверный', () => {
    const words = [word('1', 'Первый', ['topic']), { ...word('2', 'Второй'), kazakh: ' СЛОВО 1 ' }, word('3'), word('4'), word('5')]
    const question = buildQueue(words, [], 'topic', 10, 100, () => .5).questions[0]
    expect(question.options).not.toContain('Второй')
    expect(question.options).toContain('Первый')
  })
  it('пропускает карточки при недостатке уникальных переводов после нормализации', () => {
    const words = [word('1', 'Два'), word('2', ' ДВА '), word('3', 'Три'), word('4', 'Четыре')]
    const queue = buildQueue(words, [], '', 10, 100, () => .5)
    expect(queue.questions).toHaveLength(0)
    expect(queue.skippedCount).toBe(4)
  })
  it('ставит правильный ответ в разные позиции и сохраняет четыре уникальных варианта', () => {
    const words = ['1', '2', '3', '4'].map((id) => word(id))
    const indices = [0, .26, .4, .99].map((random) => {
      const question = buildQueue(words, [], '', 10, 100, () => random).questions[0]
      expect(new Set(question.options.map(normalizeText)).size).toBe(4)
      expect(question.options[question.correctIndex]).toBe(question.russian)
      return question.correctIndex
    })
    expect(new Set(indices).size).toBe(4)
  })
})
