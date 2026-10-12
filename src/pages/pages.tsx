import { Link } from 'react-router-dom'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { BentoCard, Button, ProfileAvatar } from '../shared/ui/components'
import { useProfileStore } from '../features/profiles/store'
import { useStatistics } from '../features/statistics/useStatistics'
import type { Profile } from '../entities/models'
export { SettingsPage } from './SettingsPage'
export { StatisticsPage } from './StatisticsPage'
import styles from './pages.module.css'

function ProfileProgress({ profile }: { profile: Profile }) {
  const { data, error, retry } = useStatistics(profile.id, 'all')
  return <div className={styles.homeIdentity}><ProfileAvatar profile={profile} className={styles.homePhoto} /><div><h2>Сәлем, {profile.name}</h2><p>Ваш прогресс изучения слов</p>{error ? <><p role="alert">{error}</p><Button onClick={retry}>Повторить</Button></> : data ? <progress className={styles.progress} aria-label="Средний прогресс изучения слов словаря" max={1} value={data.learningProgress} /> : <p role="status">Загружаем прогресс…</p>}</div></div>
}

export function DashboardPage() {
  const profile = useProfileStore((state) => state.activeProfile)
  return <>
    <header className={styles.heading}><span className={styles.eyebrow}>ВАШЕ ОБУЧЕНИЕ</span><h1>Небольшой шаг каждый день</h1><p>Слова. Практика. Прогресс.</p></header>
    <div className={`${styles.grid} ${styles.dashboardGrid}`}>
      <BentoCard className={`${styles.hero} ${styles.full}`}><div className={styles.heroBody}><span className={styles.badge}><Sparkles size={16} aria-hidden="true" /> Учитесь в своём темпе</span>{profile ? <ProfileProgress profile={profile} /> : <><h2>Новые слова.<br />Знакомый язык.</h2><p>Попробуйте тренировку как гость или войдите в локальный профиль, чтобы сохранять прогресс.</p></>}<div className={styles.homeActions}><Link className={styles.heroLink} to="/training">Начать тренировку <ArrowUpRight size={18} aria-hidden="true" /></Link>{!profile && <Link className={styles.heroLink} to="/profile">Войти</Link>}</div>{!profile && <div className={styles.letters} aria-hidden="true">Ә ә · Қ қ · Ө ө</div>}</div><div className={`${styles.newOnly} ${styles.heroArt}`} aria-hidden="true"><span className={styles.heroGlyph}>Ә</span><span className={styles.heroArtLabel}>ҚАЗАҚ ТІЛІ</span><span className={styles.heroArtChip}>Сөз → Слово</span></div></BentoCard>
    </div>
  </>
}
