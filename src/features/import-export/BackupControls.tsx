import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseBackup, MAX_BACKUP_BYTES, type Backup } from './backup'
import { backupRepository } from '../../shared/db/backupRepository'
import { profileRepository } from '../../shared/db/profileRepository'
import { useProfileStore } from '../profiles/store'
import { useTrainingStore } from '../training/store'
import { trainingRepository } from '../../shared/db/trainingRepository'
import { dataErrorMessage } from '../../shared/db/errors'
import { Button, Modal } from '../../shared/ui/components'
import styles from '../../pages/pages.module.css'
export function BackupControls() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null), lock = useRef(false)
  const [preview, setPreview] = useState<Backup | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [message, setMessage] = useState('')
  async function exportBackup() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      const backup = await backupRepository.export()
      const content = JSON.stringify(backup, null, 2)
      if (new TextEncoder().encode(content).length > MAX_BACKUP_BYTES) throw new Error('Резервная копия превышает поддерживаемые 25 MiB.')
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `qazaq-words-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('Резервная копия экспортирована.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : dataErrorMessage(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  async function read(file: File) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null); setMessage('')
    try { if (file.size > MAX_BACKUP_BYTES) throw new Error('Файл превышает 25 MiB.'); setPreview(parseBackup(await file.text())) }
    catch (cause) { setError(cause instanceof Error ? cause.message : dataErrorMessage(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  async function restore() {
    if (!preview || lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      await backupRepository.restore(preview, true)
      const snapshot = await profileRepository.snapshot()
      useProfileStore.getState().applySnapshot(snapshot)
      if (snapshot.activeProfile) useTrainingStore.getState().apply(snapshot.activeProfile.id, await trainingRepository.snapshot(snapshot.activeProfile.id))
      setPreview(null); setMessage('Данные восстановлены.')
      navigate(snapshot.activeProfile ? '/' : '/profile', { replace: true })
    } catch (cause) { setError(dataErrorMessage(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  const feedback = <>{error && <p role="alert" className={styles.error}>{error}</p>}<p role="status" className={styles.muted}>{message}</p></>
  return <>
    <p className={styles.muted}>Полная копия всех профилей, слов, тем, прогресса, истории и настроек. Файл до 25 MiB. Данные обрабатываются на этом устройстве.</p>
    {!preview && feedback}<div className={styles.actions}><Button variant="secondary" disabled={busy} onClick={() => void exportBackup()}>Экспортировать backup</Button><Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>Восстановить из backup</Button></div>
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file) }} />
    {preview && <Modal title="Заменить все локальные данные?" closeLabel="Отмена" focusCancel busy={busy} onClose={() => { setPreview(null); setError(null) }}>
      <p>В копии: профилей {preview.data.profiles.length}, слов {preview.data.words.length}, тем {preview.data.topics.length}, ответов {preview.data.answers.length}, сеансов {preview.data.sessions.length}. Дата: {new Date(preview.exportedAt).toLocaleString('ru-RU')}.</p>
      <p>Все текущие данные будут удалены и заменены этой копией. Текущее состояние активных тренировок будет заменено состоянием из копии. Отменить восстановление можно только с помощью заранее экспортированной копии.</p>
      {feedback}<div className={styles.actions}><Button variant="secondary" disabled={busy} onClick={() => void exportBackup()}>Сначала экспортировать текущие данные</Button><Button variant="destructive" disabled={busy} onClick={() => void restore()}>Заменить данные и восстановить</Button></div>
    </Modal>}
  </>
}
