import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QazaqDatabase } from './database';
import { ConfirmationRequired, createDictionaryRepository } from './dictionaryRepository';
import { createProfileRepository } from './profileRepository';
import { filterWords } from '../../features/word-management/filter';

let db: QazaqDatabase;
let repo: ReturnType<typeof createDictionaryRepository>;
beforeEach(async () => {
    db = new QazaqDatabase(`dictionary-test-${crypto.randomUUID()}`);
    repo = createDictionaryRepository(db);
    await createProfileRepository(db).initialize();
});
afterEach(async () => {
    await db.delete();
});

async function seed() {
    const profiles = createProfileRepository(db);
    const first = await profiles.create('Первый');
    const second = await profiles.create('Второй');
    const topicId = await repo.saveTopic('Тема');
    const wordId = await repo.saveWord({
        kazakh: 'fixture Ә',
        russian: 'Тестовый перевод',
        topicIds: [topicId],
    });
    for (const profileId of [first, second]) {
        await db.progress.add({
            profileId,
            wordId,
            stage: 3,
            dueAt: 1000,
            lastAnsweredAt: 100,
            correctCount: 3,
            incorrectCount: 0,
        });
        await db.sessions.add({
            id: profileId,
            profileId,
            status: 'completed',
            startedAt: 0,
            endedAt: 100,
            targetCount: 1,
            answeredCount: 1,
            correctCount: 1,
            cursor: 1,
            queueSnapshots: [
                {
                    wordId,
                    kazakh: 'fixture Ә',
                    russian: 'Тестовый перевод',
                    options: ['Тестовый перевод', 'a', 'b', 'c'],
                    correctIndex: 0,
                },
            ],
        });
        await db.answers.add({
            id: profileId,
            profileId,
            sessionId: profileId,
            wordId,
            questionIndex: 0,
            kazakhSnapshot: 'fixture Ә',
            russianSnapshot: 'Тестовый перевод',
            optionsSnapshot: ['Тестовый перевод', 'a', 'b', 'c'],
            selectedIndex: 0,
            correctIndex: 0,
            isCorrect: true,
            answeredAt: 100,
        });
    }
    return {
        first,
        second,
        word: (await db.words.get(wordId))!,
        topic: (await db.topics.get(topicId))!,
    };
}

describe('общий словарь и темы', () => {
    it('нормализует пробелы и Unicode, сохраняет казахские буквы и ищет оба текста', async () => {
        const topicId = await repo.saveTopic('  Учебная   тема ');
        await repo.saveWord({
            kazakh: ' Ә Ғ Қ Ң Ө Ұ Ү Һ І ',
            russian: '  Русскии\u0306   текст ',
            topicIds: [topicId, topicId],
        });
        const { words } = await repo.snapshot();
        expect(words[0].kazakh).toBe('Ә Ғ Қ Ң Ө Ұ Ү Һ І');
        expect(words[0].russian).toBe('Русский текст');
        expect(words[0].topicIds).toEqual([topicId]);
        expect(filterWords(words, 'қ ң', topicId)).toHaveLength(1);
        expect(filterWords(words, 'РУССКИИ\u0306', '')).toHaveLength(1);
        expect(filterWords(words, '', 'missing')).toHaveLength(0);
    });

    it('атомарно отклоняет нормализованный дубль при одновременном добавлении', async () => {
        const results = await Promise.allSettled([
            repo.saveWord({ kazakh: 'fixture', russian: 'Перевод', topicIds: [] }),
            repo.saveWord({ kazakh: ' FIXTURE ', russian: ' перевод ', topicIds: [] }),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(await db.words.count()).toBe(1);
    });

    it('предупреждает о том же казахском слове с другим переводом до записи', async () => {
        await repo.saveWord({ kazakh: 'fixture', russian: 'Первый', topicIds: [] });
        const draft = { kazakh: 'FIXTURE', russian: 'Второй', topicIds: [] };
        await expect(repo.saveWord(draft)).rejects.toBeInstanceOf(ConfirmationRequired);
        expect(await db.words.count()).toBe(1);
        await repo.saveWord(draft, undefined, true);
        expect(await db.words.count()).toBe(2);
    });

    it('изменение текста требует подтверждения и сбрасывает прогресс обоих профилей, сохраняя историю', async () => {
        const { word } = await seed();
        const draft = { kazakh: word.kazakh, russian: 'Новый перевод', topicIds: word.topicIds };
        const history = await db.answers.toArray();
        await expect(repo.saveWord(draft, word)).rejects.toBeInstanceOf(ConfirmationRequired);
        expect(await db.progress.count()).toBe(2);
        expect((await db.words.get(word.id))?.russian).toBe(word.russian);
        await repo.saveWord(draft, word, true);
        expect(await db.progress.count()).toBe(0);
        expect(await db.answers.toArray()).toEqual(history);
        expect((await db.words.get(word.id))?.russian).toBe('Новый перевод');
    });

    it('изменение только тем и удаление темы сохраняют прогресс и слова', async () => {
        const { word, topic } = await seed();
        const another = await repo.saveTopic('Другая');
        await repo.saveWord({ ...word, topicIds: [topic.id, another] }, word);
        await repo.saveTopic('Переименованная', topic);
        const updatedTopic = (await db.topics.get(topic.id))!;
        await expect(repo.removeTopic(updatedTopic)).rejects.toBeInstanceOf(ConfirmationRequired);
        await repo.removeTopic(updatedTopic, true);
        expect(await db.words.count()).toBe(1);
        expect((await db.words.get(word.id))?.topicIds).toEqual([another]);
        expect(await db.progress.count()).toBe(2);
        expect(await db.answers.count()).toBe(2);
    });

    it('удаляет слово и прогресс всех профилей, сохраняя снимки ответов и сеансов', async () => {
        const { word } = await seed();
        const answers = await db.answers.toArray();
        const sessions = await db.sessions.toArray();
        await expect(repo.removeWord(word)).rejects.toBeInstanceOf(ConfirmationRequired);
        await repo.removeWord(word, true);
        expect(await db.words.count()).toBe(0);
        expect(await db.progress.count()).toBe(0);
        expect(await db.answers.toArray()).toEqual(answers);
        expect(await db.sessions.toArray()).toEqual(sessions);
    });

    it('прерывает активные сеансы только после подтверждения изменения', async () => {
        const { first, word } = await seed();
        await db.sessions.update(first, { status: 'active', endedAt: undefined });
        const draft = { ...word, topicIds: [] };
        await expect(repo.saveWord(draft, word)).rejects.toBeInstanceOf(ConfirmationRequired);
        expect((await db.sessions.get(first))?.status).toBe('active');
        await repo.saveWord(draft, word, true);
        expect((await db.sessions.get(first))?.status).toBe('interrupted');
        expect(await db.answers.count()).toBe(2);
        expect(await db.progress.count()).toBe(2);
    });

    it('откатывает сброс прогресса и прерывание сеанса при сбое записи слова', async () => {
        const { first, word } = await seed();
        await db.sessions.update(first, { status: 'active', endedAt: undefined });
        const fail = () => {
            throw new Error('simulated word write failure');
        };
        db.words.hook('updating', fail);
        await expect(repo.saveWord({ ...word, russian: 'Изменённый' }, word, true)).rejects.toThrow(
            'simulated word write failure',
        );
        db.words.hook('updating').unsubscribe(fail);
        expect(await db.progress.count()).toBe(2);
        expect((await db.sessions.get(first))?.status).toBe('active');
        expect(await db.words.get(word.id)).toEqual(word);
    });

    it('откатывает снятие темы со слов при сбое удаления темы', async () => {
        const { word, topic } = await seed();
        const fail = () => {
            throw new Error('simulated topic delete failure');
        };
        db.topics.hook('deleting', fail);
        await expect(repo.removeTopic(topic, true)).rejects.toThrow(
            'simulated topic delete failure',
        );
        db.topics.hook('deleting').unsubscribe(fail);
        expect(await db.words.get(word.id)).toEqual(word);
        expect(await db.topics.get(topic.id)).toEqual(topic);
    });

    it('откатывает удаление прогресса при сбое удаления слова', async () => {
        const { word } = await seed();
        const fail = () => {
            throw new Error('simulated word delete failure');
        };
        db.words.hook('deleting', fail);
        await expect(repo.removeWord(word, true)).rejects.toThrow('simulated word delete failure');
        db.words.hook('deleting').unsubscribe(fail);
        expect(await db.progress.count()).toBe(2);
        expect(await db.words.get(word.id)).toEqual(word);
        expect(await db.answers.count()).toBe(2);
    });

    it('отклоняет устаревшую форму, удалённые темы, пустые поля и дубль темы', async () => {
        const { word, topic } = await seed();
        await expect(repo.saveWord({ ...word, russian: ' ' }, word)).rejects.toThrow('Заполните');
        await expect(repo.saveWord({ ...word, kazakh: 'x'.repeat(201) }, word)).rejects.toThrow(
            '200',
        );
        await expect(repo.saveWord({ ...word, topicIds: ['missing'] }, word)).rejects.toThrow(
            'тег удалён',
        );
        await expect(repo.saveTopic(' ТЕМА ')).rejects.toThrow('уже существует');
        await repo.saveWord({ ...word, topicIds: [] }, word);
        await expect(repo.saveWord({ ...word, russian: 'Новый' }, word, true)).rejects.toThrow(
            'другой вкладке',
        );
        expect(await db.topics.get(topic.id)).toBeDefined();
    });
});

describe('перенос словаря', () => {
    const file = {
        format: 'qazaq-words-dictionary',
        version: 1,
        topics: ['Тема'],
        words: [{ kazakh: 'Ә', russian: 'Перевод', topics: ['Тема'] }],
    };
    it('требует подтверждения, импортирует атомарно и повторно без дублей', async () => {
        await expect(repo.importDictionary(file)).rejects.toBeInstanceOf(ConfirmationRequired);
        expect(await db.words.count()).toBe(0);
        await repo.importDictionary(file, true);
        const exported = await repo.exportDictionary();
        await repo.importDictionary(exported, true);
        expect(await db.words.count()).toBe(1);
        expect(await db.topics.count()).toBe(1);
        expect(exported).toEqual(file);
    });
    it('отклоняет неизвестные темы, дубли и версии до записи', async () => {
        for (const invalid of [
            { ...file, version: 2 },
            { ...file, topics: [] },
            { ...file, words: [...file.words, ...file.words] },
            { ...file, topics: ['Тема', ' ТЕМА '] },
        ]) {
            await expect(repo.importDictionary(invalid, true)).rejects.toThrow();
        }
        expect(await db.words.count()).toBe(0);
        expect(await db.topics.count()).toBe(0);
    });
    it('объединяет темы совпадающей пары без сброса прогресса и истории', async () => {
        const existing = await seed();
        await repo.importDictionary(
            {
                ...file,
                topics: ['Новая'],
                words: [{ kazakh: ' FIXTURE Ә ', russian: 'Тестовый перевод', topics: ['Новая'] }],
            },
            true,
        );
        expect(await db.words.count()).toBe(1);
        expect((await db.words.get(existing.word.id))?.topicIds).toHaveLength(2);
        expect(await db.progress.count()).toBe(2);
        expect(await db.answers.count()).toBe(2);
    });
    it('откатывает добавление тем и прерывание сеанса при ошибке записи слова', async () => {
        const profileId = await createProfileRepository(db).create('QA');
        await db.sessions.add({
            id: 'active',
            profileId,
            status: 'active',
            startedAt: 1,
            targetCount: 0,
            answeredCount: 0,
            correctCount: 0,
            queueSnapshots: [],
            cursor: 0,
        });
        const fail = () => {
            throw new Error('import failure');
        };
        db.words.hook('creating', fail);
        await expect(repo.importDictionary(file, true)).rejects.toThrow('import failure');
        db.words.hook('creating').unsubscribe(fail);
        expect(await db.topics.count()).toBe(0);
        expect((await db.sessions.get('active'))?.status).toBe('active');
    });
});
