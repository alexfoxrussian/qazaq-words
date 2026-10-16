import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
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
  const getResultFocus = useCallback(() => resultRef.current, [])
  const blocker = useBlocker(({ currentLocation, nextLocation }) => session?.status === 'active' && currentLocation.pathname !== nextLocation.pathname)
  const leaveOpen = blocker.state === 'blocked'
  const currentAnswer = answers.find((answer) => answer.questionIndex === visibleIndex)
  const question = session?.queueSnapshots[visibleIndex]
  const resolved = !!session && !!currentAnswer && session.cursor > visibleIndex
  const [attempts, setAttempts] = useState<{ key: string; indices: number[] }>({ key: '', indices: [] })
  const questionKey = `${session?.id}:${visibleIndex}`
  const lastFocusedQuestion = useRef('')
  const showResult = view !== 'prepare' && !!session && session.status !== 'active' && (session.status === 'interrupted' || visibleIndex >= session.targetCount)
  const wrongIndices = [...(attempts.key === questionKey ? attempts.indices : []), ...(currentAnswer && !currentAnswer.isCorrect ? [currentAnswer.selectedIndex] : [])]
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
    if (showResult) resultRef.current?.focus()
    else if (view === 'session' && questionRef.current) {
      questionRef.current.focus({ preventScroll: true })
      if (lastFocusedQuestion.current !== questionKey && window.matchMedia('(max-width: 639px)').matches) {
        const word = questionRef.current.querySelector('h2')?.getBoundingClientRect()
        const options = questionRef.current.querySelector('[data-answer-options]')?.getBoundingClientRect()
        const navigation = document.querySelector('nav[aria-label="Основная навигация"]')?.getBoundingClientRect()
        const visibleBottom = Math.min(window.innerHeight, navigation?.top ?? window.innerHeight) - 12
        if (word && options && (word.top < 12 || options.bottom > visibleBottom)) questionRef.current.scrollIntoView({ block: 'start', behavior: 'instant' })
      }
      lastFocusedQuestion.current = questionKey
    }
  }, [view, questionKey, answers.length, resolved, showResult])

  useEffect(() => {
    if (view !== 'session' || !resolved || busy || finishOpen || leaveOpen) return
    const timer = window.setTimeout(() => useTrainingStore.getState().advance(), 1000)
    return () => window.clearTimeout(timer)
  }, [view, resolved, questionKey, busy, finishOpen, leaveOpen])

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
    if (!session || session.status !== 'active' || resolved || busy || lock.current || wrongIndices.includes(selectedIndex) || finishOpen || leaveOpen) return
    void perform(() => repository.answer(profile.id, session.id, visibleIndex, selectedIndex), () => {
      if (selectedIndex !== question?.correctIndex) setAttempts((previous) => ({ key: questionKey, indices: [...(previous.key === questionKey ? previous.indices : []), selectedIndex] }))
    })
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || busy || finishOpen || leaveOpen) return
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return
    if (/^[1-4]$/.test(event.key) && !resolved) { event.preventDefault(); answer(Number(event.key) - 1) }
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
      else useTrainingStore.getState().advance()
    })
  }
  const feedback = <p role="status" className={resolved ? styles.correctText : currentAnswer ? styles.error : styles.muted}>{resolved ? 'Верно! Следующее слово через секунду…' : currentAnswer ? 'Неверно. Попробуйте другой вариант.' : 'Выберите перевод слова.'}</p>

  return <>
    <header className={`${styles.heading} ${styles.compactHeading} ${view === 'session' && !showResult ? styles.activeTrainingHeading : ''}`}><h1>Тренировка</h1><p>Выберите перевод казахского слова.</p></header>
    {!finishOpen && !leaveOpen && error && <p role="alert" className={styles.error}>{error}</p>}
    {view === 'prepare' && <BentoCard className={styles.prepareCard}>
      <h2 className={styles.srOnly}>Подготовка тренировки</h2>
      <label className={styles.selectField}>Тег тренировки<select value={topicId} disabled={busy} onChange={(event) => setTopicId(event.target.value)}><option value="">Все теги</option>{preparation?.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>
      <div className={styles.lengthField}><span id="session-length-label">Количество вопросов</span><div className={styles.lengthChoices} role="group" aria-labelledby="session-length-label">{[10, 20, 30].map((length) => <Button key={length} variant={lengthChoice === String(length) ? 'primary' : 'secondary'} disabled={busy} aria-pressed={lengthChoice === String(length)} onClick={() => { setCustomProfile(null); void perform(() => setLength(length)) }}>{length}</Button>)}</div><details className={styles.lengthExtra} open={isCustom || savedLength === 0 ? true : undefined}><summary>Другие варианты длины{savedLength === 0 ? ' · весь словарь' : isCustom ? ` · ${savedLength || 'свой вариант'}` : ''}</summary><label className={styles.selectField}>Длина сеанса<select value={['10', '20', '30'].includes(lengthChoice) ? '' : lengthChoice} disabled={busy} onChange={(event) => {
        if (event.target.value === 'custom') { setCustomProfile(profile.id); setCustomLength(String(savedLength || 10)) }
        else if (event.target.value === '0') { setCustomProfile(null); void perform(() => setLength(0)) }
      }}><option value="" disabled>Выберите длину</option><option value="custom">Свой вариант</option><option value="0">Весь словарь</option></select></label>
      {isCustom && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void perform(() => setLength( Number(customValue))) }}>
        <FormField id="custom-session-length" label="Количество вопросов" type="number" min={1} step={1} required disabled={busy} value={customValue} onChange={(event) => { setCustomProfile(profile.id); setCustomLength(event.target.value) }} />
        <Button type="submit" variant="secondary" disabled={busy || !unsavedLength}>Сохранить длину</Button>
      </form>}</details></div>
      {!preparation && !error && <p role="status">Готовим очередь…</p>}
      {preparation && <>
        <div className={styles.sessionPreview} role="status"><strong>{unsavedLength ? 'Сохраните количество вопросов' : `Вопросов: ${preparation.questions.length}`}</strong><span>Доступно слов: {(preparation.eligibleCount - preparation.skippedCount).toLocaleString('ru-RU')}</span></div>
        {!!preparation.skippedCount && <details className={styles.helpDetails}><summary>Почему пропущено слов: {preparation.skippedCount}?</summary><p className={styles.muted}>Для них нет трёх уникальных неверных переводов. Другие переводы того же казахского слова не используются как неверные варианты.</p></details>}
        {!preparation.questions.length && <EmptyState title={preparation.skippedCount ? 'Недостаточно вариантов' : 'Очередь пуста'} action={<Link to="/dictionary">Открыть словарь →</Link>}>{preparation.skippedCount ? 'Для этой тренировки нужны слова хотя бы с четырьмя разными переводами.' : 'В словаре нет подходящих слов. Добавьте слова или смените тег.'}</EmptyState>}
      </>}
      <div className={styles.actions}><Button disabled={busy || unsavedLength || !preparation?.questions.length} onClick={() => void perform(() => repository.start(profile.id, topicId), () => useTrainingStore.getState().setView('session'))}>Начать тренировку</Button></div>
      <p className={styles.prepareNote}>{activeProfile ? 'Точность учитывает первую попытку.' : 'Гость: результаты не сохраняются. Точность — по первой попытке.'}</p>
    </BentoCard>}
    {view === 'resume' && session?.status === 'active' && <BentoCard title="Сохранённая тренировка"><p>Ответов сохранено: {session.answeredCount} из {session.targetCount}. Вы можете продолжить с последнего сохранённого результата.</p><div className={styles.actions}><Button disabled={busy} onClick={() => useTrainingStore.getState().setView('session')}>Продолжить тренировку</Button><Button variant="secondary" disabled={busy} onClick={() => setFinishOpen(true)}>Завершить</Button></div></BentoCard>}
    {view === 'session' && session && session.status !== 'interrupted' && question && <BentoCard className={styles.trainingCard}>
      <div ref={questionRef} tabIndex={0} role="region" aria-label="Вопрос тренировки" onKeyDown={keyDown} className={styles.questionPane}>
        <p className={styles.muted}>Вопрос {visibleIndex + 1} из {session.targetCount}</p>
        <progress className={styles.progress} aria-label="Прогресс тренировки" value={session.cursor} max={session.targetCount} />
        <p className={`${styles.newOnly} ${styles.languageLabel}`}><span lang="kk">ҚАЗАҚША</span> → РУССКИЙ</p>
        <h2 className={styles.trainingWord} lang="kk">{question.kazakh}</h2>
        <div className={styles.options} data-answer-options>{question.options.map((option, index) => <button key={`${questionKey}:${index}`} className={`${styles.answerOption} ${resolved && index === question.correctIndex ? styles.correctOption : ''} ${wrongIndices.includes(index) ? styles.incorrectOption : ''}`} disabled={busy || resolved || wrongIndices.includes(index) || finishOpen || leaveOpen} onClick={() => answer(index)}><span className={styles.optionNumber}>{index + 1}<span className={styles.optionDot}>.</span></span>{' '}<span className={styles.optionLabel}>{option}</span><small className={styles.optionStatus}>{resolved && index === question.correctIndex ? 'Правильный ответ' : wrongIndices.includes(index) ? 'Неверный вариант' : '\u00a0'}</small></button>)}</div>
        <div className={styles.answerFeedback}>{busy ? <p role="status" className={styles.muted}>{activeProfile ? 'Сохраняем ответ…' : 'Проверяем ответ…'}</p> : feedback}</div>
        <div className={styles.trainingFooter}><p className={styles.keyboardHint}>Клавиши 1–4 — выбор ответа</p><Button variant="secondary" disabled={busy || resolved} onClick={() => setFinishOpen(true)}>Завершить</Button></div>
      </div>
    </BentoCard>}
    {showResult && session && <BentoCard className={styles.resultCard}>
      <h2 ref={resultRef} tabIndex={-1}>{session.status === 'completed' ? 'Тренировка завершена' : 'Тренировка прервана'}</h2>
      <p className={styles.resultScore}><strong>{session.correctCount}<span> из {session.answeredCount}</span></strong><span>верно с первой попытки</span></p>
      <div className={styles.resultMetrics}><div><strong>{accuracy === null ? '—' : `${accuracy}%`}</strong><span>Точность</span></div><div><strong>{session.answeredCount - session.correctCount}</strong><span>Слов с ошибками</span></div><div><strong>{session.cursor} / {session.targetCount}</strong><span>Пройдено вопросов</span></div></div>
      <p className={styles.muted}>{activeProfile ? 'Сохранённые ответы остаются в истории. Можно сразу начать новую тренировку.' : 'Это гостевая тренировка. Результат показан только сейчас и не сохраняется.'}</p>
      {!activeProfile && <p className={styles.muted}><Link to="/profile">Создать профиль для следующих тренировок</Link></p>}
      <div className={styles.resultActions}><Button onClick={() => { setError(null); useTrainingStore.getState().setView('prepare') }}>Новая тренировка</Button><div><Link to="/">На главную</Link>{activeProfile && <Link to="/statistics">Статистика</Link>}</div></div>
    </BentoCard>}
    {(finishOpen || leaveOpen) && <Modal title="Завершить тренировку?" closeLabel="Остаться" focusCancel getReturnFocus={getResultFocus} busy={busy} onClose={cancelFinish}>
      <p>{activeProfile ? 'Сеанс будет прерван. Уже сохранённые ответы и прогресс останутся.' : 'Гостевой сеанс будет завершён без сохранения результатов.'}</p>{error && <p role="alert" className={styles.error}>{error}</p>}<div className={styles.actions}><Button disabled={busy} onClick={finish}>Завершить сеанс</Button></div>
    </Modal>}
  </>
}
