import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QazaqDatabase } from './database';
import { createProfileRepository } from './profileRepository';

let db: QazaqDatabase;
let repository: ReturnType<typeof createProfileRepository>;
beforeEach(async () => {
    db = new QazaqDatabase(`test-${crypto.randomUUID()}`);
    repository = createProfileRepository(db);
    await repository.initialize();
});
afterEach(async () => {
    await db.delete();
});

async function seedHistory(profileId: string, sessionId: string) {
    await db.progress.add({
        profileId,
        wordId: 'word',
        stage: 1,
        dueAt: 200,
        lastAnsweredAt: 100,
        correctCount: 1,
        incorrectCount: 0,
    });
    await db.sessions.add({
        id: sessionId,
        profileId,
        status: 'completed',
        startedAt: 50,
        endedAt: 100,
        targetCount: 1,
        answeredCount: 1,
        correctCount: 1,
        cursor: 1,
        queueSnapshots: [
            {
                wordId: 'word',
                kazakh: 'fixture',
                russian: 'fixture',
                options: ['fixture', 'a', 'b', 'c'],
                correctIndex: 0,
            },
        ],
    });
    await db.answers.add({
        id: `${sessionId}-answer`,
        sessionId,
        profileId,
        wordId: 'word',
        questionIndex: 0,
        kazakhSnapshot: 'fixture',
        russianSnapshot: 'fixture',
        optionsSnapshot: ['fixture', 'a', 'b', 'c'],
        selectedIndex: 0,
        correctIndex: 0,
        isCorrect: true,
        answeredAt: 100,
    });
}

describe('локальные профили — транзакции IndexedDB', () => {
    it('сохраняет выбор и настройки двух профилей при повторном открытии базы', async () => {
        const first = await repository.create('  Бірінші   профиль ');
        const second = await repository.create('Второй');
        await db.settings.update(first, { sessionLength: 25, palette: 'emerald' });
        await repository.select(first);
        db.close();
        await db.open();
        await repository.initialize();
        const snapshot = await repository.snapshot();
        expect(snapshot.activeProfile?.id).toBe(first);
        expect(snapshot.activeProfile?.name).toBe('Бірінші профиль');
        expect(snapshot.settings).toMatchObject({ sessionLength: 25, palette: 'emerald' });
        await repository.select(second);
        expect((await repository.snapshot()).settings).toMatchObject({
            profileId: second,
            sessionLength: 10,
            palette: 'blue',
        });
    });

    it('каскадно удаляет только выбранный профиль, оставляя словарь и чужую историю', async () => {
        const first = await repository.create('Первый');
        const second = await repository.create('Второй');
        await db.words.add({
            id: 'word',
            kazakh: 'fixture',
            russian: 'fixture',
            topicIds: ['topic'],
            createdAt: 0,
            updatedAt: 0,
        });
        await db.topics.add({ id: 'topic', name: 'Тест', createdAt: 0, updatedAt: 0 });
        await seedHistory(first, 'first-session');
        await seedHistory(second, 'second-session');
        await repository.rename(first, 'Новое имя');
        expect(await db.answers.where('profileId').equals(first).count()).toBe(1);
        await repository.remove(first);
        expect((await repository.snapshot()).activeProfile?.id).toBe(second);
        for (const table of [db.progress, db.sessions, db.answers]) {
            expect(await table.where('profileId').equals(first).count()).toBe(0);
            expect(await table.where('profileId').equals(second).count()).toBe(1);
        }
        expect(await db.settings.get(first)).toBeUndefined();
        expect(await db.words.count()).toBe(1);
        expect(await db.topics.count()).toBe(1);
        await repository.remove(second);
        expect((await repository.snapshot()).activeProfile).toBeNull();
        expect(await db.profiles.count()).toBe(0);
        expect(await db.words.count()).toBe(1);
    });

    it('после удаления активного профиля предлагает выбор другого', async () => {
        const first = await repository.create('Первый');
        const second = await repository.create('Второй');
        await repository.remove(second);
        expect((await repository.snapshot()).activeProfile).toBeNull();
        expect((await repository.snapshot()).profiles.map((profile) => profile.id)).toEqual([
            first,
        ]);
    });

    it('откатывает создание и активный выбор при сбое записи настроек', async () => {
        const first = await repository.create('Первый');
        const fail = () => {
            throw new Error('simulated storage failure');
        };
        db.settings.hook('creating', fail);
        await expect(repository.create('Второй')).rejects.toThrow('simulated storage failure');
        db.settings.hook('creating').unsubscribe(fail);
        expect(await db.profiles.count()).toBe(1);
        expect((await repository.snapshot()).activeProfile?.id).toBe(first);
    });

    it('откатывает удаление истории и прогресса при сбое в середине каскада', async () => {
        const id = await repository.create('Первый');
        await seedHistory(id, 'session');
        const fail = () => {
            throw new Error('simulated delete failure');
        };
        db.settings.hook('deleting', fail);
        await expect(repository.remove(id)).rejects.toThrow('simulated delete failure');
        db.settings.hook('deleting').unsubscribe(fail);
        expect((await repository.snapshot()).activeProfile?.id).toBe(id);
        expect(await db.progress.count()).toBe(1);
        expect(await db.answers.count()).toBe(1);
        expect(await db.sessions.count()).toBe(1);
    });

    it('отклоняет пустое/длинное имя и выбор отсутствующего профиля без записи', async () => {
        await expect(repository.create('  ')).rejects.toThrow('Введите имя');
        await expect(repository.create('a'.repeat(81))).rejects.toThrow('80');
        await expect(repository.select('missing')).rejects.toThrow('не существует');
        expect(await db.profiles.count()).toBe(0);
    });

    it('не допускает смену профиля при активной тренировке', async () => {
        const first = await repository.create('Первый');
        const second = await repository.create('Второй');
        await repository.select(first);
        await seedHistory(first, 'session');
        await db.sessions.update('session', { status: 'active', endedAt: undefined });
        await expect(repository.select(second)).rejects.toThrow('завершите');
        await expect(repository.create('Третий')).rejects.toThrow('завершите');
        expect((await repository.snapshot()).activeProfile?.id).toBe(first);
    });

    it('устраняет отсутствующую активную ссылку, сохраняя существующие профили и настройки', async () => {
        const id = await repository.create('Первый');
        await db.appMeta.put({ key: 'activeProfileId', value: 'missing' });
        await repository.initialize();
        expect((await repository.snapshot()).activeProfile).toBeNull();
        expect(await db.profiles.get(id)).toBeDefined();
        expect(await db.settings.get(id)).toBeDefined();
    });

    it('обновляет наблюдателя после записи через другое подключение к базе', async () => {
        const snapshots: string[] = [];
        const subscription = repository.observe().subscribe((snapshot) => {
            snapshots.push(snapshot.activeProfile?.name ?? 'none');
        });
        const anotherDb = new QazaqDatabase(db.name);
        try {
            await createProfileRepository(anotherDb).create('Из другой вкладки');
            await expect.poll(() => snapshots).toContain('Из другой вкладки');
        } finally {
            subscription.unsubscribe();
            anotherDb.close();
        }
    });
});

it('фото изолировано по профилю, сохраняется после перезагрузки и сбой не теряет прежнее фото', async () => {
    const first = await repository.create('Первый'),
        second = await repository.create('Второй');
    const photo = 'data:image/jpeg;base64,/9j/2Q==';
    await repository.setPhoto(first, photo);
    db.close();
    await db.open();
    expect((await db.profiles.get(first))?.avatarDataUrl).toBe(photo);
    expect((await db.profiles.get(second))?.avatarDataUrl).toBeUndefined();
    await expect(repository.setPhoto(first, 'https://example.com/photo.jpg')).rejects.toThrow(
        'фото',
    );
    await expect(repository.setPhoto(first, 'data:image/svg+xml;base64,AAAA')).rejects.toThrow(
        'фото',
    );
    await expect(
        repository.setPhoto(first, 'data:image/jpeg;base64,' + '/9j/' + 'A'.repeat(200000)),
    ).rejects.toThrow('фото');
    const fail = () => {
        throw new Error('photo failure');
    };
    db.profiles.hook('updating', fail);
    await expect(repository.setPhoto(first, null)).rejects.toThrow('photo failure');
    db.profiles.hook('updating').unsubscribe(fail);
    expect((await db.profiles.get(first))?.avatarDataUrl).toBe(photo);
    await repository.setPhoto(first, null);
    expect((await db.profiles.get(first))?.avatarDataUrl).toBeUndefined();
    await expect(repository.setPhoto('deleted', photo)).rejects.toThrow('существует');
});

it('logs out atomically, preserves profile data and requires confirmation for an active session', async () => {
    const id = await repository.create('Алекс');
    await seedHistory(id, 'logout-session');
    await db.sessions.update('logout-session', { status: 'active', endedAt: undefined });
    await expect(repository.logout()).rejects.toThrow();
    expect((await repository.snapshot()).activeProfile?.id).toBe(id);
    await repository.logout(true);
    expect((await repository.snapshot()).activeProfile).toBeNull();
    expect(await db.profiles.get(id)).toBeDefined();
    expect(await db.progress.where('profileId').equals(id).count()).toBe(1);
    expect((await db.sessions.get('logout-session'))?.status).toBe('interrupted');
    await repository.initialize();
    expect((await repository.snapshot()).activeProfile).toBeNull();
    await repository.select(id);
    expect((await repository.snapshot()).activeProfile?.id).toBe(id);
});
