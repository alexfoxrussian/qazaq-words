import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Topic, Word } from '../entities/models';
import { wordPage, type WordSort } from '../features/word-management/list';
import { useProfileStore } from '../features/profiles/store';
import { filterWords } from '../features/word-management/filter';
import { useDictionaryUi } from '../features/word-management/store';
import {
    ConfirmationRequired,
    dictionaryRepository,
    type DictionarySnapshot,
    type WordDraft,
} from '../shared/db/dictionaryRepository';
import { MAX_DICTIONARY_BYTES, parseDictionaryFile } from '../entities/word/dictionaryTransfer';
import { dataErrorMessage } from '../shared/db/errors';
import { wordCount } from '../shared/utils/text';
import {
    BentoCard,
    Button,
    IconButton,
    EmptyState,
    FormField,
    Modal,
} from '../shared/ui/components';
import styles from './pages.module.css';

type Editor = { kind: 'word'; original?: Word } | { kind: 'topic'; original?: Topic };
type Operation = (confirmed: boolean) => Promise<unknown>;
interface Confirmation {
    reasons: string[];
    operation: Operation;
    message: string;
}
const blankWord: WordDraft = { kazakh: '', russian: '', topicIds: [] };
const sortLabels: Record<WordSort, string> = {
    'kazakh-asc': 'Казахское слово: А → Я',
    'kazakh-desc': 'Казахское слово: Я → А',
    'russian-asc': 'Перевод: А → Я',
    'russian-desc': 'Перевод: Я → А',
    'created-desc': 'Сначала новые',
    'created-asc': 'Сначала старые',
};

export function DictionaryPage() {
    const canEdit = !!useProfileStore((state) => state.activeProfile);
    const {
        search,
        topicId,
        sort,
        page,
        pageSize,
        setSearch,
        setTopicId,
        setSort,
        setPage,
        setPageSize,
    } = useDictionaryUi();
    const [snapshot, setSnapshot] = useState<DictionarySnapshot | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [editor, setEditor] = useState<Editor | null>(null);
    const [draft, setDraft] = useState<WordDraft>(blankWord);
    const [topicName, setTopicName] = useState('');
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const wordList = useRef<HTMLDivElement>(null);
    const scrollToWords = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState('');
    const [transferOpen, setTransferOpen] = useState(false);
    const [tagsExpanded, setTagsExpanded] = useState(
        () => window.matchMedia('(min-width: 640px)').matches,
    );
    const [filtersExpanded, setFiltersExpanded] = useState(
        () => window.matchMedia('(min-width: 640px)').matches,
    );

    useEffect(() => {
        const media = window.matchMedia('(min-width: 640px)');
        const update = () => {
            setTagsExpanded(media.matches);
            setFiltersExpanded(media.matches);
        };
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);

    useLayoutEffect(() => {
        if (!scrollToWords.current) {
            return;
        }
        scrollToWords.current = false;
        wordList.current?.focus({ preventScroll: true });
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        wordList.current?.scrollIntoView({
            block: 'start',
            behavior: reducedMotion ? 'instant' : 'smooth',
        });
    }, [page, pageSize]);

    function changePage(nextPage: number) {
        scrollToWords.current = true;
        setPage(nextPage);
    }

    useEffect(() => {
        setLoadError(null);
        const subscription = dictionaryRepository.observe().subscribe({
            next: (value) => {
                setSnapshot(value);
                setLoadError(null);
            },
            error: (cause: unknown) => setLoadError(dataErrorMessage(cause)),
        });
        return () => subscription.unsubscribe();
    }, [attempt]);

    useEffect(() => {
        if (snapshot && topicId && !snapshot.topics.some((topic) => topic.id === topicId)) {
            setTopicId('');
        }
    }, [snapshot, topicId, setTopicId]);

    async function run(operation: Operation, success: string, confirmed = false) {
        if (!canEdit || lock.current) {
            return;
        }
        lock.current = true;
        setBusy(true);
        setError(null);
        setMessage('');
        try {
            await operation(confirmed);
            setSnapshot(await dictionaryRepository.snapshot());
            setEditor(null);
            setConfirmation(null);
            setMessage(success);
        } catch (cause) {
            if (cause instanceof ConfirmationRequired) {
                setConfirmation({ reasons: cause.reasons, operation, message: success });
            } else {
                setError(dataErrorMessage(cause));
            }
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }

    async function exportDictionary() {
        if (!canEdit || lock.current) {
            return;
        }
        lock.current = true;
        setBusy(true);
        setError(null);
        try {
            const file = await dictionaryRepository.exportDictionary();
            const url = URL.createObjectURL(
                new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = `qazaq-words-dictionary-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage('Словарь экспортирован.');
        } catch (cause) {
            setError(dataErrorMessage(cause));
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }
    async function readImport(file: File) {
        if (!canEdit || lock.current) {
            return;
        }
        lock.current = true;
        setBusy(true);
        setError(null);
        setMessage('');

        try {
            if (file.size > MAX_DICTIONARY_BYTES) {
                throw new Error('Файл превышает 25 MiB.');
            }
            const data = parseDictionaryFile(await file.text());
            setConfirmation({
                reasons: [
                    `В файле слов: ${data.words.length}, тегов: ${data.topics.length}. Импорт дополнит словарь, существующие записи не удаляются. Совпадающие пары сохранят прогресс, их теги объединятся. Разные переводы одного казахского слова останутся отдельными записями. Активные тренировки будут прерваны; сохранённые ответы останутся.`,
                ],
                operation: (confirmed) => dictionaryRepository.importDictionary(data, confirmed),
                message: 'Слова и теги импортированы.',
            });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : dataErrorMessage(cause));
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }

    function openWord(original?: Word) {
        setError(null);
        setMessage('');
        setDraft(
            original
                ? {
                      kazakh: original.kazakh,
                      russian: original.russian,
                      topicIds: [...original.topicIds],
                  }
                : { ...blankWord, topicIds: [] },
        );
        setEditor({ kind: 'word', original });
    }
    function openTopic(original?: Topic) {
        setError(null);
        setMessage('');
        setTopicName(original?.name ?? '');
        setEditor({ kind: 'topic', original });
    }
    function submitWord(event: FormEvent) {
        event.preventDefault();
        if (editor?.kind !== 'word') {
            return;
        }
        const value = { ...draft, topicIds: [...draft.topicIds] };
        const original = editor.original;
        void run(
            (confirmed) => dictionaryRepository.saveWord(value, original, confirmed),
            'Слово сохранено.',
        );
    }
    function submitTopic(event: FormEvent) {
        event.preventDefault();
        if (editor?.kind !== 'topic') {
            return;
        }
        const value = topicName;
        const original = editor.original;
        void run(
            (confirmed) => dictionaryRepository.saveTopic(value, original, confirmed),
            'Тег сохранён.',
        );
    }
    const feedback = (
        <>
            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}
            {message && (
                <p role="status" className={styles.muted}>
                    {message}
                </p>
            )}
        </>
    );
    const effectiveTopicId = snapshot?.topics.some((topic) => topic.id === topicId) ? topicId : '';
    const words = filterWords(snapshot?.words ?? [], search, effectiveTopicId);
    const pagination = wordPage(words, sort, page, pageSize);
    const hasFilters = !!(search || topicId || sort !== 'kazakh-asc');

    return (
        <>
            <header className={`${styles.heading} ${styles.compactHeading}`}>
                <h1>Словарь</h1>
                <p>
                    {snapshot ? wordCount(snapshot.words.length) : 'Слова и переводы'} · общий для
                    всех профилей
                </p>
            </header>
            {loadError ? (
                <BentoCard title="Не удалось загрузить словарь">
                    <p role="alert">{loadError}</p>
                    <Button onClick={() => setAttempt((value) => value + 1)}>
                        Повторить загрузку
                    </Button>
                </BentoCard>
            ) : !snapshot ? (
                <p role="status">Загружаем словарь…</p>
            ) : (
                <>
                    {!editor && !confirmation && feedback}
                    <div className={styles.dictionaryLayout}>
                        <div className={styles.grid}>
                            <BentoCard className={`${styles.wide} ${styles.dictionaryCard}`}>
                                <h2 className={styles.srOnly}>Слова и переводы</h2>
                                <div className={styles.dictionarySearch}>
                                    <FormField
                                        id="word-search"
                                        label="Поиск слова или перевода"
                                        placeholder="Поиск по словарю"
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                    />
                                </div>
                                <details
                                    className={styles.dictionaryFilters}
                                    open={filtersExpanded}
                                    onToggle={(event) =>
                                        setFiltersExpanded(event.currentTarget.open)
                                    }
                                >
                                    <summary>
                                        Фильтры и сортировка
                                        {(effectiveTopicId || sort !== 'kazakh-asc') && (
                                            <span className={styles.filterState}>
                                                {[
                                                    snapshot.topics.find(
                                                        (topic) => topic.id === effectiveTopicId,
                                                    )?.name,
                                                    sort !== 'kazakh-asc' ? sortLabels[sort] : null,
                                                ]
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                            </span>
                                        )}
                                    </summary>
                                    <div className={styles.dictionaryTools}>
                                        <label className={styles.selectField}>
                                            Тег словаря
                                            <select
                                                value={effectiveTopicId}
                                                onChange={(event) => setTopicId(event.target.value)}
                                            >
                                                <option value="">Все теги</option>
                                                {snapshot.topics.map((topic) => (
                                                    <option key={topic.id} value={topic.id}>
                                                        {topic.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className={styles.selectField}>
                                            Сортировка
                                            <select
                                                value={sort}
                                                onChange={(event) =>
                                                    setSort(event.target.value as WordSort)
                                                }
                                            >
                                                {(
                                                    Object.entries(sortLabels) as [
                                                        WordSort,
                                                        string,
                                                    ][]
                                                ).map(([value, label]) => (
                                                    <option key={value} value={value}>
                                                        {label}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                </details>
                                <div className={styles.actions}>
                                    {canEdit && (
                                        <>
                                            <Button disabled={busy} onClick={() => openWord()}>
                                                Добавить слово
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                disabled={busy}
                                                onClick={() => setTransferOpen(true)}
                                            >
                                                <MoreHorizontal size={18} aria-hidden="true" />{' '}
                                                Действия
                                            </Button>
                                        </>
                                    )}
                                    {hasFilters && (
                                        <Button
                                            variant="secondary"
                                            onClick={() => {
                                                setSearch('');
                                                setTopicId('');
                                                setSort('kazakh-asc');
                                            }}
                                        >
                                            Сбросить фильтры
                                        </Button>
                                    )}
                                </div>
                                <input
                                    ref={fileInput}
                                    type="file"
                                    accept=".json,application/json"
                                    hidden
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        event.target.value = '';
                                        if (file) {
                                            void readImport(file);
                                        }
                                    }}
                                />
                                {words.length === 0 ? (
                                    <EmptyState
                                        title={
                                            snapshot.words.length
                                                ? 'Совпадений нет'
                                                : 'Словарь пока пуст'
                                        }
                                    >
                                        {snapshot.words.length
                                            ? 'Измените запрос или выберите другой тег.'
                                            : 'Добавьте своё первое слово и один русский перевод. Словарь общий для всех профилей.'}
                                    </EmptyState>
                                ) : (
                                    <div
                                        ref={wordList}
                                        className={styles.wordList}
                                        role="region"
                                        aria-label="Список слов"
                                        tabIndex={-1}
                                    >
                                        <div
                                            className={`${styles.newOnly} ${styles.wordColumns} ${!canEdit ? styles.readOnlyColumns : ''}`}
                                            aria-hidden="true"
                                        >
                                            <span lang="kk">Қазақша</span>
                                            <span>Русский перевод</span>
                                            {canEdit && <span>Действия</span>}
                                        </div>
                                        {pagination.words.map((word, index) => (
                                            <article
                                                key={word.id}
                                                className={styles.wordRow}
                                                data-continuation={
                                                    index > 0 &&
                                                    pagination.words[index - 1].kazakh ===
                                                        word.kazakh
                                                }
                                            >
                                                <h3 lang="kk">
                                                    <span
                                                        className={
                                                            index > 0 &&
                                                            pagination.words[index - 1].kazakh ===
                                                                word.kazakh
                                                                ? styles.srOnly
                                                                : undefined
                                                        }
                                                    >
                                                        {word.kazakh}
                                                    </span>
                                                </h3>
                                                <p>{word.russian}</p>
                                                <div className={styles.tags}>
                                                    {word.topicIds.map((id) => (
                                                        <span key={id}>
                                                            {
                                                                snapshot.topics.find(
                                                                    (topic) => topic.id === id,
                                                                )?.name
                                                            }
                                                        </span>
                                                    ))}
                                                </div>
                                                <div className={styles.actions}>
                                                    {canEdit && (
                                                        <>
                                                            <IconButton
                                                                label={`Редактировать слово ${word.kazakh} — ${word.russian}`}
                                                                disabled={busy}
                                                                onClick={() => openWord(word)}
                                                            >
                                                                <Pencil
                                                                    size={18}
                                                                    aria-hidden="true"
                                                                />
                                                            </IconButton>
                                                            <IconButton
                                                                label={`Удалить слово ${word.kazakh} — ${word.russian}`}
                                                                disabled={busy}
                                                                onClick={() =>
                                                                    void run(
                                                                        (confirmed) =>
                                                                            dictionaryRepository.removeWord(
                                                                                word,
                                                                                confirmed,
                                                                            ),
                                                                        'Слово удалено.',
                                                                    )
                                                                }
                                                            >
                                                                <Trash2
                                                                    size={18}
                                                                    aria-hidden="true"
                                                                />
                                                            </IconButton>
                                                        </>
                                                    )}
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                )}
                                {!canEdit && (
                                    <p className={styles.muted}>
                                        Чтобы добавлять и изменять слова,{' '}
                                        <Link to="/profile">выберите или создайте профиль</Link>.
                                    </p>
                                )}
                                <div className={styles.pagination}>
                                    <p className={styles.muted} role="status">
                                        {pagination.start}–{pagination.end} из{' '}
                                        {pagination.total.toLocaleString('ru-RU')}
                                    </p>
                                    <label className={styles.selectField}>
                                        На странице
                                        <select
                                            value={pageSize}
                                            onChange={(event) => {
                                                scrollToWords.current = true;
                                                setPageSize(Number(event.target.value));
                                            }}
                                        >
                                            {[10, 20, 50].map((size) => (
                                                <option key={size} value={size}>
                                                    {size}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <nav
                                        className={styles.pageNavigation}
                                        aria-label="Страницы словаря"
                                    >
                                        <IconButton
                                            label="Предыдущая страница"
                                            disabled={pagination.page === 1}
                                            onClick={() => changePage(pagination.page - 1)}
                                        >
                                            <ChevronLeft size={20} aria-hidden="true" />
                                        </IconButton>
                                        <span>
                                            Страница {pagination.page} из {pagination.pages}
                                        </span>
                                        <IconButton
                                            label="Следующая страница"
                                            disabled={pagination.page === pagination.pages}
                                            onClick={() => changePage(pagination.page + 1)}
                                        >
                                            <ChevronRight size={20} aria-hidden="true" />
                                        </IconButton>
                                    </nav>
                                </div>
                            </BentoCard>
                            <BentoCard className={styles.tagPanel}>
                                <details
                                    className={styles.tagDetails}
                                    open={tagsExpanded}
                                    onToggle={(event) => setTagsExpanded(event.currentTarget.open)}
                                >
                                    <summary>
                                        Теги словаря <span>{snapshot.topics.length}</span>
                                    </summary>
                                    <div className={styles.tagContent}>
                                        <p className={styles.muted}>
                                            Классификация общих слов для поиска и тренировки.
                                        </p>
                                        {canEdit && (
                                            <Button disabled={busy} onClick={() => openTopic()}>
                                                Добавить тег
                                            </Button>
                                        )}
                                        {!snapshot.topics.length && (
                                            <p className={styles.muted}>
                                                Тегов пока нет. Слова можно добавлять без тега.
                                            </p>
                                        )}
                                        {snapshot.topics.map((topic) => (
                                            <article className={styles.topicRow} key={topic.id}>
                                                <div className={styles.topicName}>
                                                    <h3>{topic.name}</h3>
                                                    <span
                                                        className={`${styles.newOnly} ${styles.topicCount}`}
                                                    >
                                                        {wordCount(
                                                            snapshot.words.filter((word) =>
                                                                word.topicIds.includes(topic.id),
                                                            ).length,
                                                        )}
                                                    </span>
                                                </div>
                                                <div className={styles.actions}>
                                                    {canEdit && (
                                                        <>
                                                            <IconButton
                                                                label={`Переименовать тег ${topic.name}`}
                                                                disabled={busy}
                                                                onClick={() => openTopic(topic)}
                                                            >
                                                                <Pencil
                                                                    size={18}
                                                                    aria-hidden="true"
                                                                />
                                                            </IconButton>
                                                            <IconButton
                                                                label={`Удалить тег ${topic.name}`}
                                                                disabled={busy}
                                                                onClick={() =>
                                                                    void run(
                                                                        (confirmed) =>
                                                                            dictionaryRepository.removeTopic(
                                                                                topic,
                                                                                confirmed,
                                                                            ),
                                                                        'Тег удалён.',
                                                                    )
                                                                }
                                                            >
                                                                <Trash2
                                                                    size={18}
                                                                    aria-hidden="true"
                                                                />
                                                            </IconButton>
                                                        </>
                                                    )}
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                </details>
                            </BentoCard>
                        </div>
                    </div>
                </>
            )}
            {canEdit && transferOpen && (
                <Modal
                    title="Действия со словарём"
                    closeLabel="Закрыть"
                    busy={busy}
                    onClose={() => setTransferOpen(false)}
                >
                    <p className={styles.muted}>
                        Переносит только слова и теги, без профилей и результатов. Для полной копии
                        используйте «Резервную копию» в Настройках.
                    </p>
                    <div className={styles.transferActions}>
                        <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                                setTransferOpen(false);
                                void exportDictionary();
                            }}
                        >
                            Экспортировать словарь
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                                setTransferOpen(false);
                                fileInput.current?.click();
                            }}
                        >
                            Импортировать словарь
                        </Button>
                    </div>
                    <p className={styles.muted}>
                        Все слова и теги, независимо от фильтров. Импорт дополняет словарь и
                        сохраняет прогресс. Файл JSON до 25 MiB.
                    </p>
                </Modal>
            )}
            {canEdit && editor && !confirmation && (
                <Modal
                    key="editor"
                    title={
                        editor.kind === 'word'
                            ? editor.original
                                ? 'Редактировать слово'
                                : 'Добавить слово'
                            : editor.original
                              ? 'Переименовать тег'
                              : 'Добавить тег'
                    }
                    closeLabel="Отмена"
                    busy={busy}
                    footer={
                        <Button type="submit" form="dictionary-editor" disabled={busy}>
                            {busy
                                ? 'Сохраняем…'
                                : editor.kind === 'word'
                                  ? 'Сохранить слово'
                                  : 'Сохранить тег'}
                        </Button>
                    }
                    onClose={() => {
                        setEditor(null);
                        setError(null);
                    }}
                >
                    <p>Это изменит словарь для всех профилей.</p>
                    {editor.kind === 'word' ? (
                        <form id="dictionary-editor" className={styles.form} onSubmit={submitWord}>
                            <FormField
                                id="word-kazakh"
                                lang="kk"
                                label="Казахское слово"
                                value={draft.kazakh}
                                onChange={(event) =>
                                    setDraft({ ...draft, kazakh: event.target.value })
                                }
                                required
                                maxLength={200}
                                disabled={busy}
                            />
                            <FormField
                                id="word-russian"
                                label="Русский перевод"
                                value={draft.russian}
                                onChange={(event) =>
                                    setDraft({ ...draft, russian: event.target.value })
                                }
                                required
                                maxLength={200}
                                disabled={busy}
                            />
                            <details className={styles.editorTags}>
                                <summary>Теги · выбрано {draft.topicIds.length}</summary>
                                <fieldset className={styles.topicChoices} disabled={busy}>
                                    <legend>Теги (необязательно)</legend>
                                    {snapshot?.topics.map((topic) => (
                                        <label key={topic.id}>
                                            <input
                                                type="checkbox"
                                                checked={draft.topicIds.includes(topic.id)}
                                                onChange={(event) =>
                                                    setDraft({
                                                        ...draft,
                                                        topicIds: event.target.checked
                                                            ? [...draft.topicIds, topic.id]
                                                            : draft.topicIds.filter(
                                                                  (id) => id !== topic.id,
                                                              ),
                                                    })
                                                }
                                            />
                                            {topic.name}
                                        </label>
                                    ))}
                                    {!snapshot?.topics.length && (
                                        <p className={styles.muted}>Тегов пока нет.</p>
                                    )}
                                </fieldset>
                            </details>
                            {feedback}
                        </form>
                    ) : (
                        <form id="dictionary-editor" className={styles.form} onSubmit={submitTopic}>
                            <FormField
                                id="topic-name"
                                label="Название тега"
                                value={topicName}
                                onChange={(event) => setTopicName(event.target.value)}
                                required
                                maxLength={80}
                                disabled={busy}
                            />
                            {feedback}
                        </form>
                    )}
                </Modal>
            )}
            {canEdit && confirmation && (
                <Modal
                    key="confirmation"
                    title="Подтвердите изменение словаря"
                    closeLabel="Отмена"
                    focusCancel
                    busy={busy}
                    onClose={() => {
                        setConfirmation(null);
                        setError(null);
                    }}
                >
                    <p>Это изменит словарь для всех профилей.</p>
                    {confirmation.reasons.map((reason) => (
                        <p key={reason}>{reason}</p>
                    ))}
                    {feedback}
                    <div className={styles.actions}>
                        <Button
                            disabled={busy}
                            onClick={() =>
                                void run(confirmation.operation, confirmation.message, true)
                            }
                        >
                            Подтвердить изменение
                        </Button>
                    </div>
                </Modal>
            )}
        </>
    );
}
