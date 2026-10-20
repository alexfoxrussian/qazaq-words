import type { Answer, Progress, TrainingSession, Word } from '../models';
import { calculateAccuracy } from './metrics';

export type Period = '7' | '30' | 'all';
export function localDay(timestamp: number) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dayOffset(now: number, offset: number) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return date.getTime();
}
export function summarizeStatistics(
    words: Word[],
    progress: Progress[],
    answers: Answer[],
    sessions: TrainingSession[],
    period: Period,
    now: number,
) {
    const start = period === 'all' ? -Infinity : dayOffset(now, 1 - Number(period));
    const history = answers.filter((answer) => answer.answeredAt <= now);
    const selected = history.filter((answer) => answer.answeredAt >= start);
    const correct = selected.filter((answer) => answer.isCorrect).length;
    const byDay = new Map<string, { day: string; answers: number; correct: number }>();
    for (const answer of selected) {
        const day = localDay(answer.answeredAt);
        const item = byDay.get(day) ?? { day, answers: 0, correct: 0 };
        item.answers++;
        item.correct += Number(answer.isCorrect);
        byDay.set(day, item);
    }
    if (period !== 'all') {
        for (let i = 1 - Number(period); i <= 0; i++) {
            const day = localDay(dayOffset(now, i));
            if (!byDay.has(day)) {
                byDay.set(day, { day, answers: 0, correct: 0 });
            }
        }
    }
    const activeDays = new Set(history.map((answer) => localDay(answer.answeredAt)));
    let offset = activeDays.has(localDay(now)) ? 0 : -1,
        streak = 0;
    while (activeDays.has(localDay(dayOffset(now, offset)))) {
        streak++;
        offset--;
    }
    const states = new Map(progress.map((item) => [item.wordId, item]));
    const stages = Array.from({ length: 6 }, (_, stage) => ({ stage, count: 0 }));
    let newCount = 0,
        dueCount = 0,
        learningCount = 0;
    for (const word of words) {
        const state = states.get(word.id);
        if (!state) {
            newCount++;
            continue;
        }
        stages[state.stage].count++;
        if (state.stage > 0) {
            learningCount++;
        }
        if (state.dueAt <= now) {
            dueCount++;
        }
    }
    return {
        answeredCount: selected.length,
        correctCount: correct,
        accuracy: calculateAccuracy(correct, selected.length),
        streak,
        completedCount: sessions.filter(
            (session) =>
                session.status === 'completed' &&
                session.endedAt !== undefined &&
                session.endedAt >= start &&
                session.endedAt <= now,
        ).length,
        newCount,
        dueCount,
        learningCount,
        masteredCount: stages[5].count,
        totalWords: words.length,
        stages,
        learningProgress: words.length
            ? stages.reduce((sum, item) => sum + item.stage * item.count, 0) / (words.length * 5)
            : 0,
        days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
        recentAnswers: [...selected]
            .sort((a, b) => b.answeredAt - a.answeredAt || b.id.localeCompare(a.id))
            .slice(0, 10),
    };
}

export interface ActivityDay {
    day: string;
    answers: number;
    correct: number;
}
export function buildActivityCalendar(
    days: ActivityDay[],
    period: Period,
    now: number,
): (ActivityDay | null)[] {
    const count = period === 'all' ? 365 : Number(period);
    const start = dayOffset(now, 1 - count);
    const padding = (new Date(start).getDay() + 6) % 7;
    const values = new Map(days.map((day) => [day.day, day]));
    const cells: (ActivityDay | null)[] = Array.from({ length: padding }, () => null);
    for (let offset = 1 - count; offset <= 0; offset++) {
        const day = localDay(dayOffset(now, offset));
        cells.push(values.get(day) ?? { day, answers: 0, correct: 0 });
    }
    while (cells.length % 7) {
        cells.push(null);
    }
    return cells;
}
