import { expect, it, vi } from 'vitest'
import { DeviceScopeLease, type ScopeLeasePorts } from '@/sync/deviceScopeLease'

function fixture() {
  const values = new Map<string, unknown>()
  const events: string[] = []
  const tokens: { id: string; label: string }[] = []
  const ports: ScopeLeasePorts = {
    stop: async () => {
      events.push('stop')
    },
    resolve: async (items) => {
      events.push('resolve')
      return items
    },
    tokens: async () => tokens,
    issue: async (items, label) => {
      events.push('issue:' + items.map((item) => item.kind).join(','))
      const id = 'owned-' + tokens.length
      tokens.push({ id, label })
      return { id, token: 'sample-token-' + id }
    },
    retain: async (token) => {
      events.push('retain')
      return token
    },
    load: (reference) => reference,
    drop: async () => {
      events.push('drop')
    },
    install: async () => {
      events.push('install')
      return ['record-a']
    },
    activate: async () => {
      events.push('activate')
    },
    forget: async () => {
      events.push('forget')
    },
    revoke: async (id) => {
      events.push('revoke:' + id)
      tokens.splice(
        tokens.findIndex((token) => token.id === id),
        1
      )
    },
  }
  const local = {
    loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
    },
  }
  return { ports, local, events, tokens, lease: new DeviceScopeLease(local, ports) }
}

const selection = [{ kind: 'group' as const, id: 'group-a', path: 'Reading.md' }]

it('drains before issuing and retains the scoped key before enrolling and activating it', async () => {
  const f = fixture()
  await f.lease.change(selection)
  expect(f.events).toEqual(['stop', 'resolve', 'issue:group', 'retain', 'install', 'activate'])
  expect(f.lease.snapshot()?.current?.id).toBe('owned-0')
})

it('recovers an uncertain issuance by revoking only its durable unique label before retry', async () => {
  const f = fixture()
  const issue = f.ports.issue
  f.ports.issue = vi.fn(async (...args) => {
    await issue(...args)
    throw new Error('response lost')
  })
  await expect(f.lease.change(selection)).rejects.toThrow('response lost')
  f.tokens.push({ id: 'source', label: 'Original access' })
  f.ports.issue = issue
  await new DeviceScopeLease(f.local, f.ports).change(selection)
  expect(f.events).toContain('revoke:owned-0')
  expect(f.events).not.toContain('revoke:source')
  expect(f.tokens.some((token) => token.id === 'source')).toBe(true)
})

it('does not activate a widened choice while old owned-token revocation is uncertain', async () => {
  const f = fixture()
  await f.lease.change(selection)
  f.events.length = 0
  f.ports.revoke = vi.fn(async () => {
    throw new Error('offline')
  })
  await expect(
    f.lease.change([{ kind: 'folder', id: 'folder-a', path: 'Garden' }])
  ).rejects.toThrow('offline')
  expect(f.events).not.toContain('activate')
  expect(f.lease.snapshot()?.cleanup).toHaveLength(1)
})

it('revokes its owned key and forgets engine records without deleting any files on removal', async () => {
  const f = fixture()
  await f.lease.change(selection)
  f.events.length = 0
  await f.lease.remove()
  expect(f.events).toEqual(['stop', 'revoke:owned-0', 'forget', 'drop'])
  expect(f.lease.snapshot()).toBeNull()
})

it.each(['resolve', 'issue', 'install'] as const)(
  'keeps cancellation during %s inactive and recoverable',
  async (phase) => {
    const f = fixture()
    const controller = new AbortController()
    const original = f.ports[phase]
    Object.assign(f.ports, {
      [phase]: async (...args: unknown[]) => {
        const result = await Reflect.apply(original, f.ports, args)
        controller.abort()
        return result
      },
    })
    await expect(
      f.lease.change([{ kind: 'group', id: 'group-a', path: 'Reading.md' }], controller.signal)
    ).rejects.toThrow()
    expect(f.events).not.toContain('activate')
    await new DeviceScopeLease(f.local, f.ports).remove()
    expect(f.tokens).toHaveLength(0)
  }
)

it('reuses a retained issued key after an interrupted enrollment instead of issuing again', async () => {
  const f = fixture()
  const install = f.ports.install
  f.ports.install = vi.fn(async () => {
    throw new Error('storage unavailable')
  })
  const items = [{ kind: 'file' as const, id: 'file-a', path: 'Sample.md' }]
  await expect(f.lease.change(items)).rejects.toThrow('storage unavailable')
  f.ports.install = install
  await new DeviceScopeLease(f.local, f.ports).change(items)
  expect(f.events.filter((event) => event.startsWith('issue:'))).toHaveLength(1)
  expect(f.lease.snapshot()?.current?.records).toEqual(['record-a'])
})
