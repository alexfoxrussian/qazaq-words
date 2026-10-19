import { useState } from 'react';
import { Target, ChartNoAxesCombined, Flame } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buildActivityCalendar, type Period } from '../entities/answer/statistics';
import { useProfileStore } from '../features/profiles/store';
import { useStatistics } from '../features/statistics/useStatistics';
import { BentoCard, Button, EmptyState } from '../shared/ui/components';
import styles from './pages.module.css';

function dayLabel(day: string) {
    return new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}
export function StatisticsPage() {
    const profileId = useProfileStore((state) => state.activeProfile)!.id;
    const [period, setPeriod] = useState<Period>('7');
    const { data, error, retry } = useStatistics(profileId, period);
    const calendar = buildActivityCalendar(data?.days ?? [], period, Date.now());
    const maximum = Math.max(1, ...calendar.map((day) => day?.answers ?? 0));
    return (
        <>
            <header className={styles.heading}>
                <h1>Статистика</h1>
                <p>Сохранённые ответы и текущее состояние слов.</p>
            </header>
            <div
                className={`${styles.actions} ${styles.periodSwitch}`}
                role="group"
                aria-label="Период статистики"
            >
                {(['7', '30', 'all'] as const).map((value) => (
                    <Button
                        key={value}
                        variant={period === value ? 'primary' : 'secondary'}
                        aria-pressed={period === value}
                        onClick={() => setPeriod(value)}
                    >
                        {value === 'all' ? 'Всё время' : `${value} дней`}
                    </Button>
                ))}
            </div>
            {error ? (
                <BentoCard title="Не удалось загрузить статистику">
                    <p role="alert">{error}</p>
                    <Button onClick={retry}>Повторить</Button>
                </BentoCard>
            ) : !data ? (
                <p role="status">Считаем статистику…</p>
            ) : (
                <div className={`${styles.grid} ${styles.statisticsGrid}`}>
                    <BentoCard className={styles.metricCard} title="Точность">
                        <span
                            className={`${styles.newOnly} ${styles.metricIcon}`}
                            aria-hidden="true"
                        >
                            <Target size={22} />
                        </span>
                        <strong className={styles.metric}>
                            {data.accuracy === null ? '—' : `${data.accuracy}%`}
                        </strong>
                        <p className={styles.muted}>
                            {data.accuracy === null
                                ? 'Нет данных'
                                : `Правильных ответов: ${data.correctCount} из ${data.answeredCount}`}
                        </p>
                    </BentoCard>
                    <BentoCard className={styles.metricCard} title="Ответы">
                        <span
                            className={`${styles.newOnly} ${styles.metricIcon}`}
                            aria-hidden="true"
                        >
                            <ChartNoAxesCombined size={22} />
                        </span>
                        <strong className={styles.metric}>{data.answeredCount}</strong>
                        <p className={styles.muted}>
                            Завершено тренировок: {data.completedCount}. Учитываются также ответы
                            прерванных сеансов.
                        </p>
                    </BentoCard>
                    <BentoCard className={styles.metricCard} title="Серия дней">
                        <span
                            className={`${styles.newOnly} ${styles.metricIcon}`}
                            aria-hidden="true"
                        >
                            <Flame size={22} />
                        </span>
                        <strong className={styles.metric}>{data.streak}</strong>
                        <p className={styles.muted}>
                            Текущая серия за всё время. День с хотя бы одним ответом; серия
                            продолжается, если вы занимались сегодня или вчера.
                        </p>
                    </BentoCard>
                    <BentoCard
                        className={`${styles.full} ${styles.activityPanel}`}
                        title="Активность по дням"
                    >
                        {!data.answeredCount ? (
                            <EmptyState
                                title="Нет ответов за этот период"
                                action={<Link to="/training">Начать тренировку →</Link>}
                            >
                                Выберите другой период или начните практику.
                            </EmptyState>
                        ) : (
                            <>
                                <p className={styles.muted} id="activity-help">
                                    Каждый квадрат — день. Чем насыщеннее цвет, тем больше ответов.
                                    Значения доступны в таблице ниже.
                                    {period === 'all'
                                        ? ' Календарь показывает последние 365 дней; показатели и таблица — всё время.'
                                        : ''}
                                </p>
                                <div
                                    className={styles.tableScroll}
                                    role="region"
                                    tabIndex={0}
                                    aria-label="Календарь активности, прокрутка по горизонтали"
                                    aria-describedby="activity-help"
                                >
                                    <div
                                        className={styles.activityCalendar}
                                        role="list"
                                        aria-label="Активность по дням"
                                    >
                                        {calendar.map((day, index) =>
                                            day ? (
                                                <span
                                                    key={day.day}
                                                    role="listitem"
                                                    className={styles.activityDay}
                                                    data-level={
                                                        day.answers
                                                            ? Math.max(
                                                                  1,
                                                                  Math.ceil(
                                                                      (day.answers / maximum) * 4,
                                                                  ),
                                                              )
                                                            : 0
                                                    }
                                                    aria-label={`${dayLabel(day.day)}: ${day.answers} ответов, ${day.correct} правильных`}
                                                    title={`${dayLabel(day.day)}: ${day.answers} ответов, ${day.correct} правильных`}
                                                />
                                            ) : (
                                                <span key={`empty-${index}`} aria-hidden="true" />
                                            ),
                                        )}
                                    </div>
                                </div>
                                <div className={styles.activityLegend}>
                                    <span>Меньше</span>
                                    {[0, 1, 2, 3, 4].map((level) => (
                                        <span
                                            key={level}
                                            aria-hidden="true"
                                            className={styles.activityDay}
                                            data-level={level}
                                        />
                                    ))}
                                    <span>Больше</span>
                                </div>
                                <details>
                                    <summary>Значения по дням</summary>
                                    <div className={styles.tableScroll}>
                                        <table className={styles.dataTable}>
                                            <caption>Активность выбранного профиля</caption>
                                            <thead>
                                                <tr>
                                                    <th scope="col">Дата</th>
                                                    <th scope="col">Ответы</th>
                                                    <th scope="col">Верно</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {data.days.map((day) => (
                                                    <tr key={day.day}>
                                                        <th scope="row">{dayLabel(day.day)}</th>
                                                        <td>{day.answers}</td>
                                                        <td>{day.correct}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </details>
                            </>
                        )}
                    </BentoCard>
                    <BentoCard
                        className={`${styles.full} ${styles.studyPanel}`}
                        title="Изучение слов"
                    >
                        <p className={styles.muted}>
                            Текущее состояние всего словаря, независимо от периода. Ступень отражает
                            интервалы повторения.
                        </p>
                        <p>
                            Всего: {data.totalWords}. Новых: {data.newCount}. Изучаемых (ступени
                            1–5): {data.learningCount}. Закреплённых (ступень 5):{' '}
                            {data.masteredCount}.
                        </p>
                        <div className={styles.stageList}>
                            {data.stages.map(({ stage, count }) => (
                                <div key={stage}>
                                    <span>
                                        Ступень {stage}
                                        {stage === 0 ? ' · после ошибки' : ''}
                                    </span>
                                    <strong>{count}</strong>
                                    <progress
                                        aria-label={`Слов на ступени ${stage}`}
                                        max={Math.max(1, data.totalWords)}
                                        value={count}
                                    />
                                </div>
                            ))}
                        </div>
                    </BentoCard>
                    <BentoCard
                        className={`${styles.full} ${styles.historyPanel}`}
                        title="Последние ответы"
                    >
                        {!data.recentAnswers.length ? (
                            <p className={styles.muted}>Нет данных за этот период.</p>
                        ) : (
                            <ol className={styles.answerHistory}>
                                {data.recentAnswers.map((answer) => (
                                    <li key={answer.id} data-correct={answer.isCorrect}>
                                        <strong lang="kk">{answer.kazakhSnapshot}</strong>
                                        <span>{answer.russianSnapshot}</span>
                                        <span
                                            className={
                                                answer.isCorrect ? styles.correctText : styles.error
                                            }
                                        >
                                            {answer.isCorrect ? 'Верно' : 'Неверно'} · Ваш ответ:{' '}
                                            {answer.optionsSnapshot[answer.selectedIndex]}
                                        </span>
                                        <time dateTime={new Date(answer.answeredAt).toISOString()}>
                                            {new Date(answer.answeredAt).toLocaleString('ru-RU')}
                                        </time>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </BentoCard>
                </div>
            )}
        </>
    );
}
