import { useState, useSyncExternalStore } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { Button, Modal } from '../../shared/ui/components'
import { useTrainingStore } from '../training/store'
import { pwaRuntime } from './runtime'
import styles from './pwa.module.css'

export function PwaControls() {
  const state = useSyncExternalStore(pwaRuntime.subscribe, pwaRuntime.snapshot)
  const active = useTrainingStore((value) => value.session?.status === 'active')
  const [dialog, setDialog] = useState<'install' | 'update' | null>(null)
  if (!import.meta.env.PROD) return null
  return <section className={styles.panel} aria-label="Приложение и обновления">
    <p role="status">{!state.online ? 'Вы офлайн' : state.ready ? 'Готово к работе офлайн' : 'Подготовка офлайн-версии…'}</p>
    <div className={styles.actions}>
      {!state.installed && <Button variant="secondary" onClick={() => state.canInstall ? void pwaRuntime.install() : setDialog('install')}><Download size={16} aria-hidden="true" /> Установить приложение</Button>}
      {state.update ? <Button disabled={active} onClick={() => setDialog('update')}><RefreshCw size={16} aria-hidden="true" /> Обновить приложение</Button> : <Button variant="secondary" disabled={!state.online || !state.ready} onClick={() => void pwaRuntime.checkUpdate()}>Проверить обновления</Button>}
    </div>
    {state.update && <p role="status">{active ? 'Новая версия готова. Завершите тренировку, чтобы обновить приложение.' : 'Доступна новая версия приложения.'}</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {dialog === 'install' && <Modal title="Установка Qazaq Words" onClose={() => setDialog(null)}>
      <p>В Chrome или Edge откройте меню браузера и выберите «Установить приложение». На iPhone или iPad откройте сайт в Safari: «Поделиться» → «На экран Домой».</p>
      <p>После подготовки офлайн-версии приложение работает без интернета и терминала. Данные остаются в этом браузере на этом устройстве. Удаление данных сайта удаляет профили и прогресс — сохраняйте backup.</p>
    </Modal>}
    {dialog === 'update' && <Modal title="Обновить приложение?" onClose={() => setDialog(null)} closeLabel="Отмена" focusCancel>
      <p>Страница перезагрузится. Сохранённые профили, словарь и результаты останутся. Сначала сохраните изменения в открытых формах.</p>
      <Button disabled={active} onClick={() => { void pwaRuntime.update(); setDialog(null) }}>Обновить и перезагрузить</Button>
    </Modal>}
  </section>
}
