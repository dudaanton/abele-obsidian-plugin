import dayjs from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { cleanFileName, escapeRegExp, pathToWikilink, resolvePath } from './pathsHelpers'
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
  const cleaned = cleanFileName(str)

  return resolvePath(AbeleConfig.getInstance().tasksFolder, `${cleaned}.md`)
}

export function createTaskLinkRegex(...filePaths: string[]): RegExp {
  const escapedPaths = filePaths.map((p) => p.replace(/\.md$/, '')).map(escapeRegExp)

  const pathsPattern = `(?:${escapedPaths.join('|')})`

  const finalPattern = `- \\[ \\] \\[\\[${pathsPattern}(?:\\|.*?)?\\]\\]`

  return new RegExp(finalPattern, 'gm')
}

export function cleanTaskName(fileName: string): string {
  // replace wikilinks with their alias or name
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g
  fileName = fileName.replace(wikilinkRegex, (_, linkContent) => {
    const parts = linkContent.split('|')
    return parts.length > 1 ? parts[1].trim() : parts[0].trim()
  })

  // Remove invalid characters for file names
  return cleanFileName(fileName)
}

export function getRecurrentTaskTitle(content: string, date?: dayjs.Dayjs) {
  const lines = content.split('\n').filter((line: string) => line.trim() !== '')
  const rawTitle = date ? `${lines[0]} ${date.format(DATE_FORMAT)}` : lines[0]
  return lines.length > 0 ? cleanTaskName(rawTitle) || 'New Task' : 'New Task'
}
