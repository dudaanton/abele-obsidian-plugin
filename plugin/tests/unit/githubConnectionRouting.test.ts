import { describe, expect, it } from 'vitest'
import { routeConnections, ConnectionMemory } from '@/github/connectionRouting'
import type { GithubConnection } from '@/github/connections'
const row = (
  id: string,
  server = '',
  owners: string[] = [],
  isDefault = false
): GithubConnection => ({ id, name: id, server, keyId: `${id}-key`, owners, isDefault })
const rows = [
  row('default', '', [], true),
  row('owner', '', ['sample-*']),
  row('repo', '', ['sample-org/project']),
  row('enterprise', 'https://git.example.test', [], true),
]
const target = { host: 'github.com', owner: 'sample-org', repo: 'project' }
const pick = (options = {}) => routeConnections(rows, { ...target, ...options })

describe('connection routing precedence', () => {
  it('takes the same-server source tab before another open tab and owner rules', () => {
    expect(pick({ sourceId: 'owner', openId: 'default' })[0].id).toBe('owner')
    expect(pick({ sourceId: 'enterprise', openId: 'owner' })[0].id).toBe('owner')
  })
  it('takes exact repo above owner above owner glob, keeping settings order for ties', () => {
    expect(pick()[0].id).toBe('repo')
    expect(pick({ repo: 'other' })[0].id).toBe('owner')
    expect(
      routeConnections([...rows, row('exact', '', ['sample-org'])], { ...target, repo: 'other' })[0]
        .id
    ).toBe('exact')
  })
  it('remembers successful routing before the default, but not before owner rules', () => {
    expect(pick({ owner: 'other', rememberedId: 'owner' })[0].id).toBe('owner')
    expect(pick({ rememberedId: 'default' })[0].id).toBe('repo')
    expect(pick({ owner: 'other' })[0].id).toBe('default')
  })
  it('never mixes servers, and anonymous public reading exists only without public connections', () => {
    expect(pick().map((c) => c.id)).not.toContain('enterprise')
    expect(routeConnections([], target)).toEqual([{ id: '', reason: 'anonymous' }])
    expect(routeConnections([], { ...target, host: 'unknown.example.test' })).toEqual([])
    expect(routeConnections(rows, { ...target, allowed: () => false })).toEqual([])
  })
  it('uses explicit choices alone and rejects a different-server choice', () => {
    expect(pick({ explicitId: 'default' })).toEqual([{ id: 'default', reason: 'explicit' }])
    expect(() => pick({ explicitId: 'enterprise' })).toThrow(/server/i)
    expect(() => pick({ explicitId: 'deleted' })).toThrow(/unknown|deleted/i)
  })
  it('distinguishes Enterprise ports and schemes', () => {
    const ports = [
      row('one', 'http://git.example.test:8080', [], true),
      row('two', 'https://git.example.test:8443', [], true),
    ]
    expect(
      routeConnections(ports, {
        ...target,
        host: 'git.example.test',
        origin: 'http://git.example.test:8080',
      }).map((c) => c.id)
    ).toEqual(['one'])
    expect(routeConnections(ports, { ...target, host: 'git.example.test' })).toEqual([])
  })
})

describe('session routing memory', () => {
  it('expires refusals after ten minutes, scopes them to item and credential generation, and keeps session successes', () => {
    let now = 0
    const memory = new ConnectionMemory(() => now)
    memory.refused('one', 'generation-a', 'issue-1')
    expect(memory.wasRefused('one', 'generation-a', 'issue-1')).toBe(true)
    expect(memory.wasRefused('one', 'generation-b', 'issue-1')).toBe(false)
    expect(memory.wasRefused('one', 'generation-a', 'issue-2')).toBe(false)
    memory.succeeded('https://github.com/sample/project', 'one', 'generation-a')
    now = 600001
    expect(memory.wasRefused('one', 'generation-a', 'issue-1')).toBe(false)
    expect(
      memory.success('https://github.com/sample/project', (id) =>
        id === 'one' ? 'generation-a' : ''
      )
    ).toBe('one')
    expect(
      memory.success('https://github.com/sample/project', () => 'generation-b')
    ).toBeUndefined()
  })
})
