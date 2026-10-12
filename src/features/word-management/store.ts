import { create } from 'zustand'
import type { WordSort } from './list'

interface DictionaryUiState {
  search: string
  topicId: string
  sort: WordSort
  page: number
  pageSize: number
  setSort: (sort: WordSort) => void
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  setSearch: (search: string) => void
  setTopicId: (topicId: string) => void
}
export const useDictionaryUi = create<DictionaryUiState>((set) => ({
  search: '', topicId: '', sort: 'kazakh-asc', page: 1, pageSize: 20,
  setSearch: (search) => set({ search, page: 1 }),
  setTopicId: (topicId) => set({ topicId, page: 1 }),
  setSort: (sort) => set({ sort, page: 1 }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),
}))
