import { describe, expect, it } from 'vitest';
import type { Answer, Progress, TrainingSession, Word } from '../models';
import { buildActivityCalendar, localDay, summarizeStatistics } from './statistics';
const now = new Date(2026, 9, 10, 12).getTime();
const time = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
const word = (id: string): Word => ({
    id,
    kazakh: id,
    russian: id,
    topicIds: [],
    createdAt: 0,
    updatedAt: 0,
});
const answer = (id: string, at: number, correct: boolean): Answer => ({
    id,
    profileId: 'p',
    sessionId: 's',
    wordId: id,
    questionIndex: 0,
    kazakhSnapshot: id,
    russianSnapshot: id,
    optionsSnapshot: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    selectedIndex: correct ? 0 : 1,
    isCorrect: correct,
    answeredAt: at,
});
const progress = (wordId: string, stage: number, dueAt: number): Progress => ({
    profileId: 'p',
    wordId,
    stage,
    dueAt,
    lastAnsweredAt: 0,
    correctCount: 1,
    incorrectCount: 0,
});
describe('статистика по локальным календарным дням', () => {
    it('различает полночь, включает первый день периода и исключает будущие ответы', () => {
        const midnight = new Date(2026, 9, 4, 0).getTime();
        const result = summarizeStatistics(
            [],
            [],
            [
                answer('old', midnight - 1, true),
                answer('first', midnight, false),
                answer('today', now, true),
                answer('future', now + 1, true),
            ],
            [],
            '7',
            now,
        );
        expect(result.answeredCount).toBe(2);
        expect(result.accuracy).toBe(50);
        expect(result.days).toHaveLength(7);
        expect(result.days[0]).toEqual({ day: localDay(midnight), answers: 1, correct: 0 });
        expect(localDay(midnight - 1)).not.toBe(localDay(midnight));
    });
    it('считает точность и историю независимо от удаления слов, а ступени только для текущих слов', () => {
        const result = summarizeStatistics(
            [word('1'), word('2'), word('3')],
            [progress('1', 5, now), progress('2', 0, now + 1), progress('deleted', 5, 0)],
            [answer('deleted', now, false), answer('1', now - 1, true), answer('2', now - 2, true)],
            [],
            'all',
            now,
        );
        expect(result.accuracy).toBe(67);
        expect(result).toMatchObject({
            answeredCount: 3,
            dueCount: 1,
            newCount: 1,
            learningCount: 1,
            masteredCount: 1,
            totalWords: 3,
        });
        expect(result.stages.map((item) => item.count)).toEqual([1, 0, 0, 0, 0, 1]);
        expect(result.recentAnswers[0].wordId).toBe('deleted');
    });
    it('серия продолжается от вчера, считается за всё время и обрывается при пропуске', () => {
        const answers = [
            answer('a', time(9), true),
            answer('b', time(8), false),
            answer('c', time(6), true),
        ];
        expect(summarizeStatistics([], [], answers, [], '7', now).streak).toBe(2);
        expect(summarizeStatistics([], [], answers, [], 'all', time(11)).streak).toBe(0);
        expect(
            summarizeStatistics([], [], [...answers, answer('d', now, true)], [], '30', now).streak,
        ).toBe(3);
    });
    it('нулевые данные не создают точность, а период 30 содержит пустые дни', () => {
        const result = summarizeStatistics([], [], [], [], '30', now);
        expect(result.accuracy).toBeNull();
        expect(result.streak).toBe(0);
        expect(result.days).toHaveLength(30);
        expect(result.days.every((day) => day.answers === 0)).toBe(true);
    });
    it('считает завершённые сеансы по дате окончания, прерванные ответы входят в точность', () => {
        const sessions = [
            { status: 'completed', endedAt: now },
            { status: 'interrupted', endedAt: now },
            { status: 'completed', endedAt: time(1) },
        ] as TrainingSession[];
        expect(
            summarizeStatistics([], [], [answer('a', now, false)], sessions, '7', now),
        ).toMatchObject({ completedCount: 1, answeredCount: 1, accuracy: 0 });
    });
});

it('календарь сохраняет понедельник первым, пустые дни и 29 февраля', () => {
    const leapNow = new Date(2024, 2, 3, 12).getTime();
    const cells = buildActivityCalendar(
        [{ day: '2024-02-29', answers: 4, correct: 3 }],
        '7',
        leapNow,
    );
    expect(cells).toHaveLength(7);
    expect(cells[0]?.day).toBe('2024-02-26');
    expect(cells[3]).toEqual({ day: '2024-02-29', answers: 4, correct: 3 });
    expect(cells[6]).toEqual({ day: '2024-03-03', answers: 0, correct: 0 });
    const short = buildActivityCalendar([], '7', now);
    expect(short[0]).toBeNull();
    expect(short[6]?.day).toBe('2026-10-04');
    expect(buildActivityCalendar([], 'all', now).filter(Boolean)).toHaveLength(365);
});

it('усредняет ступени только текущего словаря, включая новые слова и сброс после ошибки', () => {
    const words = ['a', 'b', 'c', 'd'].map((id) => ({ id })) as Word[];
    const progress = [
        { wordId: 'a', stage: 1 },
        { wordId: 'b', stage: 3 },
        { wordId: 'c', stage: 5 },
        { wordId: 'deleted', stage: 5 },
    ] as Progress[];
    expect(summarizeStatistics(words, progress, [], [], 'all', now).learningProgress).toBeCloseTo(
        0.45,
    );
    expect(
        summarizeStatistics(
            words,
            progress.map((item) => ({ ...item, stage: item.wordId === 'b' ? 0 : item.stage })),
            [],
            [],
            'all',
            now,
        ).learningProgress,
    ).toBeCloseTo(0.3);
    expect(summarizeStatistics([], progress, [], [], 'all', now).learningProgress).toBe(0);
});
