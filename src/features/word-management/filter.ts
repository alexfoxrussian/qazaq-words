import type { Word } from '../../entities/models';
import { normalizeText } from '../../shared/utils/text';

export function filterWords(words: Word[], query: string, topicId: string): Word[] {
    const needle = normalizeText(query);
    return words.filter(
        (word) =>
            (!topicId || word.topicIds.includes(topicId)) &&
            (!needle ||
                normalizeText(word.kazakh).includes(needle) ||
                normalizeText(word.russian).includes(needle)),
    );
}
