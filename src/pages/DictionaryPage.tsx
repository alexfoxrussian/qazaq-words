import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Topic, Word } from '../entities/models'
import { wordPage, type WordSort } from '../features/word-management/list'
import { useProfileStore } from '../features/profiles/store'
import { filterWords } from '../features/word-management/filter'
import { useDictionaryUi } from '../features/word-management/store'
import { ConfirmationRequired, dictionaryRepository, type DictionarySnapshot, type WordDraft } from '../shared/db/dictionaryRepository'
import { MAX_DICTIONARY_BYTES, parseDictionaryFile } from '../entities/word/dictionaryTransfer'
import { dataErrorMessage } from '../shared/db/errors'
import { BentoCard, Button, IconButton, EmptyState, FormField, Modal } from '../shared/ui/components'
import styles from './pages.module.css'

type Editor = { kind: 'word'; original?: Word } | { kind: 'topic'; original?: Topic }
type Operation = (confirmed: boolean) => Promise<unknown>
interface Confirmation { reasons: string[]; operation: Operation; message: string }
const blankWord: WordDraft = { kazakh: '', russian: '', topicIds: [] }

export function DictionaryPage() {
  const canEdit = !!useProfileStore((state) => state.activeProfile)
  const { search, topicId, sort, page, pageSize, setSearch, setTopicId, setSort, setPage, setPageSize } = useDictionaryUi()
  const [snapshot, setSnapshot] = useState<DictionarySnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState<WordDraft>(blankWord)
  const [topicName, setTopicName] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const wordList = useRef<HTMLDivElement>(null)
  const scrollToWords = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  useLayoutEffect(() => {
    if (!scrollToWords.current) return
    scrollToWords.current = false
    wordList.current?.focus({ preventScroll: true })
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    wordList.current?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' })
  }, [page, pageSize])

  function changePage(nextPage: number) {
    scrollToWords.current = true
    setPage(nextPage)
  }

  useEffect(() => {
    setLoadError(null)
    const subscription = dictionaryRepository.observe().subscribe({
      next: (value) => { setSnapshot(value); setLoadError(null) },
      error: (cause: unknown) => setLoadError(dataErrorMessage(cause)),
    })
    return () => subscription.unsubscribe()
  }, [attempt])

  // A removed topic must not leave an invisible filter applied.
  useEffect(() => {
    if (snapshot && topicId && !snapshot.topics.some((topic) => topic.id === topicId)) setTopicId('')
  }, [snapshot, topicId, setTopicId])

  async function run(operation: Operation, success: string, confirmed = false) {
    if (!canEdit || lock.current) return
    lock.current = true; setBusy(true); setError(null); setMessage('')
    try {
      await operation(confirmed)
      setSnapshot(await dictionaryRepository.snapshot())
      setEditor(null); setConfirmation(null); setMessage(success)
    } catch (cause) {
      if (cause instanceof ConfirmationRequired) setConfirmation({ reasons: cause.reasons, operation, message: success })
      else setError(dataErrorMessage(cause))
    } finally { lock.current = false; setBusy(false) }
  }

  async function exportDictionary() {
    if (!canEdit || lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      const file = await dictionaryRepository.exportDictionary()
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `qazaq-words-dictionary-${new Date().toISOString().slice(0, 10)}.json`; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('Словарь экспортирован.')
    } catch (cause) { setError(dataErrorMessage(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  async function readImport(file: File) {
    if (!canEdit || lock.current) return
    lock.current = true; setBusy(true); setError(null); setMessage('')
    try {
      if (file.size > MAX_DICTIONARY_BYTES) throw new Error('Файл превышает 25 MiB.')
      const data = parseDictionaryFile(await file.text())
      setConfirmation({ reasons: [`В файле слов: ${data.words.length}, тем: ${data.topics.length}. Импорт дополнит словарь, существующие записи не удаляются. Совпадающие пары сохранят прогресс, их темы объединятся. Разные переводы одного казахского слова останутся отдельными записями. Активные тренировки будут прерваны; сохранённые ответы останутся.`], operation: (confirmed) => dictionaryRepository.importDictionary(data, confirmed), message: 'Слова и темы импортированы.' })
    } catch (cause) { setError(cause instanceof Error ? cause.message : dataErrorMessage(cause)) }
    finally { lock.current = false; setBusy(false) }
  }

  function openWord(original?: Word) {
    setError(null); setMessage('')
    setDraft(original ? { kazakh: original.kazakh, russian: original.russian, topicIds: [...original.topicIds] } : { ...blankWord, topicIds: [] })
    setEditor({ kind: 'word', original })
  }
  function openTopic(original?: Topic) {
    setError(null); setMessage(''); setTopicName(original?.name ?? '')
    setEditor({ kind: 'topic', original })
  }
  function submitWord(event: FormEvent) {
    event.preventDefault()
    if (editor?.kind !== 'word') return
    const value = { ...draft, topicIds: [...draft.topicIds] }
    const original = editor.original
    void run((confirmed) => dictionaryRepository.saveWord(value, original, confirmed), 'Слово сохранено.')
  }
  function submitTopic(event: FormEvent) {
    event.preventDefault()
    if (editor?.kind !== 'topic') return
    const value = topicName; const original = editor.original
    void run((confirmed) => dictionaryRepository.saveTopic(value, original, confirmed), 'Тема сохранена.')
  }
  const feedback = <>{error && <p className={styles.error} role="alert">{error}</p>}<p role="status" className={styles.muted}>{message}</p></>
  const effectiveTopicId = snapshot?.topics.some((topic) => topic.id === topicId) ? topicId : ''
  const words = filterWords(snapshot?.words ?? [], search, effectiveTopicId)

  const pagination = wordPage(words, sort, page, pageSize)

  return <>
    <header className={styles.heading}><span className={styles.eyebrow}>ОБЩИЙ ДЛЯ ВСЕХ ПРОФИЛЕЙ</span><h1>Словарь</h1><p>Ваши казахские слова, русские переводы и темы.</p></header>
    {loadError ? <BentoCard title="Не удалось загрузить словарь"><p role="alert">{loadError}</p><Button onClick={() => setAttempt((value) => value + 1)}>Повторить загрузку</Button></BentoCard> : !snapshot ? <p role="status">Загружаем словарь…</p> : <>
      {!canEdit && <p className={styles.muted}>Гость может просматривать словарь и тренироваться. Для изменения слов <Link to="/profile">войдите в профиль</Link>.</p>}
      {!editor && !confirmation && feedback}
      <div className={styles.dictionaryLayout}>
      <div className={styles.grid}>
        <BentoCard className={styles.wide} title={`Слова · ${snapshot.words.length}`}>
          <div className={styles.dictionaryTools}>
            <FormField id="word-search" label="Поиск слова или перевода" placeholder="Поиск по словарю" value={search} onChange={(event) => setSearch(event.target.value)} />
            <label className={styles.selectField}>Тема словаря<select value={effectiveTopicId} onChange={(event) => setTopicId(event.target.value)}><option value="">Все темы</option>{snapshot.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>
            <label className={styles.selectField}>Сортировка<select value={sort} onChange={(event) => setSort(event.target.value as WordSort)}><option value="kazakh-asc">Казахское слово: А → Я</option><option value="kazakh-desc">Казахское слово: Я → А</option><option value="russian-asc">Перевод: А → Я</option><option value="russian-desc">Перевод: Я → А</option><option value="created-desc">Сначала новые</option><option value="created-asc">Сначала старые</option></select></label>
          </div>
          <div className={styles.actions}>{canEdit && <><Button disabled={busy} onClick={() => openWord()}>Добавить слово</Button><Button variant="secondary" disabled={busy} onClick={() => void exportDictionary()}>Экспортировать словарь</Button><Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>Импортировать словарь</Button></>}{(search || topicId) && <Button variant="secondary" onClick={() => { setSearch(''); setTopicId('') }}>Сбросить фильтры</Button>}</div>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readImport(file) }} />
          {canEdit && <p className={styles.muted}>Импорт и экспорт JSON включают все слова и темы, независимо от фильтров и страницы. Импорт дополняет словарь и сохраняет прогресс. Файл до 25 MiB.</p>}
          {words.length === 0 ? <EmptyState title={snapshot.words.length ? 'Совпадений нет' : 'Словарь пока пуст'}>{snapshot.words.length ? 'Измените запрос или выберите другую тему.' : 'Добавьте своё первое слово и один русский перевод. Словарь общий для всех профилей.'}</EmptyState> : <div ref={wordList} className={styles.wordList} role="region" aria-label="Список слов" tabIndex={-1}>
            <div className={`${styles.newOnly} ${styles.wordColumns}`} aria-hidden="true"><span>Қазақша</span><span>Русский перевод</span><span>Действия</span></div>
            {pagination.words.map((word) => <article key={word.id} className={styles.wordRow}>
              <h3>{word.kazakh}</h3><p>{word.russian}</p>
              <div className={styles.tags}>{word.topicIds.map((id) => <span key={id}>{snapshot.topics.find((topic) => topic.id === id)?.name}</span>)}</div>
              <div className={styles.actions}>{canEdit && <><IconButton label={`Редактировать слово ${word.kazakh}`} disabled={busy} onClick={() => openWord(word)}><Pencil size={18} aria-hidden="true" /></IconButton><IconButton label={`Удалить слово ${word.kazakh}`} disabled={busy} onClick={() => void run((confirmed) => dictionaryRepository.removeWord(word, confirmed), 'Слово удалено.')}><Trash2 size={18} aria-hidden="true" /></IconButton></>}</div>
            </article>)}
          </div>}
          <div className={styles.pagination}>
            <p className={styles.muted} role="status">{pagination.start}–{pagination.end} из {pagination.total} слов</p>
            <label className={styles.selectField}>На странице<select value={pageSize} onChange={(event) => { scrollToWords.current = true; setPageSize(Number(event.target.value)) }}>{[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
            <nav className={styles.pageNavigation} aria-label="Страницы словаря"><IconButton label="Предыдущая страница" disabled={pagination.page === 1} onClick={() => changePage(pagination.page - 1)}><ChevronLeft size={20} aria-hidden="true" /></IconButton><span>Страница {pagination.page} из {pagination.pages}</span><IconButton label="Следующая страница" disabled={pagination.page === pagination.pages} onClick={() => changePage(pagination.page + 1)}><ChevronRight size={20} aria-hidden="true" /></IconButton></nav>
          </div>
        </BentoCard>
        <BentoCard title="Темы словаря"><p className={styles.muted}>Классификация общих слов для поиска и тренировки.</p>{canEdit && <Button disabled={busy} onClick={() => openTopic()}>Добавить тему</Button>}
          {!snapshot.topics.length && <p className={styles.muted}>Тем пока нет. Слова можно добавлять без темы.</p>}
          {snapshot.topics.map((topic) => <article className={styles.topicRow} key={topic.id}><div className={styles.topicName}><h3>{topic.name}</h3><span className={`${styles.newOnly} ${styles.topicCount}`}>{snapshot.words.filter((word) => word.topicIds.includes(topic.id)).length} слов</span></div><div className={styles.actions}>{canEdit && <><IconButton label={`Переименовать тему ${topic.name}`} disabled={busy} onClick={() => openTopic(topic)}><Pencil size={18} aria-hidden="true" /></IconButton><IconButton label={`Удалить тему ${topic.name}`} disabled={busy} onClick={() => void run((confirmed) => dictionaryRepository.removeTopic(topic, confirmed), 'Тема удалена.')}><Trash2 size={18} aria-hidden="true" /></IconButton></>}</div></article>)}
        </BentoCard>
      </div></div>
    </>}
    {canEdit && editor && !confirmation && <Modal key="editor" title={editor.kind === 'word' ? (editor.original ? 'Редактировать слово' : 'Добавить слово') : (editor.original ? 'Переименовать тему' : 'Добавить тему')} closeLabel="Отмена" busy={busy} onClose={() => { setEditor(null); setError(null) }}>
      <p>Это изменит словарь для всех профилей.</p>
      {editor.kind === 'word' ? <form className={styles.form} onSubmit={submitWord}>
        <FormField id="word-kazakh" label="Казахское слово" value={draft.kazakh} onChange={(event) => setDraft({ ...draft, kazakh: event.target.value })} required maxLength={200} disabled={busy} />
        <FormField id="word-russian" label="Русский перевод" value={draft.russian} onChange={(event) => setDraft({ ...draft, russian: event.target.value })} required maxLength={200} disabled={busy} />
        <fieldset className={styles.topicChoices} disabled={busy}><legend>Темы (необязательно)</legend>{snapshot?.topics.map((topic) => <label key={topic.id}><input type="checkbox" checked={draft.topicIds.includes(topic.id)} onChange={(event) => setDraft({ ...draft, topicIds: event.target.checked ? [...draft.topicIds, topic.id] : draft.topicIds.filter((id) => id !== topic.id) })} />{topic.name}</label>)}{!snapshot?.topics.length && <p className={styles.muted}>Тем пока нет.</p>}</fieldset>
        {feedback}<Button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить слово'}</Button>
      </form> : <form className={styles.form} onSubmit={submitTopic}><FormField id="topic-name" label="Название темы" value={topicName} onChange={(event) => setTopicName(event.target.value)} required maxLength={80} disabled={busy} />{feedback}<Button type="submit" disabled={busy}>Сохранить тему</Button></form>}
    </Modal>}
    {canEdit && confirmation && <Modal key="confirmation" title="Подтвердите изменение словаря" closeLabel="Отмена" focusCancel busy={busy} onClose={() => { setConfirmation(null); setError(null) }}>
      <p>Это изменит словарь для всех профилей.</p>{confirmation.reasons.map((reason) => <p key={reason}>{reason}</p>)}
      {feedback}<div className={styles.actions}><Button disabled={busy} onClick={() => void run(confirmation.operation, confirmation.message, true)}>Подтвердить изменение</Button></div>
    </Modal>}
  </>
}
