import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QazaqDatabase } from './database';
import { createProfileRepository } from './profileRepository';
import { createDictionaryRepository } from './dictionaryRepository';
import { createTrainingRepository } from './trainingRepository';

let db: QazaqDatabase;
let repo: ReturnType<typeof createTrainingRepository>;
let profileId: string;
beforeEach(async () => {
    db = new QazaqDatabase(`training-test-${crypto.randomUUID()}`);
    repo = createTrainingRepository(db);
    const profiles = createProfileRepository(db);
    await profiles.initialize();
    profileId = await profiles.create('Первый');
    for (let i = 1; i <= 4; i++) {
        await createDictionaryRepository(db).saveWord({
            kazakh: `Fixture ${i}`,
            russian: `Тестовый вариант ${i}`,
            topicIds: [],
        });
    }
});
afterEach(async () => {
    await db.delete();
});

describe('сохранение тренировки в IndexedDB', () => {
    it('создаёт не больше одного активного сеанса даже при параллельном запуске', async () => {
        const attempts = await Promise.allSettled([
            repo.start(profileId, '', 1000),
            repo.start(profileId, '', 1000),
        ]);
        expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(await db.sessions.count()).toBe(1);
        expect((await repo.snapshot(profileId)).session?.targetCount).toBe(4);
    });
    it('фиксирует только первое нажатие и повышает новую ступень до 1', async () => {
        const session = await repo.start(profileId, '', 1000);
        const question = session.queueSnapshots[0];
        const results = await Promise.all([
            repo.answer(profileId, session.id, 0, question.correctIndex, 2000),
            repo.answer(profileId, session.id, 0, (question.correctIndex + 1) % 4, 2000),
        ]);
        expect(results[0].id).toBe(results[1].id);
        expect(await db.answers.count()).toBe(1);
        expect(await db.progress.get([profileId, question.wordId])).toMatchObject({
            stage: 1,
            dueAt: 2000 + 86400000,
            correctCount: 1,
            incorrectCount: 0,
        });
        expect(await db.sessions.get(session.id)).toMatchObject({
            answeredCount: 1,
            correctCount: 1,
            cursor: 1,
        });
    });
    it('ошибка записывается один раз и получает повтор через десять минут', async () => {
        const session = await repo.start(profileId, '', 1000);
        const question = session.queueSnapshots[0];
        await repo.answer(profileId, session.id, 0, (question.correctIndex + 1) % 4, 2000);
        db.close();
        await db.open();
        expect((await repo.snapshot(profileId)).session).toMatchObject({
            cursor: 0,
            answeredCount: 1,
        });
        await expect(repo.answer(profileId, session.id, 1, 0, 2500)).rejects.toThrow('недоступен');
        await repo.answer(profileId, session.id, 0, (question.correctIndex + 2) % 4, 2500);
        expect((await repo.snapshot(profileId)).session).toMatchObject({
            cursor: 0,
            answeredCount: 1,
        });
        const retry = await repo.answer(profileId, session.id, 0, question.correctIndex, 3000);
        expect(retry.isCorrect).toBe(false);
        expect((await repo.snapshot(profileId)).session).toMatchObject({
            cursor: 1,
            answeredCount: 1,
            correctCount: 0,
        });
        await repo.interrupt(profileId, session.id);
        expect((await repo.start(profileId, '', 3000)).queueSnapshots[3].wordId).toBe(
            question.wordId,
        );
        expect(await db.progress.get([profileId, question.wordId])).toMatchObject({
            stage: 0,
            dueAt: 602000,
            correctCount: 0,
            incorrectCount: 1,
        });
    });
    it('завершает последний вопрос только после исправления, без повторной записи прогресса', async () => {
        await repo.setSessionLength(profileId, 1);
        const session = await repo.start(profileId, '', 1000);
        const correct = session.queueSnapshots[0].correctIndex;
        await repo.answer(profileId, session.id, 0, (correct + 1) % 4, 2000);
        const progress = await db.progress.toArray();
        expect((await repo.snapshot(profileId)).session).toMatchObject({
            status: 'active',
            cursor: 0,
            answeredCount: 1,
            correctCount: 0,
        });
        const fail = () => {
            throw new Error('correction failure');
        };
        db.sessions.hook('updating', fail);
        await expect(repo.answer(profileId, session.id, 0, correct, 3000)).rejects.toThrow(
            'correction failure',
        );
        db.sessions.hook('updating').unsubscribe(fail);
        expect((await repo.snapshot(profileId)).session?.status).toBe('active');
        await Promise.all([
            repo.answer(profileId, session.id, 0, correct, 4000),
            repo.answer(profileId, session.id, 0, correct, 4000),
        ]);
        expect((await repo.snapshot(profileId)).session).toMatchObject({
            status: 'completed',
            cursor: 1,
            answeredCount: 1,
            correctCount: 0,
            endedAt: 4000,
        });
        expect(await db.answers.count()).toBe(1);
        expect(await db.progress.toArray()).toEqual(progress);
    });
    it('полностью откатывает ответ, прогресс и счётчики при сбое последней записи, затем позволяет повтор', async () => {
        const session = await repo.start(profileId, '', 1000);
        const fail = () => {
            throw new Error('simulated session write failure');
        };
        db.sessions.hook('updating', fail);
        await expect(
            repo.answer(profileId, session.id, 0, session.queueSnapshots[0].correctIndex, 2000),
        ).rejects.toThrow('simulated session write failure');
        db.sessions.hook('updating').unsubscribe(fail);
        expect(await db.answers.count()).toBe(0);
        expect(await db.progress.count()).toBe(0);
        expect(await db.sessions.get(session.id)).toMatchObject({
            cursor: 0,
            answeredCount: 0,
            correctCount: 0,
        });
        await repo.answer(profileId, session.id, 0, session.queueSnapshots[0].correctIndex, 2000);
        expect(await db.answers.count()).toBe(1);
    });
    it('восстанавливает снимки, сохранённый результат и следующий cursor после повторного открытия', async () => {
        const session = await repo.start(profileId, '', 1000);
        const answer = await repo.answer(
            profileId,
            session.id,
            0,
            session.queueSnapshots[0].correctIndex,
            2000,
        );
        db.close();
        await db.open();
        const restored = await createTrainingRepository(db).snapshot(profileId);
        expect(restored.session?.queueSnapshots).toEqual(session.queueSnapshots);
        expect(restored.session?.cursor).toBe(1);
        expect(restored.answers).toEqual([answer]);
        await repo.answer(profileId, session.id, 0, session.queueSnapshots[0].correctIndex, 3000);
        expect(await db.answers.count()).toBe(1);
    });
    it('последний ответ завершает сеанс в той же транзакции и сохраняет итог', async () => {
        const session = await repo.start(profileId, '', 1000);
        for (let i = 0; i < session.targetCount; i++) {
            await repo.answer(
                profileId,
                session.id,
                i,
                session.queueSnapshots[i].correctIndex,
                2000 + i,
            );
        }
        db.close();
        await db.open();
        expect((await repo.snapshot(profileId)).session).toMatchObject({
            status: 'completed',
            endedAt: 2003,
            cursor: 4,
            answeredCount: 4,
            correctCount: 4,
        });
        await repo.answer(profileId, session.id, 3, session.queueSnapshots[3].correctIndex, 3000);
        expect(await db.answers.count()).toBe(4);
        expect((await repo.prepare(profileId, '', 3000)).questions).toHaveLength(4);
        const next = await repo.start(profileId, '', 3000);
        expect(new Set(next.queueSnapshots.map((question) => question.wordId))).toEqual(
            new Set(session.queueSnapshots.map((question) => question.wordId)),
        );
        for (let i = 0; i < next.targetCount; i++) {
            await repo.answer(profileId, next.id, i, next.queueSnapshots[i].correctIndex, 4000 + i);
        }
        expect(await db.answers.count()).toBe(8);
        expect(
            (await db.progress.toArray()).every(
                (item) => item.stage === 2 && item.correctCount === 2,
            ),
        ).toBe(true);
    });
    it('прерывание сохраняет ответы, не учитывает пропущенные и позволяет новый сеанс', async () => {
        const session = await repo.start(profileId, '', 1000);
        await repo.answer(profileId, session.id, 0, session.queueSnapshots[0].correctIndex, 2000);
        await repo.interrupt(profileId, session.id);
        expect(await db.answers.count()).toBe(1);
        expect(await db.progress.count()).toBe(1);
        expect(await db.sessions.get(session.id)).toMatchObject({
            status: 'interrupted',
            answeredCount: 1,
        });
        const next = await repo.start(profileId, '', 3000);
        expect(next.targetCount).toBe(4);
        expect(next.queueSnapshots[3].wordId).toBe(session.queueSnapshots[0].wordId);
    });
    it('изолирует профили и прерывает сеанс при подтверждённой смене владельца', async () => {
        const profiles = createProfileRepository(db);
        const other = await profiles.create('Второй');
        await profiles.select(profileId);
        const session = await repo.start(profileId, '', 1000);
        await repo.answer(profileId, session.id, 0, session.queueSnapshots[0].correctIndex, 2000);
        await expect(repo.answer(other, session.id, 1, 0)).rejects.toThrow('профиль');
        await profiles.select(other, true);
        expect(await db.sessions.get(session.id)).toMatchObject({ status: 'interrupted' });
        expect((await repo.snapshot(other)).session).toBeNull();
        expect(await db.progress.where('profileId').equals(other).count()).toBe(0);
        await expect(repo.answer(profileId, session.id, 1, 0)).rejects.toThrow('профиль');
    });
    it('откатывает прерывание при сбое переключения профиля', async () => {
        const profiles = createProfileRepository(db);
        const other = await profiles.create('Второй');
        await profiles.select(profileId);
        const session = await repo.start(profileId, '', 1000);
        const fail = () => {
            throw new Error('simulated profile switch failure');
        };
        db.appMeta.hook('updating', fail);
        await expect(profiles.select(other, true)).rejects.toThrow(
            'simulated profile switch failure',
        );
        db.appMeta.hook('updating').unsubscribe(fail);
        expect((await profiles.snapshot()).activeProfile?.id).toBe(profileId);
        expect((await db.sessions.get(session.id))?.status).toBe('active');
    });
    it('изменение словаря сохраняет прошлый ответ и запрещает новый в прерванном сеансе', async () => {
        const session = await repo.start(profileId, '', 1000);
        await repo.answer(profileId, session.id, 0, session.queueSnapshots[0].correctIndex, 2000);
        const original = (await db.words.get(session.queueSnapshots[1].wordId))!;
        await createDictionaryRepository(db).saveWord(
            { ...original, russian: 'Новый fixture' },
            original,
            true,
        );
        await expect(repo.answer(profileId, session.id, 1, 0)).rejects.toThrow('завершена');
        expect(await db.answers.count()).toBe(1);
        expect((await repo.snapshot(profileId)).session?.queueSnapshots).toEqual(
            session.queueSnapshots,
        );
    });
    it('не принимает ответ вне cursor и не запускает очередь без уникальных отвлекающих', async () => {
        const session = await repo.start(profileId, '', 1000);
        await expect(repo.answer(profileId, session.id, 1, 0)).rejects.toThrow('недоступен');
        await expect(repo.answer(profileId, session.id, 0, 4)).rejects.toThrow('варианты');
        expect(await db.answers.count()).toBe(0);
        await repo.interrupt(profileId, session.id);
        const words = await db.words.toArray();
        await db.words.update(words[0].id, { russian: words[1].russian });
        await expect(repo.start(profileId, '', 3000)).rejects.toThrow('четырьмя');
    });
});

it('сохраняет длину только активного профиля и применяет к следующему сеансу', async () => {
    const other = await createProfileRepository(db).create('Другой');
    await createProfileRepository(db).select(profileId);
    for (let i = 5; i <= 8; i++) {
        await createDictionaryRepository(db).saveWord({
            kazakh: `Fixture ${i}`,
            russian: `Вариант ${i}`,
            topicIds: [],
        });
    }
    await repo.setSessionLength(profileId, 5);
    db.close();
    await db.open();
    expect((await repo.start(profileId, '', 1000)).targetCount).toBe(5);
    expect((await db.settings.get(other))?.sessionLength).toBe(10);
    await expect(repo.setSessionLength(other, 7)).rejects.toThrow('профиль');
    for (const value of [-1, 5.5, Infinity]) {
        await expect(repo.setSessionLength(profileId, value)).rejects.toThrow(
            'целое положительное',
        );
    }
});

it('весь словарь включает все пригодные слова, свой лимит сокращает очередь', async () => {
    for (let i = 5; i <= 35; i++) {
        await createDictionaryRepository(db).saveWord({
            kazakh: `Fixture ${i}`,
            russian: `Вариант ${i}`,
            topicIds: [],
        });
    }
    await repo.setSessionLength(profileId, 0);
    const all = await repo.start(profileId, '', 1000);
    expect(all.targetCount).toBe(35);
    await repo.interrupt(profileId, all.id);
    await repo.setSessionLength(profileId, 17);
    expect((await repo.start(profileId, '', 2000)).targetCount).toBe(17);
});
