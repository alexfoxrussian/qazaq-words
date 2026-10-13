import type { Answer, AppMeta, Profile, ProfileSettings, Progress, QuestionSnapshot, Topic, TrainingSession, Word } from '../../entities/models'
import { validateAvatar } from '../../entities/profile/photo'
import { evaluateAnswer } from '../../entities/training/domain'
import { normalizeText } from '../../shared/utils/text'
import { ValidationError } from '../../shared/db/errors'
import { validateFeedState } from '../../entities/word/dictionaryFeed'
export interface BackupData { profiles: Profile[]; words: Word[]; topics: Topic[]; progress: Progress[]; sessions: TrainingSession[]; answers: Answer[]; settings: ProfileSettings[]; appMeta: AppMeta[] }
export interface Backup { format: 'qazaq-words-backup'; schemaVersion: 1; exportedAt: string; data: BackupData }
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024
export const backupTables = ['profiles', 'words', 'topics', 'progress', 'sessions', 'answers', 'settings', 'appMeta'] as const
function invalid(reason: string): never { throw new ValidationError(`Неверная резервная копия: ${reason}`) }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('ожидается объект.'); return value as Record<string, unknown> }
function text(value: unknown, max = 200): asserts value is string { if (typeof value !== 'string' || !value.trim() || value.length > max) invalid('пустая или слишком длинная строка.') }
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): asserts value is number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) invalid('число вне допустимого диапазона.') }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) return invalid('ожидается массив.'); return value }
function unique(values: string[], label: string) { if (new Set(values).size !== values.length) invalid(`повторяются ${label}.`) }
function base(item: Record<string, unknown>) { text(item.id); integer(item.createdAt); integer(item.updatedAt); if ((item.updatedAt as number) < (item.createdAt as number)) invalid('дата изменения раньше создания.') }
function question(value: unknown): QuestionSnapshot {
  const item = record(value); text(item.wordId); text(item.kazakh); text(item.russian)
  const options = array(item.options); options.forEach((option) => text(option)); integer(item.correctIndex, 3)
  try { evaluateAnswer(item as unknown as QuestionSnapshot, item.correctIndex) } catch { invalid('неоднозначные варианты или неверный правильный индекс.') }
  return item as unknown as QuestionSnapshot
}
export function validateBackup(value: unknown): Backup {
  const root = record(structuredClone(value))
  if (root.format !== 'qazaq-words-backup') invalid('неизвестный формат. Для словаря используйте его отдельный импорт.')
  if (root.schemaVersion !== 1) invalid('версия не поддерживается.')
  text(root.exportedAt); if (!Number.isFinite(Date.parse(root.exportedAt as string))) invalid('неверная дата экспорта.')
  const raw = record(root.data)
  for (const name of backupTables) array(raw[name]).forEach(record)
  const data = raw as unknown as BackupData
  for (const name of ['profiles', 'words', 'topics', 'sessions', 'answers'] as const) {
    for (const item of data[name]) text(item.id)
    unique(data[name].map((item) => item.id), `ключи ${name}`)
  }
  for (const item of data.profiles) { base(record(item)); text(item.name, 80); if (item.avatarDataUrl !== undefined) { try { validateAvatar(item.avatarDataUrl) } catch { invalid('некорректное фото профиля.') } } }
  for (const item of data.topics) { base(record(item)); text(item.name, 80) }
  unique(data.topics.map((item) => normalizeText(item.name)), 'названия тем')
  const profiles = new Set(data.profiles.map((item) => item.id)), words = new Set(data.words.map((item) => item.id)), topics = new Set(data.topics.map((item) => item.id))
  const owner = (id: unknown) => { text(id); if (!profiles.has(id)) invalid('ссылка на отсутствующий профиль.') }
  for (const item of data.words) {
    base(record(item)); text(item.kazakh); text(item.russian)
    array(item.topicIds).forEach((id) => { text(id); if (!topics.has(id)) invalid('ссылка на отсутствующую тему.') })
    unique(item.topicIds, 'темы слова')
  }
  unique(data.words.map((item) => JSON.stringify([normalizeText(item.kazakh), normalizeText(item.russian)])), 'пары слов и переводов')
  for (const item of data.settings) {
    owner(item.profileId)
    if (record(item).visualStyle === 'modern-new') item.visualStyle = 'modern'
    if (!['light', 'dark', 'system'].includes(item.colorMode) || !['blue', 'emerald', 'amber', 'violet', 'gray'].includes(item.palette) || !['modern', 'retro', 'pixel', 'orient'].includes(item.visualStyle)) invalid('неверное оформление.')
    if (item.fontSize === undefined) item.fontSize = 'standard'
    if (!['standard', 'large', 'maximum'].includes(item.fontSize)) invalid('неверный размер шрифта.')
    integer(item.sessionLength)
  }
  unique(data.settings.map((item) => item.profileId), 'настройки профиля')
  if (data.settings.length !== data.profiles.length) invalid('для каждого профиля нужны настройки.')
  for (const item of data.progress) {
    owner(item.profileId); text(item.wordId); if (!words.has(item.wordId)) invalid('прогресс отсутствующего слова.')
    integer(item.stage, 5); integer(item.dueAt); integer(item.lastAnsweredAt); integer(item.correctCount); integer(item.incorrectCount)
    if (item.dueAt < item.lastAnsweredAt) invalid('срок повторения раньше ответа.')
  }
  unique(data.progress.map((item) => JSON.stringify([item.profileId, item.wordId])), 'ключи прогресса')
  const sessions = new Map(data.sessions.map((item) => [item.id, item]))
  for (const item of data.sessions) {
    owner(item.profileId); integer(item.startedAt); integer(item.targetCount); integer(item.answeredCount); integer(item.correctCount); integer(item.cursor)
    if (!['active', 'completed', 'interrupted'].includes(item.status)) invalid('неверный статус сеанса.')
    const questions = array(item.queueSnapshots).map(question)
    unique(questions.map((q) => q.wordId), 'слова в сеансе')
    if (item.targetCount < 1 || item.targetCount !== questions.length || item.cursor !== item.answeredCount || item.answeredCount > item.targetCount || item.correctCount > item.answeredCount) invalid('несогласованные счётчики сеанса.')
    if (item.status === 'active') {
      if (item.endedAt !== undefined || item.cursor === item.targetCount || questions.some((q) => !words.has(q.wordId))) invalid('неверный активный сеанс.')
    } else {
      integer(item.endedAt); if (item.endedAt < item.startedAt || (item.status === 'completed' && item.cursor !== item.targetCount)) invalid('неверный завершённый сеанс.')
    }
  }
  unique(data.sessions.filter((item) => item.status === 'active').map((item) => item.profileId), 'активные сеансы профиля')
  const answersBySession = new Map<string, Answer[]>()
  for (const item of data.answers) {
    owner(item.profileId); text(item.sessionId); text(item.wordId); integer(item.questionIndex); integer(item.selectedIndex, 3); integer(item.correctIndex, 3); integer(item.answeredAt)
    if (typeof item.isCorrect !== 'boolean') invalid('неверная правильность ответа.')
    const snapshot = question({ wordId: item.wordId, kazakh: item.kazakhSnapshot, russian: item.russianSnapshot, options: item.optionsSnapshot, correctIndex: item.correctIndex })
    const session = sessions.get(item.sessionId), original = session?.queueSnapshots[item.questionIndex]
    if (!session || session.profileId !== item.profileId || !original || JSON.stringify(snapshot) !== JSON.stringify({ wordId: original.wordId, kazakh: original.kazakh, russian: original.russian, options: original.options, correctIndex: original.correctIndex }) || item.isCorrect !== (item.selectedIndex === item.correctIndex) || item.answeredAt < session.startedAt || (session.endedAt !== undefined && item.answeredAt > session.endedAt)) invalid('ответ не согласуется с сеансом.')
    const list = answersBySession.get(item.sessionId) ?? []; list.push(item); answersBySession.set(item.sessionId, list)
  }
  unique(data.answers.map((item) => JSON.stringify([item.sessionId, item.questionIndex])), 'ответы на вопрос')
  for (const session of data.sessions) {
    const answers = (answersBySession.get(session.id) ?? []).sort((a, b) => a.questionIndex - b.questionIndex)
    if (answers.length !== session.answeredCount || answers.filter((a) => a.isCorrect).length !== session.correctCount || answers.some((a, index) => a.questionIndex !== index || (index > 0 && a.answeredAt < answers[index - 1].answeredAt))) invalid('ответы не соответствуют счётчикам или порядку сеанса.')
  }
  unique(data.appMeta.map((item) => item.key), 'ключи метаданных')
  if ((data.appMeta.length !== 2 && data.appMeta.length !== 3) || data.appMeta.some((item) => !['activeProfileId', 'initialized', 'dictionaryFeed'].includes(item.key)) || !data.appMeta.some((item) => item.key === 'initialized' && item.value === true)) invalid('неверные метаданные.')
  const feed = data.appMeta.find((item) => item.key === 'dictionaryFeed')
  if (feed) { try { validateFeedState(feed.value) } catch { invalid('неверные метаданные общего словаря.') } }
  const active = data.appMeta.find((item) => item.key === 'activeProfileId')
  if (!active || (active.value !== null && (typeof active.value !== 'string' || !profiles.has(active.value)))) invalid('неверный активный профиль.')
  if (data.sessions.some((session) => session.status === 'active' && session.profileId !== active.value)) invalid('активный сеанс принадлежит другому профилю.')
  return structuredClone(root) as unknown as Backup
}
export function parseBackup(content: string): Backup {
  if (new TextEncoder().encode(content).length > MAX_BACKUP_BYTES) throw new ValidationError('Файл превышает 25 MiB.')
  let value: unknown
  try { value = JSON.parse(content) } catch { throw new ValidationError('Не удалось прочитать JSON.') }
  return validateBackup(value)
}
