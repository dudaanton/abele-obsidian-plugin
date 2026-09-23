import dayjs from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { cleanNoteName, escapeRegExp, pathToWikilink, resolvePath } from './pathsHelpers'
import { DATE_FORMAT } from '@/constants/dates'

export const taskLineRegex = /^-\s\[\s\]\s(\[\[.*?\]\])$/

/**
 * Parses a task line to extract the task file wikilink.
 * @param line - The task line to parse.
 * @returns The extracted task file wikilink, or null if the line is not a valid task line.
 */
export function parseTaskLine(line: string): string | null {
  const match = line.match(taskLineRegex)
  if (match) {
    return match[1]
  }
  return null
}

export function createTaskEmbedded(wikilink: string): string {
  return `- [ ] ${wikilink}`
}

export function createTaskEmbeddedFromPath(path: string, alias?: string): string {
  return createTaskEmbedded(pathToWikilink(path, alias))
}

export function getDefaultTaskName(): string {
  const date = dayjs().format('YYYYMMDDHHmmss')
  return `task ${date}`
}

export function taskLinkFromName(name: string): string {
  const { tasksFolder } = AbeleConfig.getInstance()

  return pathToWikilink(resolvePath(tasksFolder, name))
}

export function getNewTaskPathFromString(str: string): string {
  const cleaned = cleanNoteName(str)

  return resolvePath(AbeleConfig.getInstance().tasksFolder, `${cleaned}.md`)
}

export function createTaskLinkRegex(...filePaths: string[]): RegExp {
  const escapedPaths = filePaths.map((p) => p.replace(/\.md$/, '')).map(escapeRegExp)

  const pathsPattern = `(?:${escapedPaths.join('|')})`

  const finalPattern = `- \\[ \\] \\[\\[${pathsPattern}(?:\\|.*?)?\\]\\]`

  return new RegExp(finalPattern, 'gm')
}

export function cleanTaskName(fileName: string): string {
  return cleanNoteName(fileName)
}

export function getRecurrentTaskTitle(content: string, date?: dayjs.Dayjs) {
  const lines = content.split('\n').filter((line: string) => line.trim() !== '')
  const rawTitle = date ? `${lines[0]} ${date.format(DATE_FORMAT)}` : lines[0]
  return lines.length > 0 ? cleanTaskName(rawTitle) || 'New Task' : 'New Task'
}
