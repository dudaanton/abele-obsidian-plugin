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
import { TurnPolicy } from '@/ai/interceptor/turnPolicy'
import { mcpToolBindings, mcpPermissionKey } from '@/ai/mcp/permissions'
import { createMcpServer } from '@/ai/mcp/types'

const call = (name: string, outOfScope = false) => ({ name, args: { path: 'a.md' }, outOfScope })

afterEach(() => vi.useRealTimers())

describe('MCP policy identities', () => {
  const original = createMcpServer({
    id: 'original',
    name: 'Archive',
    url: 'https://sample.example/mcp',
    tools: [{ name: 'echo', description: '', inputSchema: {} }],
  })
  const bindings = mcpToolBindings([original])
  const destinationKey = bindings[0].destinationKey
  const identityCall = (id: string, name = 'mcp_archive_echo', endpoint = destinationKey) => ({
    ...call(name),
    permissionKey: mcpPermissionKey(id, 'echo'),
    destinationKey: endpoint,
  })
  const policy = () =>
    toolPolicy({ approve: ['mcp_archive_echo'], deny: [] }, 'Guard', undefined, bindings)

  it('does not approve a replacement server that takes over an approved alias', async () => {
    const frozen = policy()
    expect(await frozen.decide(identityCall('original'))).toEqual({ kind: 'approve' })
    expect(await frozen.decide(identityCall('replacement'))).toEqual({ kind: 'ask' })
  })

  it('keeps approval with the pinned original tool after its alias changes', async () => {
    expect(await policy().decide(identityCall('original', 'mcp_renamed_echo'))).toEqual({
      kind: 'approve',
    })
  })

  it('does not approve the original server at a changed destination', async () => {
    expect(
      await policy().decide(
        identityCall(
          'original',
          'mcp_archive_echo',
          JSON.stringify(['http', 'https://replacement.example/mcp'])
        )
      )
    ).toEqual({ kind: 'ask' })
  })

  it('also binds denied aliases to their original identity', async () => {
    const denied = toolPolicy(
      { approve: [], deny: ['mcp_archive_echo'] },
      'Guard',
      undefined,
      bindings
    )
    expect((await denied.decide(identityCall('original', 'mcp_renamed_echo'))).kind).toBe('deny')
    expect(await denied.decide(identityCall('replacement'))).toEqual({ kind: 'ask' })
    expect(
      (
        await denied.decide(
          identityCall(
            'original',
            'mcp_archive_echo',
            JSON.stringify(['http', 'https://replacement.example/mcp'])
          )
        )
      ).kind
    ).toBe('deny')
  })

  it('does not lose an unresolved MCP denial beneath a blanket approval', async () => {
    const denied = toolPolicy(
      { approve: true, deny: ['mcp_missing_echo'] },
      'Guard',
      undefined,
      bindings
    )
    expect((await denied.decide(identityCall('replacement', 'mcp_missing_echo'))).kind).toBe('deny')
  })

  it('gives decision functions the pinned identity along with copied arguments', async () => {
    const decide = vi.fn(
      (c) =>
        c.permissionKey === mcpPermissionKey('original', 'echo') &&
        c.destinationKey === destinationKey
    )
    const functional = toolPolicy({ approve: decide, deny: [] }, 'Guard')
    expect(await functional.decide(identityCall('original'))).toEqual({ kind: 'approve' })
    expect(decide).toHaveBeenCalledWith(identityCall('original'))
  })

  it('does not reuse a memoized approval for a different identity with the same call id', async () => {
    const turn = new TurnPolicy()
    turn.set(policy())
    expect(
      await turn.decide(
        'shared',
        'mcp_archive_echo',
        {},
        false,
        mcpPermissionKey('original', 'echo'),
        destinationKey
      )
    ).toEqual({ kind: 'approve' })
    expect(
      await turn.isApproved('shared', mcpPermissionKey('replacement', 'echo'), destinationKey)
    ).toBe(false)
    expect(
      await turn.decide(
        'shared',
        'mcp_archive_echo',
        {},
        false,
        mcpPermissionKey('replacement', 'echo'),
        destinationKey
      )
    ).toEqual({ kind: 'ask' })
  })
})

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
