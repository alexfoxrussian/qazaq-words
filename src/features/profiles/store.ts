import { create } from 'zustand';
import type { ProfileSnapshot } from '../../shared/db/profileRepository';

interface ProfileState extends ProfileSnapshot {
    status: 'loading' | 'ready' | 'error';
    error: string | null;
    applySnapshot: (snapshot: ProfileSnapshot) => void;
    fail: (message: string) => void;
    loading: () => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
    profiles: [],
    activeProfile: null,
    settings: null,
    status: 'loading',
    error: null,
    applySnapshot: (snapshot) => set({ ...snapshot, status: 'ready', error: null }),
    fail: (error) => set({ status: 'error', error }),
    loading: () => set({ status: 'loading', error: null }),
}));
