import { useRef, useState } from 'react'
import type { ProfileSettings } from '../entities/models'
import { useProfileStore } from '../features/profiles/store'
import { BackupControls } from '../features/import-export/BackupControls'
import { settingsRepository } from '../shared/db/settingsRepository'
import { dataErrorMessage } from '../shared/db/errors'
import { BentoCard } from '../shared/ui/components'
import styles from './pages.module.css'
export function SettingsPage() {
  const profile = useProfileStore((state) => state.activeProfile)!, settings = useProfileStore((state) => state.settings)!
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  async function change(patch: Partial<Pick<ProfileSettings, 'colorMode' | 'palette' | 'visualStyle' | 'fontSize'>>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try { await settingsRepository.save(profile.id, { colorMode: settings.colorMode, palette: settings.palette, visualStyle: settings.visualStyle, fontSize: settings.fontSize, ...patch }) }
    catch (cause) { setError(dataErrorMessage(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <>
    <header className={styles.heading}><span className={styles.eyebrow}>ВАШЕ ПРОСТРАНСТВО</span><h1>Настройки</h1><p>Оформление сохраняется отдельно для каждого профиля.</p></header>
    <div className={`${styles.grid} ${styles.settingsGrid}`}><BentoCard className={`${styles.full} ${styles.appearanceCard}`} title="Оформление"><p className={`${styles.newOnly} ${styles.muted}`}>Подберите сочетание, в котором вам удобно учиться.</p><div className={`${styles.form} ${styles.appearanceFields}`}>
      <label className={styles.selectField}>Тема интерфейса<select disabled={busy} value={settings.colorMode} onChange={(event) => void change({ colorMode: event.target.value as ProfileSettings['colorMode'] })}><option value="system">Системная</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label>
      <label className={styles.selectField}>Палитра<select disabled={busy} value={settings.palette} onChange={(event) => void change({ palette: event.target.value as ProfileSettings['palette'] })}><option value="blue">Синяя</option><option value="emerald">Изумрудная</option><option value="amber">Янтарная</option><option value="violet">Фиолетовая</option></select></label>
      <label className={styles.selectField}>Стиль<select disabled={busy} value={settings.visualStyle} onChange={(event) => void change({ visualStyle: event.target.value as ProfileSettings['visualStyle'] })}><option value="modern">Modern</option><option value="retro">Retro</option><option value="pixel">Pixel</option><option value="orient">Orient</option></select></label>
      <label className={styles.selectField}>Размер шрифта<select disabled={busy} value={settings.fontSize} onChange={(event) => void change({ fontSize: event.target.value as ProfileSettings['fontSize'] })}><option value="standard">Стандартный</option><option value="large">Большой</option><option value="maximum">Максимальный</option></select></label>
      {error && <p role="alert" className={styles.error}>{error}</p>}{busy && <p role="status">Сохраняем оформление…</p>}
    </div></BentoCard><BentoCard className={`${styles.newOnly} ${styles.appearancePreview}`} title="Ваше оформление"><span className={styles.previewBadge}>ПРЕДПРОСМОТР</span><div className={styles.previewWord}>Сәлем<span>Привет</span></div><div className={styles.previewChoices} aria-hidden="true"><span>Ваш акцент</span><span>Вариант ответа</span></div><p className={styles.muted}>Цвет, геометрия и размер текста применяются ко всем экранам.</p></BentoCard><BentoCard className={`${styles.full} ${styles.dataPanel}`} title="Резервная копия"><BackupControls /></BentoCard></div>
  </>
}
