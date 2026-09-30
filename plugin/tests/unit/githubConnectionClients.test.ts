import { describe, expect, it } from 'vitest'
import { ConnectionClients } from '@/github/connectionClients'
import type { GithubConnection } from '@/github/connections'

const connection = (id: string): GithubConnection => ({
  id,
  name: id,
  server: '',
  keyId: `${id}-key`,
  owners: [],
  isDefault: true,
})

describe('connection credential generations', () => {
  it('keeps separate namespaces even if two connections hold the same token', () => {
    const rows = [connection('one'), connection('two')]
    const registry = new ConnectionClients(
      () => rows,
      () => 'invented-shared-token',
      () => 'off'
    )
    expect(registry.client('one').cacheNamespace).not.toBe(registry.client('two').cacheNamespace)
    expect(registry.client('one')).toBe(registry.client('one'))
  })

  it('retires on token replacement, server edits, deletion and store lock changes, but not display edits', () => {
    let rows = [connection('one')]
    let token = 'invented-one'
    let state = 'unlocked'
    const registry = new ConnectionClients(
      () => rows,
      () => token,
      () => state
    )
    const first = registry.client('one')
    rows[0].name = 'Renamed'
    expect(registry.client('one')).toBe(first)
    token = 'invented-two'
    const second = registry.client('one')
    expect(first.isCurrent).toBe(false)
    expect(second.cacheNamespace).not.toBe(first.cacheNamespace)
    state = 'locked'
    const locked = registry.client('one')
    expect(second.isCurrent).toBe(false)
    rows[0].server = 'http://git.example.test:8080'
    expect(registry.client('one').endpoints.api).toBe('http://git.example.test:8080/api/v3')
    expect(locked.isCurrent).toBe(false)
    rows = []
    expect(() => registry.client('one')).toThrow(/deleted|unknown/i)
  })
})
