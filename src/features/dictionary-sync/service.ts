import { MAX_DICTIONARY_BYTES, parseDictionaryFile } from '../../entities/word/dictionaryTransfer';
import type { createDictionaryFeedRepository } from '../../shared/db/dictionaryFeedRepository';

export interface SyncStatus {
    phase: 'idle' | 'loading' | 'ready' | 'error';
    message: string | null;
}
type FeedRepository = Pick<ReturnType<typeof createDictionaryFeedRepository>, 'apply'>;

export async function fetchDictionary(source: string, fetcher: typeof fetch = fetch) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetcher(source, {
            signal: controller.signal,
            credentials: 'omit',
            mode: 'cors',
            cache: 'no-store',
        });
        if (!response.ok) {
            throw new Error(`Dictionary HTTP ${response.status}`);
        }
        if (Number(response.headers.get('content-length')) > MAX_DICTIONARY_BYTES) {
            throw new Error('Dictionary is too large');
        }
        if (!response.body) {
            return parseDictionaryFile(await response.text());
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0,
            content = '';
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) {
                    break;
                }
                bytes += chunk.value.byteLength;
                if (bytes > MAX_DICTIONARY_BYTES) {
                    await reader.cancel();
                    throw new Error('Dictionary is too large');
                }
                content += decoder.decode(chunk.value, { stream: true });
            }
            content += decoder.decode();
        } finally {
            reader.releaseLock();
        }
        return parseDictionaryFile(content);
    } finally {
        clearTimeout(timeout);
    }
}

export function createDictionarySync({
    repository,
    source,
    bootstrap,
    publish,
    fetcher = fetch,
    online = () => navigator.onLine,
    now = Date.now,
}: {
    repository: FeedRepository;
    source: string;
    bootstrap: unknown;
    publish: (status: SyncStatus) => void;
    fetcher?: typeof fetch;
    online?: () => boolean;
    now?: () => number;
}) {
    let running: Promise<void> | null = null;
    let nextCheck = 0,
        failures = 0;
    async function run() {
        publish({ phase: 'loading', message: 'Загружаем общий словарь…' });
        try {
            await repository.apply(bootstrap, source, 0, true);
            if (!online()) {
                nextCheck = now() + 60000;
                publish({ phase: 'ready', message: null });
                return;
            }
            const file = await fetchDictionary(source, fetcher);
            await repository.apply(file, source, now());
            failures = 0;
            nextCheck = now() + 60 * 60 * 1000;
            publish({ phase: 'ready', message: null });
        } catch {
            failures++;
            nextCheck = now() + Math.min(60 * 60 * 1000, 60000 * 2 ** Math.min(failures - 1, 6));
            publish({
                phase: 'error',
                message:
                    'Не удалось обновить общий словарь. Локальные слова доступны; повторим загрузку автоматически.',
            });
        }
    }
    return {
        refresh(force = false): Promise<void> {
            if (running) {
                return running;
            }
            if (!force && now() < nextCheck) {
                return Promise.resolve();
            }
            running = run().finally(() => {
                running = null;
            });
            return running;
        },
    };
}
