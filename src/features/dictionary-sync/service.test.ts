import { afterEach, expect, it, vi } from 'vitest';
import { createDictionarySync, fetchDictionary, type SyncStatus } from './service';
import { MAX_DICTIONARY_BYTES } from '../../entities/word/dictionaryTransfer';

const source = 'https://example.com/dictionary.json';
const bootstrap = { format: 'qazaq-words-dictionary', version: 1, topics: [], words: [] };
afterEach(() => vi.useRealTimers());

it('на первом офлайн-запуске использует встроенную копию, при появлении сети получает обновление', async () => {
    let online = false;
    const apply = vi.fn().mockResolvedValue({ addedWords: 0, totalWords: 0 });
    const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(bootstrap)));
    const statuses: SyncStatus[] = [];
    const sync = createDictionarySync({
        source,
        bootstrap,
        repository: { apply },
        fetcher,
        online: () => online,
        publish: (status) => statuses.push(status),
    });
    await sync.refresh();
    expect(fetcher).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledWith(bootstrap, source, 0, true);
    expect(statuses.at(-1)?.phase).toBe('ready');
    online = true;
    await sync.refresh(true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', mode: 'cors' });
    expect(apply).toHaveBeenCalledTimes(3);
});

it('после сетевой ошибки сохраняет копию, повторяет автоматически и ограничивает частоту успешных проверок', async () => {
    let clock = 0;
    const apply = vi.fn().mockResolvedValue({ addedWords: 0, totalWords: 0 });
    const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockImplementation(async () => new Response(JSON.stringify(bootstrap)));
    const publish = vi.fn();
    const sync = createDictionarySync({
        source,
        bootstrap,
        repository: { apply },
        fetcher,
        online: () => true,
        now: () => clock,
        publish,
    });
    await Promise.all([sync.refresh(), sync.refresh()]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
    expect(publish.mock.lastCall?.[0].phase).toBe('error');
    await sync.refresh();
    expect(fetcher).toHaveBeenCalledOnce();
    clock = 60000;
    await sync.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(publish.mock.lastCall?.[0].phase).toBe('ready');
    clock += 60000;
    await sync.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);
    clock += 3600000;
    await sync.refresh();
    expect(fetcher).toHaveBeenCalledTimes(3);
});

it('отклоняет повреждённый файл и слишком большой поток даже без content-length', async () => {
    await expect(fetchDictionary(source, async () => new Response('{bad'))).rejects.toThrow();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array(MAX_DICTIONARY_BYTES + 1));
            controller.close();
        },
    });
    await expect(fetchDictionary(source, async () => new Response(stream))).rejects.toThrow(
        'too large',
    );
});

it('прерывает зависшую сеть через 15 секунд', async () => {
    vi.useFakeTimers();
    const result = fetchDictionary(
        source,
        (_url, options) =>
            new Promise((_resolve, reject) => {
                options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            }),
    );
    const assertion = expect(result).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
});
