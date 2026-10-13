import { useEffect, type ReactNode } from 'react'
import { create } from 'zustand'
import { DEFAULT_DICTIONARY_URL } from '../../entities/word/dictionaryFeed'
import { dictionaryFeedRepository } from '../../shared/db/dictionaryFeedRepository'
import { createDictionarySync, type SyncStatus } from './service'
import bootstrap from '../../../imports/general-dictionary.json'
import styles from './sync.module.css'

const useSyncStore = create<SyncStatus>(() => ({ phase: 'idle', message: null }))
const sync = createDictionarySync({
  repository: dictionaryFeedRepository,
  source: import.meta.env.VITE_DICTIONARY_URL?.trim() || DEFAULT_DICTIONARY_URL,
  bootstrap,
  publish: (status) => useSyncStore.setState(status),
})

export function DictionarySyncProvider({ children }: { children: ReactNode }) {
  const status = useSyncStore()
  useEffect(() => {
    void sync.refresh(true)
    const check = () => { void sync.refresh() }
    const reconnect = () => { void sync.refresh(true) }
    const visible = () => { if (!document.hidden) check() }
    const interval = window.setInterval(check, 60000)
    window.addEventListener('online', reconnect)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', reconnect)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  return <>
    {(status.phase === 'loading' || status.phase === 'error') && <p className={styles.notice} role="status">{status.message}</p>}
    {children}
  </>
}
