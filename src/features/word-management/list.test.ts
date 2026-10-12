import { describe, expect, it } from 'vitest'
import type { Word } from '../../entities/models'
import { wordPage } from './list'

const words: Word[] = [
  { id: '1', kazakh: 'бала', russian: 'ребёнок', createdAt: 10, updatedAt: 10, topicIds: [] },
  { id: '2', kazakh: 'әже', russian: 'бабушка', createdAt: 30, updatedAt: 30, topicIds: [] },
  { id: '3', kazakh: 'ағаш', russian: 'дерево', createdAt: 20, updatedAt: 20, topicIds: [] },
]

describe('dictionary list', () => {
  it('uses Kazakh alphabet order without changing repository data', () => {
    expect(wordPage(words, 'kazakh-asc', 1, 20).words.map((word) => word.kazakh)).toEqual(['ағаш', 'әже', 'бала'])
    expect(words.map((word) => word.id)).toEqual(['1', '2', '3'])
  })
  it('sorts translations and creation dates in both directions', () => {
    expect(wordPage(words, 'russian-asc', 1, 20).words.map((word) => word.id)).toEqual(['2', '3', '1'])
    expect(wordPage(words, 'russian-desc', 1, 20).words.map((word) => word.id)).toEqual(['1', '3', '2'])
    expect(wordPage(words, 'created-desc', 1, 20).words.map((word) => word.id)).toEqual(['2', '3', '1'])
    expect(wordPage(words, 'created-asc', 1, 20).words.map((word) => word.id)).toEqual(['1', '3', '2'])
  })
  it('clamps a vanished page after filtering or deletion and reports the actual range', () => {
    expect(wordPage(words, 'kazakh-asc', 5, 2)).toMatchObject({ page: 2, pages: 2, start: 3, end: 3, total: 3 })
    expect(wordPage([], 'kazakh-asc', 5, 2)).toMatchObject({ page: 1, pages: 1, start: 0, end: 0, total: 0, words: [] })
  })
})
