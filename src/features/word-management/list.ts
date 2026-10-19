import type { Word } from '../../entities/models';

export type WordSort =
    'kazakh-asc' | 'kazakh-desc' | 'russian-asc' | 'russian-desc' | 'created-asc' | 'created-desc';
const kazakh = new Intl.Collator('kk', { sensitivity: 'base', numeric: true });
const russian = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

export function wordPage(words: Word[], sort: WordSort, requestedPage: number, pageSize: number) {
    const sorted = [...words].sort((a, b) => {
        const comparison = sort.startsWith('kazakh')
            ? kazakh.compare(a.kazakh, b.kazakh)
            : sort.startsWith('russian')
              ? russian.compare(a.russian, b.russian)
              : a.createdAt - b.createdAt;
        return (sort.endsWith('desc') ? -comparison : comparison) || a.id.localeCompare(b.id);
    });
    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, requestedPage), pages);
    const offset = (page - 1) * pageSize;
    return {
        words: sorted.slice(offset, offset + pageSize),
        page,
        pages,
        total,
        start: total ? offset + 1 : 0,
        end: Math.min(offset + pageSize, total),
    };
}
