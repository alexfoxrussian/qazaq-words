import { useEffect, useState, useSyncExternalStore } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { Button, Modal } from '../../shared/ui/components'
import { useTrainingStore } from '../training/store'
import { pwaRuntime } from './runtime'
import styles from './pwa.module.css'

const installOfferKey = 'qazaq-words:install-offered'
// This preference contains no dictionary, profile, or training data.
function offerWasShown() {
  try { return localStorage.getItem(installOfferKey) === 'yes' } catch { return false }
}
function rememberOffer() {
  try { localStorage.setItem(installOfferKey, 'yes') } catch { /* Storage can be blocked. */ }
}

export function PwaControls() {
  const state = useSyncExternalStore(pwaRuntime.subscribe, pwaRuntime.snapshot)
  const session = useTrainingStore((value) => value.session)
  const view = useTrainingStore((value) => value.view)
  const visibleIndex = useTrainingStore((value) => value.visibleIndex)
  const active = session?.status === 'active'
  const resultVisible = session?.status === 'completed' && view === 'session' && visibleIndex >= session.targetCount
  const [offerSession, setOfferSession] = useState<string | null>(null)
  const [offerDismissed, setOfferDismissed] = useState(false)
  const [dialog, setDialog] = useState<'install' | 'update' | null>(null)
  useEffect(() => {
    if (import.meta.env.PROD && resultVisible && session && state.supported && !state.installed && !offerWasShown() && !offerSession) {
      rememberOffer()
      setOfferSession(session.id)
    }
  }, [resultVisible, session, state.supported, state.installed, offerSession])
  const showOffer = resultVisible && offerSession === session?.id && !offerDismissed && !state.installed
  function install() {
    rememberOffer()
    setOfferDismissed(true)
    if (state.canInstall) void pwaRuntime.install().then(() => { if (pwaRuntime.snapshot().error) setDialog('install') })
    else setDialog('install')
  }
  if (!import.meta.env.PROD) return null
  return <section className={styles.controls} aria-label="Приложение и обновления">
    <div className={styles.meta}>
      {!state.online && <span role="status">Без интернета</span>}
      {!state.installed && <button type="button" className={styles.textButton} onClick={install}><Download size={14} aria-hidden="true" />Установить на устройство</button>}
    </div>
    {showOffer && <div className={styles.notice}>
      <p>Занимайтесь без браузера — установите Qazaq Words.</p>
      <div className={styles.actions}><button type="button" className={styles.textButton} onClick={install}>Установить</button><button type="button" className={styles.textButton} onClick={() => setOfferDismissed(true)}>Позже</button></div>
    </div>}
    {state.update && <div className={styles.notice}>
      <p role="status">{active ? 'Новая версия готова. Обновить можно после тренировки.' : 'Доступна новая версия приложения.'}</p>
      {!active && <button type="button" className={styles.textButton} onClick={() => setDialog('update')}><RefreshCw size={14} aria-hidden="true" />Обновить</button>}
    </div>}
    {dialog === 'install' && <Modal title="Установка Qazaq Words" onClose={() => setDialog(null)}>
      {state.error && <p role="status">{state.error}</p>}
      <p>В Chrome или Edge откройте меню браузера и выберите «Установить приложение». На iPhone или iPad откройте сайт в Safari: «Поделиться» → «На экран Домой».</p>
      <p>После подготовки офлайн-версии приложение работает без интернета. Данные остаются на этом устройстве. Удаление данных сайта удаляет профили и прогресс — сохраняйте резервную копию.</p>
    </Modal>}
    {dialog === 'update' && <Modal title="Обновить приложение?" onClose={() => setDialog(null)} closeLabel="Отмена" focusCancel>
      <p>Страница перезагрузится. Сохранённые профили, словарь и результаты останутся. Сначала сохраните изменения в открытых формах.</p>
      {state.error && <p role="alert">{state.error}</p>}
      <Button disabled={active} onClick={() => { void pwaRuntime.update().then(() => { if (!pwaRuntime.snapshot().error) setDialog(null) }) }}>Обновить и перезагрузить</Button>
    </Modal>}
  </section>
}
