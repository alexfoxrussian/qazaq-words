import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useBlocker } from 'react-router-dom'
import { useProfileStore } from '../features/profiles/store'
import { useTrainingStore } from '../features/training/store'
import { calculateAccuracy } from '../entities/answer/metrics'
import { guestRepository } from '../features/training/guestRepository'
import { trainingRepository } from '../shared/db/trainingRepository'
import { dataErrorMessage } from '../shared/db/errors'
import { BentoCard, Button, EmptyState, FormField, Modal } from '../shared/ui/components'
import styles from './pages.module.css'

type Preparation = Awaited<ReturnType<typeof trainingRepository.prepare>>

export function TrainingPage() {
  const activeProfile = useProfileStore((state) => state.activeProfile)
  const profile = activeProfile ?? { id: 'guest' }
  const repository = activeProfile ? trainingRepository : guestRepository
  const [guestLength, setGuestLength] = useState(() => guestRepository.sessionLength)
  const settings = useProfileStore((state) => state.settings)
  const { session, answers, view, visibleIndex } = useTrainingStore()
  const [topicId, setTopicId] = useState('')
  const [customProfile, setCustomProfile] = useState<string | null>(null)
  const [customLength, setCustomLength] = useState('')
  const savedLength = activeProfile ? settings?.sessionLength ?? 10 : guestLength
  const isCustom = customProfile === profile.id || ![0, 10, 20, 30].includes(savedLength)
  const lengthChoice = isCustom ? 'custom' : String(savedLength)
  const customValue = customProfile === profile.id ? customLength : String(savedLength)
  const unsavedLength = isCustom && (Number(customValue) !== savedLength || !customValue || Number(customValue) < 1)
  const [preparation, setPreparation] = useState<Preparation | null>(null)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [finishOpen, setFinishOpen] = useState(false)
  const questionRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLHeadingElement>(null)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => session?.status === 'active' && currentLocation.pathname !== nextLocation.pathname)
  const leaveOpen = blocker.state === 'blocked'
  const currentAnswer = answers.find((answer) => answer.questionIndex === visibleIndex)
  const question = session?.queueSnapshots[visibleIndex]
  const accuracy = session ? calculateAccuracy(session.correctCount, session.answeredCount) : null

  useEffect(() => {
    if (view !== 'prepare') return
    setPreparation(null); setError(null)
    const subscription = repository.observePreparation(profile.id, topicId).subscribe({
      next: setPreparation,
      error: (cause: unknown) => setError(dataErrorMessage(cause)),
    })
    const timer = window.setInterval(() => setRevision((value) => value + 1), 30_000)
    return () => { subscription.unsubscribe(); window.clearInterval(timer) }
  }, [profile.id, topicId, view, revision, repository, guestLength])

  useEffect(() => {
    if (view === 'session') {
      if (session?.status === 'completed') resultRef.current?.focus()
      else questionRef.current?.focus()
    }
  }, [view, visibleIndex, answers.length, session?.status])

  async function perform(operation: () => Promise<unknown>, after?: () => void) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      await operation()
      useTrainingStore.getState().apply(profile.id, activeProfile ? await trainingRepository.snapshot(profile.id) : await guestRepository.snapshot())
      after?.()
    } catch (cause) { setError(dataErrorMessage(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  async function setLength(value: number) {
    await repository.setSessionLength(profile.id, value)
    if (!activeProfile) setGuestLength(value)
  }
  function answer(selectedIndex: number) {
    if (!session || session.status !== 'active' || currentAnswer || finishOpen || leaveOpen) return
    void perform(() => repository.answer(profile.id, session.id, visibleIndex, selectedIndex))
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || busy || finishOpen || leaveOpen) return
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return
    if (/^[1-4]$/.test(event.key) && !currentAnswer) { event.preventDefault(); answer(Number(event.key) - 1) }
    if (event.key === 'Enter' && currentAnswer && session?.status === 'active') {
      event.preventDefault(); useTrainingStore.getState().advance()
    }
  }
  function cancelFinish() {
    if (leaveOpen) blocker.reset()
    setFinishOpen(false); setError(null)
  }
  function finish() {
    if (!session) return
    void perform(() => repository.interrupt(profile.id, session.id), () => {
      setFinishOpen(false)
      if (leaveOpen) blocker.proceed()
      else useTrainingStore.getState().setView('prepare')
    })
  }
  const feedback = currentAnswer && <p role="status" className={currentAnswer.isCorrect ? styles.correctText : styles.error}>{currentAnswer.isCorrect ? 'Верно.' : 'Неверно.'} Правильный перевод: {currentAnswer.russianSnapshot}</p>

  return <>
    <header className={styles.heading}><span className={styles.eyebrow}>ПРАКТИКА</span><h1>Тренировка</h1><p>Казахское слово и четыре перевода. Проверка автоматическая.</p></header>
    {!finishOpen && !leaveOpen && error && <p role="alert" className={styles.error}>{error}</p>}
    {view === 'prepare' && <BentoCard className={styles.prepareCard} title="Подготовка тренировки">
      <label className={styles.selectField}>Тег тренировки<select value={topicId} disabled={busy} onChange={(event) => setTopicId(event.target.value)}><option value="">Все теги</option>{preparation?.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>
      <label className={styles.selectField}>Длина сеанса<select value={lengthChoice} disabled={busy} onChange={(event) => {
        if (event.target.value === 'custom') { setCustomProfile(profile.id); setCustomLength(String(savedLength || 10)) }
        else { setCustomProfile(null); void perform(() => setLength( Number(event.target.value))) }
      }}><option value="10">10</option><option value="20">20</option><option value="30">30</option><option value="custom">Свой вариант</option><option value="0">Весь словарь</option></select></label>
      {isCustom && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void perform(() => setLength( Number(customValue))) }}>
        <FormField id="custom-session-length" label="Количество вопросов" type="number" min={1} step={1} required disabled={busy} value={customValue} onChange={(event) => { setCustomProfile(profile.id); setCustomLength(event.target.value) }} />
        <Button type="submit" variant="secondary" disabled={busy || !unsavedLength}>Сохранить длину</Button>
      </form>}
      <p className={styles.muted}>Если слов меньше, сеанс будет короче. «Весь словарь» включает все пригодные слова выбранного тега. {activeProfile ? 'Выбор сохраняется для профиля.' : 'Гостевые результаты и настройки не сохраняются.'}</p>
      {!preparation && !error && <p role="status">Готовим очередь…</p>}
      {preparation && <>
        <p role="status">Доступно слов: {preparation.eligibleCount - preparation.skippedCount}.</p>
        {!!preparation.skippedCount && <p className={styles.muted}>Пропущено вопросов: {preparation.skippedCount}. Для них нет трёх уникальных неверных переводов. Другие переводы того же казахского слова не используются как неверные варианты.</p>}
        {!preparation.questions.length && <EmptyState title={preparation.skippedCount ? 'Недостаточно вариантов' : 'Очередь пуста'} action={<Link to="/dictionary">Открыть словарь →</Link>}>{preparation.skippedCount ? 'Для этой тренировки нужны слова хотя бы с четырьмя разными переводами.' : 'В словаре нет подходящих слов. Добавьте слова или смените тег.'}</EmptyState>}
      </>}
      <div className={styles.actions}><Button disabled={busy || unsavedLength || !preparation?.questions.length} onClick={() => void perform(() => repository.start(profile.id, topicId), () => useTrainingStore.getState().setView('session'))}>Начать тренировку</Button></div>
    </BentoCard>}
    {view === 'resume' && session?.status === 'active' && <BentoCard title="Сохранённая тренировка"><p>Ответов сохранено: {session.answeredCount} из {session.targetCount}. Вы можете продолжить с последнего сохранённого результата.</p><div className={styles.actions}><Button disabled={busy} onClick={() => useTrainingStore.getState().setView('session')}>Продолжить тренировку</Button><Button variant="secondary" disabled={busy} onClick={() => setFinishOpen(true)}>Завершить</Button></div></BentoCard>}
    {view === 'session' && session?.status === 'active' && question && <BentoCard className={styles.trainingCard}>
      <div ref={questionRef} tabIndex={0} role="region" aria-label="Вопрос тренировки" onKeyDown={keyDown} className={styles.questionPane}>
        <p className={styles.muted}>Вопрос {visibleIndex + 1} из {session.targetCount} · {activeProfile ? 'Сохранено ответов' : 'Ответов'}: {session.answeredCount}</p>
        <progress className={styles.progress} aria-label="Прогресс тренировки" value={session.answeredCount} max={session.targetCount} />
        <p className={`${styles.newOnly} ${styles.languageLabel}`}>ҚАЗАҚША → РУССКИЙ</p>
        <h2 className={styles.trainingWord}>{question.kazakh}</h2>
        <div className={styles.options}>{question.options.map((option, index) => <button key={index} className={`${styles.answerOption} ${currentAnswer && index === question.correctIndex ? styles.correctOption : ''} ${currentAnswer && index === currentAnswer.selectedIndex && !currentAnswer.isCorrect ? styles.incorrectOption : ''}`} disabled={busy || !!currentAnswer || finishOpen || leaveOpen} onClick={() => answer(index)}><span className={styles.optionNumber}>{index + 1}<span className={styles.optionDot}>.</span></span>{' '}<span className={styles.optionLabel}>{option}</span>{currentAnswer && index === question.correctIndex && <small>Правильный ответ</small>}{currentAnswer && index === currentAnswer.selectedIndex && !currentAnswer.isCorrect && <small>Ваш ответ · неверно</small>}</button>)}</div>
        {busy && <p role="status">{activeProfile ? 'Сохраняем ответ…' : 'Проверяем ответ…'}</p>}{feedback}
        <p className={styles.muted}>Клавиши 1–4 выбирают вариант, Enter — следующий вопрос после результата.</p>
        <div className={styles.actions}>{currentAnswer && <Button disabled={busy} onClick={() => useTrainingStore.getState().advance()}>Дальше</Button>}<Button variant="secondary" disabled={busy} onClick={() => setFinishOpen(true)}>Завершить</Button></div>
      </div>
    </BentoCard>}
    {view !== 'prepare' && session && session.status !== 'active' && <BentoCard>
      <h2 ref={resultRef} tabIndex={-1}>{session.status === 'completed' ? 'Тренировка завершена' : 'Тренировка прервана'}</h2>
      {feedback}<p>Ответов: {session.answeredCount} из {session.targetCount}. Правильных: {session.correctCount}. Точность: {accuracy === null ? 'Нет данных' : `${accuracy}%`}.</p>
      <p className={styles.muted}>{activeProfile ? 'Сохранённые ответы остаются в истории. Можно сразу начать новую тренировку.' : 'Это гостевая тренировка. Результат показан только сейчас и не сохраняется.'}</p>
      <div className={styles.actions}><Button onClick={() => { setError(null); useTrainingStore.getState().setView('prepare') }}>Новая тренировка</Button><Link to="/">На главную</Link><Link to="/statistics">Статистика</Link></div>
    </BentoCard>}
    {(finishOpen || leaveOpen) && <Modal title="Завершить тренировку?" closeLabel="Остаться" focusCancel busy={busy} onClose={cancelFinish}>
      <p>{activeProfile ? 'Сеанс будет прерван. Уже сохранённые ответы и прогресс останутся.' : 'Гостевой сеанс будет завершён без сохранения результатов.'}</p>{error && <p role="alert" className={styles.error}>{error}</p>}<div className={styles.actions}><Button disabled={busy} onClick={finish}>Завершить сеанс</Button></div>
    </Modal>}
  </>
}
