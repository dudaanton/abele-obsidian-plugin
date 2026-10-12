import { describe, expect, it } from 'vitest'
import { chatBlocks, ownLine, runKind, runState, runSummary, toolKind } from '@/ai/toolRuns'
import type { ChatMessage } from '@/ai/types'

let n = 0
const call = (toolName: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({
    id: `c${++n}`,
    role: 'tool-call',
    content: '',
    timestamp: n,
    toolName,
    toolStatus: 'approved',
    toolResult: 'ok',
    ...extra,
  }) as ChatMessage
const say = (role: 'user' | 'assistant', content: string): ChatMessage =>
  ({ id: `m${++n}`, role, content, timestamp: n }) as ChatMessage

describe('the kind of work a tool does', () => {
  it('is read from its name', () => {
    expect(toolKind('web_search')).toBe('search')
    expect(toolKind('read_note')).toBe('read')
    expect(toolKind('write_file')).toBe('write')
    expect(toolKind('rm')).toBe('delete')
    expect(toolKind('mv')).toBe('write')
    expect(toolKind('sample_tool')).toBe('other')
    expect(toolKind('delete_note')).toBe('delete')
    expect(toolKind('run_command')).toBe('run')
    expect(toolKind(undefined)).toBe('other')
  })
})

describe('a run of calls', () => {
  it('is told by its kinds in the order they came, with counts', () => {
    const calls = [call('web_search'), call('web_search'), call('read_note')]
    expect(runSummary(calls)).toBe('Searched 2 · Read')
    expect(runKind(calls)).toBe('search')
  })

  it('uses the latest of the most frequent kinds when their counts tie', () => {
    expect(
      runKind([call('read'), call('read'), call('web_search'), call('web_search'), call('write')])
    ).toBe('search')
  })

  it('does not describe an unapproved call as completed work', () => {
    expect(
      runSummary([
        call('read'),
        call('run_command', { toolStatus: 'pending', toolResult: undefined }),
      ])
    ).toBe('Read · Run requested')
  })

  it('says the kind still under way as going on', () => {
    const calls = [call('web_search'), call('read_note', { toolResult: undefined })]
    expect(runSummary(calls)).toBe('Searched · Reading')
    expect(runState(calls)).toBe('running')
  })

  it('is failed when anything in it was refused, before waiting or running', () => {
    expect(
      runState([
        call('write_file', { toolStatus: 'pending', toolResult: undefined }),
        call('run_command', { toolStatus: 'rejected' }),
      ])
    ).toBe('failed')
    expect(runState([call('write_file', { toolStatus: 'pending', toolResult: undefined })])).toBe(
      'waiting'
    )
    expect(runState([call('read_note')])).toBe('done')
  })
})

describe('a chat as drawn', () => {
  it('folds calls in a row, and the results that answer them, into one run', () => {
    const q = say('user', 'Find it')
    const a = call('web_search')
    const result = { ...say('assistant', ''), role: 'tool-result' } as ChatMessage
    const b = call('read_note')
    const answer = say('assistant', 'Here')
    const blocks = chatBlocks([q, a, result, b, answer])
    expect(blocks.map((x) => x.kind)).toEqual(['message', 'run', 'message'])
    const run = blocks[1]
    expect(run.kind === 'run' && run.calls).toEqual([a, b])
    expect(run.kind === 'run' && run.messages).toEqual([a, result, b])
    expect(run.kind === 'run' && run.id).toBe(a.id)
  })

  it('starts a new run after anything said between calls', () => {
    const blocks = chatBlocks([call('web_search'), say('assistant', 'Next'), call('read_note')])
    expect(blocks.map((x) => x.kind)).toEqual(['run', 'message', 'run'])
  })

  it('gives a helper agent a line of its own, closing the run before it', () => {
    const before = call('web_search')
    const delegate = call('delegate', {
      subAgentRun: {
        runId: 'r1',
        agentId: 'a1',
        agentName: 'Worker',
        path: 'Runs/r1.abchat',
        status: 'running',
        branchCount: 1,
      },
    })
    const after = call('read_note')
    const blocks = chatBlocks([before, delegate, after])
    expect(blocks.map((x) => x.kind)).toEqual(['run', 'message', 'run'])
    expect(blocks[0].kind === 'run' && blocks[0].calls).toEqual([before])
    expect(blocks[1].kind === 'message' && blocks[1].message).toBe(delegate)
    expect(blocks[2].kind === 'run' && blocks[2].calls).toEqual([after])
  })

  it('gives a proposed change to a reply a line of its own', () => {
    const proposal = call('propose_reply_change', {
      replyProposal: { id: 'p', status: 'pending' } as ChatMessage['replyProposal'],
    })
    expect(ownLine(proposal)).toBe(true)
    expect(ownLine(call('web_search'))).toBe(false)
    expect(ownLine(say('assistant', 'Plain'))).toBe(false)
    expect(chatBlocks([call('web_search'), proposal]).map((x) => x.kind)).toEqual([
      'run',
      'message',
    ])
  })
})
