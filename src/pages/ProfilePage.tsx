import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { prepareProfilePhoto } from '../entities/profile/photo'
import type { Profile } from '../entities/models'
import { useProfileStore } from '../features/profiles/store'
import { BackupControls } from '../features/import-export/BackupControls'
import { profileRepository } from '../shared/db/profileRepository'
import { ActiveSessionError, dataErrorMessage } from '../shared/db/errors'
import { BentoCard, Button, FormField, Modal, ProfileAvatar } from '../shared/ui/components'
import styles from './pages.module.css'

export function ProfilePage() {
  const profiles = useProfileStore((state) => state.profiles)
  const activeProfile = useProfileStore((state) => state.activeProfile)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [editName, setEditName] = useState('')
  const [editing, setEditing] = useState<Profile | null>(null)
  const [deleting, setDeleting] = useState<Profile | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const photoProfileId = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [switchConfirmation, setSwitchConfirmation] = useState<{ operation: (confirmed: boolean) => Promise<void>; success: string } | null>(null)

  async function run(operation: (confirmed: boolean) => Promise<void>, success: string, confirmed = false) {
    if (lock.current) return
    lock.current = true
    setBusy(true); setError(null); setMessage('')
    try {
      await operation(confirmed)
      // Refresh only after a committed transaction; liveQuery also handles other tabs.
      useProfileStore.getState().applySnapshot(await profileRepository.snapshot())
      setMessage(success)
      setSwitchConfirmation(null)
    } catch (cause) {
      if (cause instanceof ActiveSessionError) setSwitchConfirmation({ operation, success })
      else setError(dataErrorMessage(cause))
    }
    finally { lock.current = false; setBusy(false) }
  }

  function create(event: FormEvent) {
    event.preventDefault()
    void run(async (confirmed) => {
      await profileRepository.create(name, confirmed)
      setName('')
      // Apply committed state before leaving the protected first-run screen.
      useProfileStore.getState().applySnapshot(await profileRepository.snapshot())
      navigate('/')
    }, 'Профиль создан.')
  }

  const feedback = <>{error && <p className={styles.error} role="alert">{error}</p>}{message && <p role="status" className={styles.muted}>{message}</p>}</>
  return <>
    <header className={`${styles.heading} ${styles.compactHeading}`}><h1>Локальные профили</h1><p>{profiles.length ? 'У каждого свой прогресс. У всех — общий словарь.' : 'Достаточно имени — регистрация и пароль не нужны.'}</p></header>
    {!activeProfile && profiles.length > 0 && <p className={styles.muted}>Вы сейчас гость. Выберите профиль или создайте новый, чтобы сохранять прогресс.</p>}
    {activeProfile && <Button variant="secondary" disabled={busy} onClick={() => void run(async (confirmed) => { await profileRepository.logout(confirmed); useProfileStore.getState().applySnapshot(await profileRepository.snapshot()); navigate('/') }, 'Вы вышли в гостевой режим.')}>Выйти</Button>}
    {!activeProfile && <Link className={styles.guestContinue} to="/training">Продолжить как гость →</Link>}
    {!editing && !deleting && !switchConfirmation && feedback}
    <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => {
      const file = event.target.files?.[0], id = photoProfileId.current
      event.target.value = ''; photoProfileId.current = null
      if (file && id) void run(async () => profileRepository.setPhoto(id, await prepareProfilePhoto(file)), 'Фото профиля сохранено.')
    }} />
    <div className={`${styles.grid} ${styles.profileGrid}`}>
      {profiles.length > 0 && <BentoCard className={styles.wide} title="Ваши профили">
        <div className={styles.profileList}>{profiles.map((profile) => <article key={profile.id} className={styles.profileRow} data-active={profile.id === activeProfile?.id}>
          <div className={styles.profileIdentity}><ProfileAvatar profile={profile} className={styles.profilePhoto} /><div><h3>{profile.name}</h3><p className={styles.muted}>{profile.id === activeProfile?.id ? 'Активный профиль' : 'Локальный профиль'}</p></div></div>
          <div className={styles.actions}>
            <Button variant="secondary" disabled={busy} onClick={() => { photoProfileId.current = profile.id; photoInput.current?.click() }}>{profile.avatarDataUrl ? 'Изменить фото' : 'Загрузить фото'}<span className={styles.srOnly}> {profile.name}</span></Button>
            {profile.avatarDataUrl && <Button variant="secondary" disabled={busy} onClick={() => void run(async () => profileRepository.setPhoto(profile.id, null), 'Фото профиля убрано.')}>Убрать фото<span className={styles.srOnly}> {profile.name}</span></Button>}
            <Button variant="secondary" disabled={busy || profile.id === activeProfile?.id} onClick={() => void run((confirmed) => (async () => { await profileRepository.select(profile.id, confirmed); useProfileStore.getState().applySnapshot(await profileRepository.snapshot()); navigate('/') })(), `Выбран профиль «${profile.name}».`)}>Войти<span className={styles.srOnly}> {profile.name}</span></Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setError(null); setMessage(''); setEditing(profile); setEditName(profile.name) }}>Переименовать<span className={styles.srOnly}> {profile.name}</span></Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setError(null); setMessage(''); setDeleting(profile) }}>Удалить<span className={styles.srOnly}> {profile.name}</span></Button>
          </div>
        </article>)}</div><details className={styles.helpDetails}><summary>Требования к фото</summary><p className={styles.muted}>JPG, PNG или WebP до 5 МБ. Фото необязательно, сохраняется только на устройстве и включается в резервную копию.</p></details>
      </BentoCard>}
      <BentoCard className={`${styles.createProfileCard} ${profiles.length === 0 ? styles.firstProfileCard : ''}`} title="Создать профиль"><p className={styles.muted}>Имя нужно, чтобы отличать ваш прогресс от других профилей на устройстве.</p><form className={styles.form} onSubmit={create} aria-busy={busy}>
        <FormField id="profile-name" label="Имя профиля" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={busy} autoComplete="off" />
        <Button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Создать профиль'}</Button>
      </form></BentoCard>
      <section className={`${styles.full} ${styles.profileData}`} aria-label="Ваши данные"><details className={styles.backupDetails}><summary>Ваши данные и резервная копия</summary><p className={styles.muted}>Данные хранятся в этом браузере. Очистка данных сайта может удалить их. Профили разделяют прогресс и не защищаются паролем.</p><Button variant="secondary" onClick={() => setInfoOpen(true)}>О локальном хранении</Button><BackupControls /></details></section>
    </div>
    {editing && <Modal title="Переименовать профиль" closeLabel="Отмена" busy={busy} onClose={() => { setEditing(null); setError(null) }}>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void run(async () => { await profileRepository.rename(editing.id, editName); setEditing(null) }, 'Имя профиля сохранено.') }}>
        <FormField id="rename-profile" label="Новое имя" value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={80} required disabled={busy} />
        {feedback}<Button type="submit" disabled={busy}>Сохранить имя</Button>
      </form>
    </Modal>}
    {deleting && <Modal title={`Удалить профиль «${deleting.name}»?`} closeLabel="Отмена" focusCancel busy={busy} onClose={() => { setDeleting(null); setError(null) }}>
      <p>Его прогресс, история тренировок и настройки будут удалены без возможности отмены. Общий словарь и другие профили сохранятся.</p>
      {feedback}<div className={styles.actions}><Button variant="destructive" disabled={busy} onClick={() => void run(async () => { await profileRepository.remove(deleting.id); setDeleting(null) }, 'Профиль удалён. Выберите другой или создайте новый.')}>Удалить профиль</Button></div>
    </Modal>}
    {infoOpen && <Modal title="Данные на вашем устройстве" onClose={() => setInfoOpen(false)}><p>Данные сохраняются в IndexedDB этого браузера. Выбор профиля восстанавливается после перезагрузки. Для переноса между браузерами экспортируйте полный JSON backup, затем восстановите его на другом устройстве.</p></Modal>}
    {switchConfirmation && <Modal title="Завершить тренировку перед сменой профиля?" closeLabel="Остаться" focusCancel busy={busy} onClose={() => { setSwitchConfirmation(null); setError(null) }}><p>Активный сеанс будет прерван. Уже сохранённые ответы останутся у прежнего профиля.</p>{feedback}<Button disabled={busy} onClick={() => void run(switchConfirmation.operation, switchConfirmation.success, true)}>Завершить и сменить профиль</Button></Modal>}
  </>
}
