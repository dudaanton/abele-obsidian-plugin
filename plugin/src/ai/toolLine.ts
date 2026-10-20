import type { ChatMessage } from './types'
import { t } from '@/i18n'
import { extractResultPath, toolFilePaths } from './toolFiles'
export { extractResultPath } from './toolFiles'

/**
 * What a tool call shows of itself in a chat, as text.
 *
 * Here rather than in the message component because finding words in a chat has to look at the
 * same text the message draws: a word found in a result the message does not show, or missed in
 * one it does, is a count that does not match the screen.
 */

/** How much of a tool's result the message shows under its details. */
export const TOOL_RESULT_MAX_LENGTH = 1000
export const terminalText = (text: string): string =>
  text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g'), '')

/** MCP identifiers stay in details; the action line uses the server and action as words. */
export function readableToolName(name?: string): string {
  if (name === 'list_chats') return t('chat.listChatsTool')
  if (name === 'send_message_to_chat') return t('chat.sendMessageTool')
  if (!name) return ''
  if (name === 'mv') return t('streamB.moveFile.f83e6d')
  if (name === 'rm') return t('streamB.deleteFile.28e18d')
  if (name === 'cp') return t('streamB.copyFile.b60f1c')
  if (name === 'ls') return t('streamB.listFiles')
  const words = (value: string) => value.replace(/[_-]+/g, ' ').trim()
  const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
  const match = /^mcp__(.+?)__(.+)$/.exec(name)
  if (!match) return capital(words(name))
  const server = match[1].replace(/^abele_/, '')
  const action = server === 'debugger' ? match[2].replace(/^debug_/, '') : match[2]
  return `${capital(words(server))}: ${words(action)}`
}

export const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) + '…' : s

/** The short thing after the tool's name on its line: the file, the address, the query. */
export function toolSummary(
  message: Pick<
    ChatMessage,
    'toolName' | 'toolParams' | 'toolResult' | 'toolTitle' | 'toolPath' | 'toolPaths'
  >
): string {
  const paths = toolFilePaths(message)
  if (paths.length) return paths.join(' ')
  const said = paramsSummary(message)
  if (said || !message.toolTitle) return said
  // Another agent's own words for the call, without the name the line already starts with.
  const title = message.toolTitle.trim()
  const name = message.toolName ?? ''
  const rest =
    name && title.toLowerCase().startsWith(name.toLowerCase() + ' ')
      ? title.slice(name.length + 1)
      : title.toLowerCase() === name.toLowerCase()
        ? ''
        : title
  return truncate(rest.replace(/\s+/g, ' '), 160)
}

function paramsSummary(message: Pick<ChatMessage, 'toolName' | 'toolParams' | 'toolResult'>) {
  const name = message.toolName
  const p = message.toolParams
  // For apply_template, show created file path once available
  if (name === 'apply_template') {
    return extractResultPath(message.toolResult) || String(p?.path || '')
  }
  if (!p) return ''
  if (p.file_path) return truncate(String(p.file_path), 160)
  if (p.command) return truncate(String(p.command).replace(/\s+/g, ' '), 160)
  if (p.description) return truncate(String(p.description), 160)
  if (p.pattern) return truncate(String(p.pattern), 160)
  if (p.path) return String(p.path)
  if (p.from && p.to) return `${p.from} → ${p.to}`
  if (p.url) return String(p.url)
  if (p.query) return String(p.query)
  if (p.name) return String(p.name)
  return ''
}

/** The parameters as the details under a tool call print them. */
export const toolParamsText = (params: Record<string, unknown>): string =>
  JSON.stringify(params, null, 2)

/** The result as the details under a tool call print it. */
export function toolResultText(result: string): string {
  try {
    const value: unknown = JSON.parse(result)
    const label = (key: string) => {
      const words = key.replace(/[_-]+/g, ' ')
      return words.charAt(0).toUpperCase() + words.slice(1)
    }
    const lines = (item: unknown, depth = 0): string => {
      if (item === null) return 'null'
      if (typeof item === 'string') return terminalText(item)
      if (typeof item === 'number' || typeof item === 'boolean') return String(item)
      if (typeof item !== 'object') return ''
      if (depth > 4) return '…'
      return Object.entries(item)
        .map(([key, value]) => `${label(key)}: ${lines(value, depth + 1)}`)
        .join('\n')
    }
    return truncate(lines(value), TOOL_RESULT_MAX_LENGTH)
  } catch {
    return truncate(terminalText(result), TOOL_RESULT_MAX_LENGTH)
  }
}
