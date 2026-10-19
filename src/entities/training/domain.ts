import type { Progress, QuestionSnapshot, Word } from '../models';
import { normalizeText } from '../../shared/utils/text';

const DAY = 24 * 60 * 60 * 1000;
const INTERVALS = [1, 3, 7, 14, 30];

export function scheduleNextReview(previousStage: number, isCorrect: boolean, now: number) {
    if (!Number.isInteger(previousStage) || previousStage < 0 || previousStage > 5) {
        throw new Error('Неверная ступень повторения.');
    }
    const stage = isCorrect ? Math.min(previousStage + 1, 5) : 0;
    return { stage, dueAt: now + (isCorrect ? INTERVALS[stage - 1] * DAY : 10 * 60 * 1000) };
}

export function evaluateAnswer(question: QuestionSnapshot, selectedIndex: number): boolean {
    if (
        question.options.length !== 4 ||
        question.options.some((option) => !normalizeText(option)) ||
        new Set(question.options.map(normalizeText)).size !== 4 ||
        !Number.isInteger(question.correctIndex) ||
        question.correctIndex < 0 ||
        question.correctIndex > 3 ||
        !Number.isInteger(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex > 3 ||
        normalizeText(question.options[question.correctIndex]) !== normalizeText(question.russian)
    ) {
        throw new Error('Неверные варианты ответа.');
    }
    return selectedIndex === question.correctIndex;
}

function shuffle<T>(items: T[], random: () => number): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

export function buildQueue(
    words: Word[],
    progress: Progress[],
    topicId: string,
    limit: number,
    now: number,
    random: () => number,
) {
    const states = new Map(progress.map((item) => [item.wordId, item]));
    const order = (a: Word, b: Word) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    const filtered = words.filter((word) => !topicId || word.topicIds.includes(topicId));
    const due = filtered
        .filter((word) => states.has(word.id) && states.get(word.id)!.dueAt <= now)
        .sort((a, b) => states.get(a.id)!.dueAt - states.get(b.id)!.dueAt || order(a, b));
    const fresh = shuffle(filtered.filter((word) => !states.has(word.id)).sort(order), random);
    const scheduled = filtered
        .filter((word) => states.has(word.id) && states.get(word.id)!.dueAt > now)
        .sort((a, b) => states.get(a.id)!.dueAt - states.get(b.id)!.dueAt || order(a, b));
    const eligible = [...due, ...fresh, ...scheduled];
    const questions: QuestionSnapshot[] = [];
    let skippedCount = 0;
    const translations = new Map<string, string>();
    const acceptedByKazakh = new Map<string, Set<string>>();
    for (const item of [...words].sort(order)) {
        const kazakhKey = normalizeText(item.kazakh);
        const russianKey = normalizeText(item.russian);
        if (!russianKey) {
            continue;
        }
        if (!translations.has(russianKey)) {
            translations.set(russianKey, item.russian);
        }
        const accepted = acceptedByKazakh.get(kazakhKey) ?? new Set<string>();
        accepted.add(russianKey);
        acceptedByKazakh.set(kazakhKey, accepted);
    }
    for (const word of eligible) {
        // Alternative translations of the same written Kazakh word cannot be distractors.
        const accepted = acceptedByKazakh.get(normalizeText(word.kazakh)) ?? new Set<string>();
        if (translations.size - accepted.size < 3) {
            skippedCount++;
            continue;
        }
        if (questions.length >= limit) {
            continue;
        }
        const distractors = [...translations]
            .filter(([key]) => !accepted.has(key))
            .map(([, value]) => value);
        const options = shuffle(
            [word.russian, ...shuffle(distractors, random).slice(0, 3)],
            random,
        );
        questions.push({
            wordId: word.id,
            kazakh: word.kazakh,
            russian: word.russian,
            options,
            correctIndex: options.indexOf(word.russian),
        });
    }
    return {
        questions,
        skippedCount,
        eligibleCount: eligible.length,
        dueCount: due.length,
        newCount: fresh.length,
        scheduledCount: scheduled.length,
    };
}
