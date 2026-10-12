import { create } from 'zustand'
import type { TrainingSnapshot } from '../../shared/db/trainingRepository'

interface TrainingState extends TrainingSnapshot {
  profileId: string | null
  status: 'loading' | 'ready' | 'error'
  error: string | null
  view: 'prepare' | 'resume' | 'session'
  visibleIndex: number
  loading: (profileId: string) => void
  apply: (profileId: string, snapshot: TrainingSnapshot) => void
  fail: (message: string) => void
  setView: (view: TrainingState['view']) => void
  advance: () => void
}

export const useTrainingStore = create<TrainingState>((set) => ({
  profileId: null, session: null, answers: [], status: 'loading', error: null, view: 'prepare', visibleIndex: 0,
  loading: (profileId) => set({ profileId, session: null, answers: [], status: 'loading', error: null, view: 'prepare', visibleIndex: 0 }),
  apply: (profileId, snapshot) => set((state) => {
    const changed = state.profileId !== profileId || state.session?.id !== snapshot.session?.id
    return { ...snapshot, profileId, status: 'ready', error: null,
      view: changed ? (snapshot.session?.status === 'active' ? 'resume' : snapshot.session?.status === 'completed' ? 'session' : 'prepare') : state.view,
      visibleIndex: changed ? Math.max(0, (snapshot.session?.cursor ?? 0) - 1) : Math.max(state.visibleIndex, (snapshot.session?.cursor ?? 0) - 1),
    }
  }),
  fail: (error) => set({ status: 'error', error }),
  setView: (view) => set({ view }),
  advance: () => set((state) => ({ visibleIndex: state.session?.cursor ?? 0 })),
}))
