import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { QazaqDatabase } from './database';
import { createProfileRepository } from './profileRepository';
import { createDictionaryRepository } from './dictionaryRepository';
import { createTrainingRepository } from './trainingRepository';
import { createStatisticsRepository } from './statisticsRepository';
it('статистика изолирует профили, учитывает прерванные ответы и сохраняется после удаления слова и перезагрузки', async () => {
    const db = new QazaqDatabase(`statistics-${crypto.randomUUID()}`);
    try {
        const profiles = createProfileRepository(db);
        await profiles.initialize();
        const first = await profiles.create('Первый'),
            second = await profiles.create('Второй');
        await profiles.select(first);
        const dictionary = createDictionaryRepository(db),
            training = createTrainingRepository(db),
            stats = createStatisticsRepository(db);
        for (let i = 0; i < 4; i++) {
            await dictionary.saveWord({ kazakh: `QA ${i}`, russian: `Перевод ${i}`, topicIds: [] });
        }
        const session = await training.start(first, '', 1000);
        await training.answer(first, session.id, 0, session.queueSnapshots[0].correctIndex, 2000);
        await training.interrupt(first, session.id);
        expect(await stats.snapshot(first, 'all', 3000)).toMatchObject({
            answeredCount: 1,
            accuracy: 100,
            newCount: 3,
            learningCount: 1,
            completedCount: 0,
        });
        expect(await stats.snapshot(second, 'all', 3000)).toMatchObject({
            answeredCount: 0,
            accuracy: null,
            newCount: 4,
            learningCount: 0,
        });
        await dictionary.removeWord((await db.words.get(session.queueSnapshots[0].wordId))!, true);
        db.close();
        await db.open();
        expect(await stats.snapshot(first, 'all', 3000)).toMatchObject({
            answeredCount: 1,
            accuracy: 100,
            totalWords: 3,
            learningCount: 0,
        });
    } finally {
        await db.delete();
    }
});
