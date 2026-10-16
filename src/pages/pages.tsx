import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { BentoCard, Button, ProfileAvatar } from '../shared/ui/components'
import { useProfileStore } from '../features/profiles/store'
import { useStatistics } from '../features/statistics/useStatistics'
import { useTrainingStore } from '../features/training/store'
import type { Profile } from '../entities/models'
export { SettingsPage } from './SettingsPage'
export { StatisticsPage } from './StatisticsPage'
import styles from './pages.module.css'

function ProfileProgress({ profile, action }: { profile: Profile; action: ReactNode }) {
  const { data, error, retry } = useStatistics(profile.id, 'all')
  const percentage = (data?.learningProgress ?? 0) * 100
  const progressLabel = percentage > 0 && percentage < 0.01 ? '<0,01%' : `${percentage.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`
  const metrics = data && <>
    <dl className={styles.homeNumbers}><div><dt>Начато слов</dt><dd>{(data.totalWords - data.newCount).toLocaleString('ru-RU')} <span>из {data.totalWords.toLocaleString('ru-RU')}</span></dd></div><div><dt>Закреплено</dt><dd>{data.masteredCount.toLocaleString('ru-RU')}</dd></div><div><dt>К повторению сейчас</dt><dd>{data.dueCount.toLocaleString('ru-RU')}</dd></div></dl>
    <div className={styles.homeProgressLabel}><span>Средний уровень повторения</span><strong>{progressLabel}</strong></div>
    <progress className={styles.progress} aria-label="Средний уровень повторения по всему словарю" aria-valuetext={progressLabel} max={1} value={data.learningProgress} />
    <details className={styles.progressHelp}><summary>Как считается прогресс?</summary><p>Полоса усредняет ступени повторения от 0 до 5 по всем словам, включая новые. Верный первый ответ повышает ступень, ошибка сбрасывает её. Добавление слов может уменьшить процент. «Закреплено» — слова на ступени 5, а не оценка знания языка.</p></details>
  </>
  return <>
    <div className={styles.homeIdentity}><ProfileAvatar profile={profile} className={styles.homePhoto} /><div><h2><span lang="kk">Сәлем</span>, {profile.name}</h2><p>{data?.answeredCount === 0 ? 'Начните с первой тренировки' : 'Ваш прогресс по общему словарю'}</p></div></div>
    <div className={styles.homeActions}>{action}</div>
    {error ? <><p role="alert">{error}</p><Button onClick={retry}>Повторить</Button></> : data ? <>
      {data.answeredCount === 0 ? <div className={styles.firstPractice}><p>{data.totalWords === 0 ? 'Добавьте слова в словарь, чтобы начать.' : 'Выберите длину тренировки и попробуйте перевести первые слова. Результат покажет верные первые ответы и слова с ошибками.'}</p><details className={styles.progressHelp}><summary>Показатели словаря</summary>{metrics}</details></div> : <>{metrics}<p className={styles.homeNextStep}>{data.totalWords === 0 ? 'Добавьте слова в словарь, чтобы начать.' : data.dueCount > 0 ? 'Начните с повторения: эти слова будут первыми в очереди.' : data.newCount > 0 ? 'Сейчас можно познакомиться с новыми словами.' : 'Повторения пока не подошли. При желании можно потренироваться ещё.'}</p></>}
    </> : <p role="status">Загружаем прогресс…</p>}
  </>
}

export function DashboardPage() {
  const profile = useProfileStore((state) => state.activeProfile)
  const hasActiveSession = useTrainingStore((state) => state.session?.status === 'active')
  const trainingAction = <Link className={styles.heroLink} to="/training">{hasActiveSession ? 'Продолжить тренировку' : 'Начать тренировку'} <ArrowUpRight size={18} aria-hidden="true" /></Link>
  return <>
    <header className={`${styles.heading} ${styles.compactHeading}`}><h1>{profile ? 'Главная' : 'Казахский каждый день'}</h1></header>
    <div className={`${styles.grid} ${styles.dashboardGrid}`}>
      <BentoCard className={`${styles.hero} ${styles.full}`}><div className={styles.heroBody}>{profile ? <ProfileProgress profile={profile} action={trainingAction} /> : <><h2>Практика казахских слов</h2><p>Выбирайте перевод из четырёх вариантов. Можно попробовать как гость; профиль сохранит результаты следующих тренировок.</p><div className={styles.homeActions}>{trainingAction}<Link className={styles.secondaryLink} to="/profile">Выбрать или создать профиль</Link></div></>}</div><div className={styles.wordPair} aria-label="Сөз — слово"><span lang="kk">сөз</span><span className={styles.pairTranslation}><span aria-hidden="true">→</span> слово</span></div></BentoCard>
    </div>
  </>
}
