import { t } from './index'
const countKeys = {
  task: 'streamBCount.task',
  copy: 'streamBCount.copy',
  file: 'streamBCount.file',
  'staged file': 'streamBCount.stagedFile',
  'changed file': 'streamBCount.changedFile',
  commit: 'streamBCount.commit',
  byte: 'streamBCount.byte',
  line: 'streamBCount.line',
  question: 'streamBCount.question',
  discussion: 'streamBCount.discussion',
  'tool call': 'streamBCount.toolCall',
  match: 'streamBCount.match',
  reply: 'streamBCount.reply',
  comment: 'streamBCount.comment',
  message: 'streamBCount.message',
  token: 'streamBCount.token',
} as const
const wordKeys = {
  task: 'streamBWord.task',
  copy: 'streamBWord.copy',
  file: 'streamBWord.file',
  'staged file': 'streamBWord.stagedFile',
  'changed file': 'streamBWord.changedFile',
  commit: 'streamBWord.commit',
  byte: 'streamBWord.byte',
  line: 'streamBWord.line',
  question: 'streamBWord.question',
  discussion: 'streamBWord.discussion',
  'tool call': 'streamBWord.toolCall',
  match: 'streamBWord.match',
  reply: 'streamBWord.reply',
  comment: 'streamBWord.comment',
  message: 'streamBWord.message',
  token: 'streamBWord.token',
} as const

/** Presentation counts only; callers pass a stable noun, never a translated word. */
export function streamBCount(count: number, noun: string, many = `${noun}s`): string {
  const key = countKeys[noun as keyof typeof countKeys]
  return key ? t(key, { count }) : `${count} ${count === 1 ? noun : many}`
}
export function streamBWord(count: number, noun: keyof typeof wordKeys): string {
  return t(wordKeys[noun], { count })
}
