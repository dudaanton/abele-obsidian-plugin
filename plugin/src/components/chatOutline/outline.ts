import { t, currentLocale, dateFormatter, relativeFormatter } from '@/i18n'
// What a chat's outline draws under one question, and the codes it marks rows with. Plain
// functions over the navigation model, so the rows can be built and tested without a chat open.
import dayjs from 'dayjs'
import { relativeDayLabel } from '@/helpers/displayFormat'
import type { NavigationTurn } from '@/ai/chatNavigation'
import type { ChatMessage } from '@/ai/types'

/** Needs you: waiting for your approval, or refused or failed. */
export type OutlineTone = 'waiting' | 'failed'

/** One line under a question: an answer, or a run of tool calls between answers. */
export type OutlineChild =
  | { kind: 'answer'; message: ChatMessage }
  | { kind: 'work'; id: string; tools: ChatMessage[] }

/** Answers and tool calls in the order they came, calls in a row folded into one line. */
export function turnChildren(turn: NavigationTurn): OutlineChild[] {
  const all = [...turn.answers, ...turn.tools].sort((a, b) => a.timestamp - b.timestamp)
  const out: OutlineChild[] = []
  for (const message of all) {
    const last = out[out.length - 1]
    if (message.role !== 'tool-call') out.push({ kind: 'answer', message })
    else if (last?.kind === 'work') last.tools.push(message)
    else out.push({ kind: 'work', id: message.id, tools: [message] })
  }
  return out
}

export function toolTone(tool: ChatMessage): OutlineTone | undefined {
  if (tool.toolStatus === 'rejected' || tool.subAgentRun?.status === 'error') return 'failed'
  if (tool.toolStatus === 'pending') return 'waiting'
  return undefined
}

/** The strongest of its calls: a failure outweighs a wait. */
export function toneOf(tools: readonly ChatMessage[]): OutlineTone | undefined {
  const tones = tools.map(toolTone)
  return tones.includes('failed') ? 'failed' : tones.includes('waiting') ? 'waiting' : undefined
}

export const toneLabel: Record<OutlineTone, string> = {
  get waiting() {
    return t('chat.waitingApproval')
  },
  get failed() {
    return t('chat.failed')
  },
}

export function toolIcon(tool: ChatMessage): string {
  if (tool.subAgentRun) return 'bot'
  const tone = toolTone(tool)
  return tone === 'failed' ? 'ban' : tone === 'waiting' ? 'clock' : 'wrench'
}

/** The tools a run of calls used, each once, in the order first used. */
export function toolNames(tools: readonly ChatMessage[]): string {
  return [...new Set(tools.map((tool) => tool.toolName || t('streamBMeta.2e53bdcd07')))].join(', ')
}

export const dayKey = (at: number) => dayjs(at).format('YYYY-MM-DD')

export function dayLabel(at: number, now = Date.now()): string {
  const day = dayjs(at).startOf('day')
  if (currentLocale().language !== 'en') {
    const offset = day.diff(dayjs(now).startOf('day'), 'day')
    if (offset === 0 || offset === -1)
      return relativeFormatter(currentLocale().format, { numeric: 'auto' }).format(offset, 'day')
    return dateFormatter(currentLocale().format, {
      day: 'numeric',
      month: 'long',
      ...(day.year() === dayjs(now).year() ? {} : { year: 'numeric' }),
    }).format(day.toDate())
  }
  const relative = relativeDayLabel(day.diff(dayjs(now).startOf('day'), 'day'))
  if (relative === 'Today' || relative === 'Yesterday') return relative
  return day.format(day.year() === dayjs(now).year() ? 'D MMMM' : 'D MMMM YYYY')
}

export const timeOf = (at: number) => dayjs(at).format('HH:mm')
