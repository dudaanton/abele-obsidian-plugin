import type { ChatMessage } from './types'

/**
 * What a tool call shows of itself in a chat, as text.
 *
 * Here rather than in the message component because finding words in a chat has to look at the
 * same text the message draws: a word found in a result the message does not show, or missed in
 * one it does, is a count that does not match the screen.
 */

/** How much of a tool's result the message shows under its details. */
export const TOOL_RESULT_MAX_LENGTH = 1000

export const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) + '…' : s

/** The path in a result like "Created: path" or "Saved: path". */
export function extractResultPath(result?: string): string {
  if (!result) return ''
  const match = result.match(/^(?:Created|Saved|Edited):\s*(.+)$/m)
  return match?.[1]?.trim() || ''
}

/** The short thing after the tool's name on its line: the file, the address, the query. */
export function toolSummary(message: Pick<ChatMessage, 'toolName' | 'toolParams' | 'toolResult'>) {
  const name = message.toolName
  const p = message.toolParams
  // For apply_template, show created file path once available
  if (name === 'apply_template') {
    return extractResultPath(message.toolResult) || String(p?.path || '')
  }
  if (!p) return ''
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
export const toolResultText = (result: string): string => truncate(result, TOOL_RESULT_MAX_LENGTH)
