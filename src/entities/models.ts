export interface Profile { id: string; name: string; createdAt: number; updatedAt: number; avatarDataUrl?: string }
export interface Word { id: string; kazakh: string; russian: string; topicIds: string[]; createdAt: number; updatedAt: number }
export interface Topic { id: string; name: string; createdAt: number; updatedAt: number }
export interface Progress { profileId: string; wordId: string; stage: number; dueAt: number; lastAnsweredAt: number; correctCount: number; incorrectCount: number }
export interface QuestionSnapshot { wordId: string; kazakh: string; russian: string; options: string[]; correctIndex: number }
export interface TrainingSession { id: string; profileId: string; status: 'active' | 'completed' | 'interrupted'; startedAt: number; endedAt?: number; targetCount: number; answeredCount: number; correctCount: number; queueSnapshots: QuestionSnapshot[]; cursor: number }
export interface Answer { id: string; sessionId: string; profileId: string; wordId: string; questionIndex: number; kazakhSnapshot: string; russianSnapshot: string; optionsSnapshot: string[]; selectedIndex: number; correctIndex: number; isCorrect: boolean; answeredAt: number }
export interface ProfileSettings { profileId: string; colorMode: 'light' | 'dark' | 'system'; palette: 'blue' | 'emerald' | 'amber' | 'violet'; visualStyle: 'modern' | 'retro' | 'pixel' | 'orient'; sessionLength: number; fontSize: 'standard' | 'large' | 'maximum' }
export interface DictionaryFeedState { source: string; seenWords: string[]; seenTopics: string[]; seenLinks: string[]; checkedAt: number }
export type AppMeta = { key: 'activeProfileId'; value: string | null } | { key: 'initialized'; value: boolean } | { key: 'dictionaryFeed'; value: DictionaryFeedState }

export function defaultSettings(profileId: string): ProfileSettings {
  return { profileId, colorMode: 'system', palette: 'blue', visualStyle: 'modern', sessionLength: 10, fontSize: 'standard' }
}
