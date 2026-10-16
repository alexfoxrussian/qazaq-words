import { useLayoutEffect, useState } from 'react'
import { createBrowserRouter, createRoutesFromElements, Link, NavLink, Outlet, Route, RouterProvider, useLocation } from 'react-router-dom'
import { BookOpen, ChartNoAxesCombined, House, MoreHorizontal, Settings, Sparkles, UserRound, type LucideIcon } from 'lucide-react'
import { DashboardPage, SettingsPage, StatisticsPage } from '../pages/pages'
import { TrainingPage } from '../pages/TrainingPage'
import { AppearanceProvider } from './AppearanceProvider'
import { TrainingProvider } from './TrainingProvider'
import { DictionaryPage } from '../pages/DictionaryPage'
import { ProfilePage } from '../pages/ProfilePage'
import { DataGate } from './DataGate'
import { useProfileStore } from '../features/profiles/store'
import { BentoCard, EmptyState, Modal } from '../shared/ui/components'
import styles from './shell.module.css'
import { PwaControls } from '../features/pwa/PwaControls'

const navigation: { path: string; label: string; icon: LucideIcon; requiresProfile?: boolean; secondary?: boolean; shortLabel?: string }[] = [
  { path: '/', label: 'Главная', icon: House },
  { path: '/training', label: 'Тренировка', icon: Sparkles, shortLabel: 'Учить' },
  { path: '/dictionary', label: 'Словарь', icon: BookOpen },
  { path: '/statistics', label: 'Статистика', icon: ChartNoAxesCombined, requiresProfile: true, shortLabel: 'Итоги' },
  { path: '/profile', label: 'Профиль', icon: UserRound, secondary: true },
  { path: '/settings', label: 'Настройки', icon: Settings, requiresProfile: true, secondary: true },
]

function Shell() {
  const location = useLocation()
  const profile = useProfileStore((state) => state.activeProfile)
  const visibleNavigation = navigation.filter((item) => !item.requiresProfile || profile)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = ['/profile', '/settings'].includes(location.pathname)
  useLayoutEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) }, [location.key])
  return <div className={styles.shell}>
    <a className={styles.skip} href="#content">Перейти к содержимому</a>
    <aside className={styles.sidebar}>
      <Link to="/" className={styles.brand}><span className={styles.logo}>Q</span><span>Qazaq Words<small>Казахский каждый день</small></span></Link>
      <nav className={styles.navigation} aria-label="Основная навигация">
        {visibleNavigation.map(({ path, label, icon: Icon, secondary, shortLabel }) => <NavLink key={path} to={path} end={path === '/'} aria-label={label} className={({ isActive }) => `${styles.navLink} ${secondary && profile ? styles.secondaryNav : ''} ${isActive ? styles.active : ''}`}><Icon size={20} aria-hidden="true" /><span className={shortLabel ? styles.longLabel : ''}>{label}</span>{shortLabel && <span className={styles.shortLabel} aria-hidden="true">{shortLabel}</span>}</NavLink>)}
        {profile && <button type="button" className={`${styles.navLink} ${styles.moreButton} ${moreActive ? styles.active : ''}`} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}><MoreHorizontal size={20} aria-hidden="true" /><span>Ещё</span></button>}
      </nav>
      <div className={styles.localNote}><span className={styles.dot} />Локальное приложение<p>Ваше обучение — на этом устройстве.</p></div>
    </aside>
    <main id="content" className={styles.main} tabIndex={-1}>

      <DataGate><AppearanceProvider /><TrainingProvider><Outlet /></TrainingProvider></DataGate>
      <footer className={styles.footer}>Qazaq Words · Локальное обучение</footer>
      <PwaControls />
    </main>
    {profile && moreOpen && <Modal title="Ещё" closeLabel="Закрыть" onClose={() => setMoreOpen(false)}><nav className={styles.moreLinks} aria-label="Профиль и настройки">{visibleNavigation.filter((item) => item.secondary).map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`} onClick={() => setMoreOpen(false)}><Icon size={22} aria-hidden="true" /><span>{label}</span></NavLink>)}</nav></Modal>}
  </div>
}

function RequireProfile() {
  const profile = useProfileStore((state) => state.activeProfile)
  const isSettings = useLocation().pathname === '/settings'
  return profile ? <Outlet /> : <><header className={styles.guestHeading}><h1>{isSettings ? 'Настройки' : 'Статистика'}</h1></header><BentoCard title={isSettings ? 'Оформление для вашего профиля' : 'Ваши результаты обучения'}><p>{isSettings ? 'Тема, палитра, стиль и размер текста сохраняются отдельно для каждого профиля.' : 'Профиль сохраняет точность ответов, активность и прогресс слов. Гостевые результаты не записываются.'} Достаточно имени — регистрация не нужна.</p><Link className={styles.profileCta} to="/profile">Выбрать или создать профиль →</Link></BentoCard></>
}

const router = createBrowserRouter(createRoutesFromElements(<Route element={<Shell />}>
    <Route index element={<DashboardPage />} />
    <Route path="training" element={<TrainingPage />} />
    <Route path="dictionary" element={<DictionaryPage />} />
    <Route element={<RequireProfile />}>
    <Route path="statistics" element={<StatisticsPage />} />
    <Route path="settings" element={<SettingsPage />} />
    </Route>
    <Route path="profile" element={<ProfilePage />} />
    <Route path="*" element={<BentoCard><EmptyState title="Страница не найдена" action={<Link to="/">На главную</Link>}>Проверьте адрес или вернитесь на главную.</EmptyState></BentoCard>} />
  </Route>), { basename: import.meta.env.BASE_URL })

export function App() { return <RouterProvider router={router} /> }
