import { useLayoutEffect } from 'react'
import { createBrowserRouter, createRoutesFromElements, Link, NavLink, Outlet, Route, RouterProvider, useLocation } from 'react-router-dom'
import { BookOpen, ChartNoAxesCombined, House, Settings, Sparkles, UserRound, type LucideIcon } from 'lucide-react'
import { DashboardPage, SettingsPage, StatisticsPage } from '../pages/pages'
import { TrainingPage } from '../pages/TrainingPage'
import { AppearanceProvider } from './AppearanceProvider'
import { TrainingProvider } from './TrainingProvider'
import { DictionaryPage } from '../pages/DictionaryPage'
import { ProfilePage } from '../pages/ProfilePage'
import { DataGate } from './DataGate'
import { useProfileStore } from '../features/profiles/store'
import { BentoCard, EmptyState } from '../shared/ui/components'
import styles from './shell.module.css'

const navigation: { path: string; label: string; icon: LucideIcon }[] = [
  { path: '/', label: 'Главная', icon: House },
  { path: '/training', label: 'Тренировка', icon: Sparkles },
  { path: '/dictionary', label: 'Словарь', icon: BookOpen },
  { path: '/statistics', label: 'Статистика', icon: ChartNoAxesCombined },
  { path: '/profile', label: 'Профиль', icon: UserRound },
  { path: '/settings', label: 'Настройки', icon: Settings },
]

function Shell() {
  const location = useLocation()
  useLayoutEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) }, [location.key])
  return <div className={styles.shell}>
    <a className={styles.skip} href="#content">Перейти к содержимому</a>
    <aside className={styles.sidebar}>
      <Link to="/" className={styles.brand}><span className={styles.logo}>Q</span><span>Qazaq Words<small>Казахский каждый день</small></span></Link>
      <nav className={styles.navigation} aria-label="Основная навигация">
        {navigation.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} end={path === '/'} className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}><Icon size={20} aria-hidden="true" /><span>{label}</span></NavLink>)}
      </nav>
      <div className={styles.localNote}><span className={styles.dot} />Локальное приложение<p>Ваше обучение — на этом устройстве.</p></div>
    </aside>
    <main id="content" className={styles.main} tabIndex={-1}>

      <DataGate><AppearanceProvider /><TrainingProvider><Outlet /></TrainingProvider></DataGate>
      <footer className={styles.footer}>Qazaq Words · Локальное обучение</footer>
    </main>
  </div>
}

function RequireProfile() {
  const profile = useProfileStore((state) => state.activeProfile)
  return profile ? <Outlet /> : <BentoCard title="Войдите в профиль"><EmptyState title="Ваши настройки и статистика" action={<Link to="/profile">Войти или создать профиль →</Link>}>Войдите в локальный профиль, чтобы сохранять результаты и менять оформление.</EmptyState></BentoCard>
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
  </Route>))

export function App() { return <RouterProvider router={router} /> }
