/**
 * An interceptor script answering for the person on the tool calls of one turn.
 *
 * It only ever stands in for the question the person would have been asked: a call that runs
 * without asking is not its business, and a call it has no answer for is asked as usual. A
 * blanket yes never reaches outside the chat's scope — only a function, which is shown that a
 * call reaches out, can say yes to that.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { toolPolicy, POLICY_DECISION_MS } from '@/ai/interceptor/policy'

const call = (name: string, outOfScope = false) => ({ name, args: { path: 'a.md' }, outOfScope })

afterEach(() => vi.useRealTimers())

describe('a tool policy', () => {
  it('approves every call with true, but not one outside the scope', async () => {
    const policy = toolPolicy({ approve: true, deny: [] }, 'Guard')
    expect(await policy.decide(call('edit'))).toEqual({ kind: 'approve' })
    expect(await policy.decide(call('edit', true))).toEqual({ kind: 'ask' })
  })

  it('approves the tools it names and asks about the rest', async () => {
    const policy = toolPolicy({ approve: ['edit', 'write'], deny: [] }, 'Guard')
    expect(await policy.decide(call('write'))).toEqual({ kind: 'approve' })
    expect(await policy.decide(call('rm'))).toEqual({ kind: 'ask' })
    expect(await policy.decide(call('write', true))).toEqual({ kind: 'ask' })
  })

  it('refuses what it denies, with its own name in the reason, before anything it approves', async () => {
    const policy = toolPolicy({ approve: true, deny: ['rm'] }, 'Guard')
    const out = await policy.decide(call('rm'))
    expect(out.kind).toBe('deny')
    if (out.kind === 'deny') expect(out.reason).toContain('Guard')
  })

  it('lets a function decide, outside the scope too, and hands it a copy of the arguments', async () => {
    const seen: unknown[] = []
    const policy = toolPolicy(
      {
        approve: (c: { name: string; args: Record<string, unknown>; outOfScope: boolean }) => {
          seen.push(c)
          ;(c.args as Record<string, unknown>).path = 'changed.md'
          if (c.name === 'edit') return true
          if (c.name === 'rm') return false
          return undefined
        },
        deny: [],
      },
      'Guard'
    )
    const original = call('edit', true)
    expect(await policy.decide(original)).toEqual({ kind: 'approve' })
    expect(original.args.path).toBe('a.md')
    expect((await policy.decide(call('rm'))).kind).toBe('deny')
    expect(await policy.decide(call('ls'))).toEqual({ kind: 'ask' })
    expect(seen).toHaveLength(3)
  })

  it('asks when the function throws or answers something else', async () => {
    const throws = toolPolicy(
      {
        approve: () => {
          throw new Error('boom')
        },
        deny: [],
      },
      'Guard'
    )
    expect(await throws.decide(call('edit'))).toEqual({ kind: 'ask' })
    const odd = toolPolicy({ approve: () => 'yes', deny: [] }, 'Guard')
    expect(await odd.decide(call('edit'))).toEqual({ kind: 'ask' })
  })

  it('asks when the function takes too long', async () => {
    vi.useFakeTimers()
    const slow = toolPolicy({ approve: () => new Promise(() => {}), deny: [] }, 'Guard')
    const pending = slow.decide(call('edit'))
    await vi.advanceTimersByTimeAsync(POLICY_DECISION_MS + 1)
    expect(await pending).toEqual({ kind: 'ask' })
  })

  it('waits for an async answer that comes in time', async () => {
    const policy = toolPolicy({ approve: async () => true, deny: [] }, 'Guard')
    expect(await policy.decide(call('edit'))).toEqual({ kind: 'approve' })
  })
})
