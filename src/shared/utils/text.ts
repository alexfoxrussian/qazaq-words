export function cleanText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

export function normalizeText(value: string): string {
  return cleanText(value).toLocaleLowerCase('ru-RU')
}
