import { beforeEach, expect, it } from 'vitest';
import type { TrainingSession, Answer } from '../../entities/models';
import { useTrainingStore } from './store';

const session: TrainingSession = {
    id: 'session',
    profileId: 'profile',
    status: 'active',
    startedAt: 1000,
    targetCount: 2,
    answeredCount: 1,
    correctCount: 0,
    cursor: 0,
    queueSnapshots: [
        {
            wordId: 'word',
            kazakh: 'дүйсенбі',
            russian: 'понедельник',
            options: ['понедельник', 'вторник', 'среда', 'четверг'],
            correctIndex: 0,
        },
        {
            wordId: 'word2',
            kazakh: 'сейсенбі',
            russian: 'вторник',
            options: ['понедельник', 'вторник', 'среда', 'четверг'],
            correctIndex: 1,
        },
    ],
};
const answer: Answer = {
    id: 'answer',
    sessionId: 'session',
    profileId: 'profile',
    wordId: 'word',
    questionIndex: 0,
    kazakhSnapshot: 'дүйсенбі',
    russianSnapshot: 'понедельник',
    optionsSnapshot: session.queueSnapshots[0].options,
    selectedIndex: 1,
    correctIndex: 0,
    isCorrect: false,
    answeredAt: 2000,
};

beforeEach(() => useTrainingStore.getState().loading('profile'));

it('resumes the unresolved question after reloading rather than skipping its saved error', () => {
    const state = useTrainingStore.getState;
    state().apply('profile', {
        session: { ...session, cursor: 1, answeredCount: 2 },
        answers: [answer, { ...answer, id: 'answer2', questionIndex: 1 }],
    });
    expect(state().visibleIndex).toBe(1);
    expect(state().view).toBe('resume');
});

it('keeps corrected feedback visible until advance, including the last question', () => {
    const state = useTrainingStore.getState;
    state().apply('profile', { session, answers: [answer] });
    state().setView('session');
    state().apply('profile', { session: { ...session, cursor: 1 }, answers: [answer] });
    expect(state().visibleIndex).toBe(0);
    state().advance();
    expect(state().visibleIndex).toBe(1);
    state().apply('profile', {
        session: { ...session, status: 'completed', cursor: 2, answeredCount: 2 },
        answers: [answer, { ...answer, id: 'answer2', questionIndex: 1 }],
    });
    expect(state().visibleIndex).toBe(1);
    state().advance();
    expect(state().visibleIndex).toBe(2);
});
