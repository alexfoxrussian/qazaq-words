export function cleanText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

export function normalizeText(value: string): string {
  return cleanText(value).toLocaleLowerCase('ru-RU')
}

const pluralRules = new Intl.PluralRules('ru')
export function wordCount(count: number): string {
  const form = pluralRules.select(count)
  return `${count.toLocaleString('ru-RU')} ${form === 'one' ? 'слово' : form === 'few' ? 'слова' : 'слов'}`
}
