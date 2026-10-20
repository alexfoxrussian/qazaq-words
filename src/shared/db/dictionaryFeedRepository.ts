import type { Topic, Word } from '../../entities/models';
import { validateDictionaryFile } from '../../entities/word/dictionaryTransfer';
import { linkKey, pairKey, validateFeedState } from '../../entities/word/dictionaryFeed';
import { normalizeText } from '../utils/text';
import { createId } from '../utils/id';
import { database, type QazaqDatabase } from './database';

export function createDictionaryFeedRepository(db: QazaqDatabase) {
    return {
        async apply(value: unknown, source: string, checkedAt = Date.now(), seed = false) {
            const file = validateDictionaryFile(value);
            validateFeedState({ source, checkedAt, seenWords: [], seenTopics: [], seenLinks: [] });
            return db.transaction('rw', [db.words, db.topics, db.appMeta], async () => {
                const metadata = await db.appMeta.get('dictionaryFeed');
                const sameSource =
                    metadata?.key === 'dictionaryFeed' && metadata.value.source === source;
                const previous =
                    metadata?.key === 'dictionaryFeed' && sameSource ? metadata.value : null;
                if (seed && sameSource) {
                    return { addedWords: 0, totalWords: await db.words.count() };
                }
                const seenWords = new Set(previous?.seenWords),
                    seenTopics = new Set(previous?.seenTopics),
                    seenLinks = new Set(previous?.seenLinks);
                const topics = new Map(
                    (await db.topics.toArray()).map((topic) => [normalizeText(topic.name), topic]),
                );
                const words = new Map(
                    (await db.words.toArray()).map((word) => [
                        pairKey(word.kazakh, word.russian),
                        word,
                    ]),
                );
                for (const name of file.topics) {
                    const key = normalizeText(name);
                    if (!topics.has(key) && !seenTopics.has(key)) {
                        const topic: Topic = {
                            id: createId(),
                            name,
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                        };
                        await db.topics.add(topic);
                        topics.set(key, topic);
                    }
                    seenTopics.add(key);
                }
                let addedWords = 0;
                for (const item of file.words) {
                    const key = pairKey(item.kazakh, item.russian);
                    const existing = words.get(key);
                    const remoteTopics = item.topics
                        .map((name) => topics.get(normalizeText(name)))
                        .filter((topic): topic is Topic => !!topic);
                    if (!existing && !seenWords.has(key)) {
                        const word: Word = {
                            id: createId(),
                            kazakh: item.kazakh,
                            russian: item.russian,
                            topicIds: remoteTopics.map((topic) => topic.id).sort(),
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                        };
                        await db.words.add(word);
                        words.set(key, word);
                        addedWords++;
                    } else if (existing) {
                        const freshTopicIds = remoteTopics
                            .filter(
                                (topic) =>
                                    !seenLinks.has(linkKey(item.kazakh, item.russian, topic.name)),
                            )
                            .map((topic) => topic.id);
                        const merged = [
                            ...new Set([...existing.topicIds, ...freshTopicIds]),
                        ].sort();
                        if (
                            JSON.stringify([...existing.topicIds].sort()) !== JSON.stringify(merged)
                        ) {
                            await db.words.update(existing.id, {
                                topicIds: merged,
                                updatedAt: Date.now(),
                            });
                        }
                    }
                    seenWords.add(key);
                    item.topics.forEach((name) =>
                        seenLinks.add(linkKey(item.kazakh, item.russian, name)),
                    );
                }
                const next = validateFeedState({
                    source,
                    checkedAt,
                    seenWords: [...seenWords],
                    seenTopics: [...seenTopics],
                    seenLinks: [...seenLinks],
                });
                await db.appMeta.put({ key: 'dictionaryFeed', value: next });
                return { addedWords, totalWords: await db.words.count() };
            });
        },
    };
}
export const dictionaryFeedRepository = createDictionaryFeedRepository(database);
