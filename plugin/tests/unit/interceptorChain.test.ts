/**
 * Several interceptors in a row, without a chat: the order they run in, which ones are skipped,
 * where the chain stops, and the single interceptor of before lists read as a list of one.
 */
import { describe, it, expect } from 'vitest'
import type { InterceptorEntry } from '@/ai/agents/types'
import { anyReads, placeOf, runChain, type ChainStep } from '@/ai/interceptor/chain'
import {
  chainFor,
  entriesOf,
  legacyEntry,
  legacyFields,
  newEntry,
  normaliseEntries,
  withLegacyPatch,
} from '@/ai/interceptor/entries'

const entry = (id: string, patch: Partial<InterceptorEntry> = {}): InterceptorEntry =>
  newEntry({ id, script: `Sample ${id}`, ...patch })

describe('runChain', () => {
  it('gives each one what the one before returned, in the list order', async () => {
    const seen: string[] = []
    const result = await runChain(
      [entry('a'), entry('b'), entry('c')],
      0,
      'typed',
      async (step: ChainStep, text) => {
        seen.push(`${step.at}/${step.of} ${step.entry.id}: ${text}`)
        return { kind: 'pass', text: `${text}+${step.entry.id}` }
      }
    )
    expect(seen).toEqual(['1/3 a: typed', '2/3 b: typed+a', '3/3 c: typed+a+b'])
    expect(result).toEqual({ kind: 'done', text: 'typed+a+b+c' })
  })

  it('skips one whose pattern does not match the text it would get, judged after the change', async () => {
    const seen: string[] = []
    const result = await runChain(
      [entry('a'), entry('b', { pattern: '^/fix' }), entry('c', { pattern: 'changed' })],
      0,
      'typed',
      async (step, text) => {
        seen.push(step.entry.id)
        return { kind: 'pass', text: step.entry.id === 'a' ? 'changed text' : text }
      }
    )
    expect(seen).toEqual(['a', 'c'])
    expect(result).toEqual({ kind: 'done', text: 'changed text' })
  })

  it('reads with a pattern that does not compile and says why', async () => {
    const steps: ChainStep[] = []
    await runChain([entry('a', { pattern: '(' })], 0, 'x', async (step, text) => {
      steps.push(step)
      return { kind: 'pass', text }
    })
    expect(steps[0].broken).toBeTruthy()
  })

  it('stops at the one that stops it, and the ones after it never run', async () => {
    const seen: string[] = []
    const result = await runChain(
      [entry('a'), entry('b'), entry('c')],
      0,
      'typed',
      async (step, text) => {
        seen.push(step.entry.id)
        return step.entry.id === 'b'
          ? { kind: 'stop', result: 'failed at b' }
          : { kind: 'pass', text }
      }
    )
    expect(seen).toEqual(['a', 'b'])
    expect(result).toMatchObject({ kind: 'stopped', at: 2, result: 'failed at b' })
  })

  it('resumes from a given place: a retry runs the failed one again, Send runs the next', async () => {
    const seen: string[] = []
    const chain = [entry('a'), entry('b'), entry('c')]
    await runChain(chain, 1, 'after a', async (step, text) => {
      seen.push(`${step.at} ${step.entry.id}`)
      return { kind: 'pass', text }
    })
    expect(seen).toEqual(['2 b', '3 c'])
  })

  it('finds where a waiting message stands after the list changed', () => {
    const chain = [entry('x'), entry('a'), entry('b')]
    expect(placeOf(chain, { entry: 'b', at: 2 })).toBe(2)
    expect(placeOf(chain, { entry: 'gone', at: 2 })).toBe(1)
    expect(placeOf(chain, { entry: 'gone', at: 9 })).toBe(3)
  })

  it('knows when nobody would read a text at all', () => {
    expect(anyReads([entry('a', { pattern: '^/fix' })], 'plain')).toBe(false)
    expect(anyReads([entry('a', { pattern: '^/fix' }), entry('b')], 'plain')).toBe(true)
  })
})

describe('the list an agent or a chat runs', () => {
  it('counts only switched-on entries that read that side', () => {
    const list = [
      entry('m', { checks: 'message' }),
      entry('off', { enabled: false }),
      entry('a', { checks: 'answer' }),
      entry('b', { checks: 'both' }),
    ]
    expect(chainFor(list, 'message').map((e) => e.id)).toEqual(['m', 'b'])
    expect(chainFor(list, 'answer').map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('reads the single interceptor of before lists as a list of one, a script winning', () => {
    const single = entriesOf({
      interceptorAgentId: 'reviewer',
      interceptorScript: 'Sample guard',
      interceptorChecks: 'both',
      interceptorPattern: '^/x',
      interceptorReplyOnly: true,
      interceptorContextDepth: 4,
    })
    expect(single).toEqual([
      {
        id: expect.any(String),
        agentId: '',
        script: 'Sample guard',
        checks: 'both',
        pattern: '^/x',
        replyOnly: true,
        contextDepth: 4,
        enabled: true,
      },
    ])
    expect(entriesOf({ interceptorAgentId: '', interceptorScript: '' })).toEqual([])
    expect(legacyEntry({})).toBeNull()
  })

  it('prefers its own list once it has one, even an empty one', () => {
    expect(entriesOf({ interceptorAgentId: 'reviewer', interceptors: [] })).toEqual([])
  })

  it('mirrors its first switched-on entry into the single fields for older builds', () => {
    const list = [
      newEntry({ id: 'off', script: 'Sample off', enabled: false }),
      newEntry({ id: 'r', agentId: 'reviewer', checks: 'answer', contextDepth: -1 }),
      entry('s'),
    ]
    expect(legacyFields(list)).toEqual({
      interceptorAgentId: 'reviewer',
      interceptorContextDepth: -1,
      interceptorReplyOnly: false,
      interceptorChecks: 'answer',
      interceptorScript: '',
      interceptorPattern: '',
    })
    expect(legacyFields([]).interceptorAgentId).toBe('')
  })

  it('applies a change to the single fields to the entry they mirror, keeping the rest', () => {
    const list = [newEntry({ id: 'r', agentId: 'reviewer' }), entry('s')]
    const patched = withLegacyPatch(list, { interceptorPattern: '^/x', interceptorChecks: 'both' })
    expect(patched.map((e) => [e.id, e.pattern, e.checks])).toEqual([
      ['r', '^/x', 'both'],
      ['s', '', 'message'],
    ])
    // Naming a script there drops the agent; naming nobody removes the entry.
    expect(withLegacyPatch(list, { interceptorScript: 'Sample g' })[0]).toMatchObject({
      id: 'r',
      agentId: '',
      script: 'Sample g',
    })
    expect(withLegacyPatch(list, { interceptorAgentId: '' })[0]).toMatchObject({
      id: 'r',
      agentId: '',
    })
    // A list with nothing switched on gets a new first entry.
    const added = withLegacyPatch([entry('off', { enabled: false })], {
      interceptorAgentId: 'reviewer',
    })
    expect(added.map((e) => e.agentId)).toEqual(['reviewer', ''])
    // Settings written before anyone is named are kept for when someone is.
    const pending = withLegacyPatch([], { interceptorPattern: '^/x' })
    expect(withLegacyPatch(pending, { interceptorAgentId: 'reviewer' })).toMatchObject([
      { agentId: 'reviewer', pattern: '^/x' },
    ])
    expect(chainFor(pending, 'message')).toEqual([])
  })

  it('makes a stored list well-formed and says when it had to correct it', () => {
    const clean = [entry('a'), newEntry({ id: 'b', agentId: 'reviewer', enabled: false })]
    expect(normaliseEntries(clean, 'self')).toEqual({ entries: clean, changed: false })
    const odd = normaliseEntries(
      [
        null,
        { id: 'a', agentId: 'self' },
        { id: 'b', agentId: 'reviewer', checks: 'sideways', contextDepth: -7 },
        { id: 'b', script: 'Sample s', agentId: 'reviewer' },
      ],
      'self'
    )
    expect(odd.changed).toBe(true)
    expect(odd.entries.map((e) => [e.agentId, e.script, e.checks, e.contextDepth])).toEqual([
      ['', '', 'message', 0],
      ['reviewer', '', 'message', 0],
      ['', 'Sample s', 'message', 0],
    ])
    expect(new Set(odd.entries.map((e) => e.id)).size).toBe(3)
    expect(normaliseEntries('nonsense').changed).toBe(true)
  })
})
