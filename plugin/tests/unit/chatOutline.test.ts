import { describe, expect, it } from 'vitest'
import { buildChatNavigation } from '@/ai/chatNavigation'
import {
  dayLabel,
  toneOf,
  toolIcon,
  toolNames,
  turnChildren,
} from '@/components/chatOutline/outline'
import type { ChatMessage } from '@/ai/types'

const msg = (
  id: string,
  role: ChatMessage['role'],
  t: number,
  extra: Partial<ChatMessage> = {}
): ChatMessage => ({
  id,
  role,
  content: role === 'tool-call' ? '' : `text ${id}`,
  timestamp: t,
  ...extra,
})

describe('chat outline rows', () => {
  const turn = buildChatNavigation(
    [
      msg('q', 'user', 1),
      msg('t1', 'tool-call', 2, { toolName: 'web_search' }),
      msg('t2', 'tool-call', 3, { toolName: 'read_note' }),
      msg('t3', 'tool-call', 4, { toolName: 'web_search' }),
      msg('a1', 'assistant', 5),
      msg('t4', 'tool-call', 6, { toolName: 'run_command', toolStatus: 'pending' }),
      msg('a2', 'assistant', 7),
    ],
    []
  )[0]

  it('folds calls in a row into one line between the answers, in the order they came', () => {
    const children = turnChildren(turn)
    expect(
      children.map((c) => (c.kind === 'answer' ? c.message.id : c.tools.map((t) => t.id).join('+')))
    ).toEqual(['t1+t2+t3', 'a1', 't4', 'a2'])
  })

  it('names a run by its tools, each once', () => {
    const work = turnChildren(turn)[0]
    expect(work.kind === 'work' && toolNames(work.tools)).toBe('web_search, read_note')
  })

  it('marks what needs you, a failure over a wait', () => {
    expect(toneOf(turn.tools)).toBe('waiting')
    expect(toolIcon(turn.tools[3])).toBe('clock')
    const refused = msg('t5', 'tool-call', 8, { toolName: 'delete_note', toolStatus: 'rejected' })
    expect(toneOf([...turn.tools, refused])).toBe('failed')
    expect(toolIcon(refused)).toBe('ban')
  })

  it('says a day as today, yesterday or its date', () => {
    const now = new Date(2026, 9, 11, 12).getTime()
    expect(dayLabel(new Date(2026, 9, 11, 9).getTime(), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 10, 22).getTime(), now)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 8, 29, 22).getTime(), now)).toBe('29 September')
    expect(dayLabel(new Date(2025, 8, 29, 22).getTime(), now)).toBe('29 September 2025')
  })
})
