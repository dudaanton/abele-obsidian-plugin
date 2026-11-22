import { expect, it, vi } from 'vitest'
import type { Vault } from 'obsidian'
import { observeVaultMutationEvents, primeVaultMutationEvents } from '@/sync/vaultMutationEvents'

it('attaches lifetime events once before exchanges subscribe and preserves both rename paths', () => {
  const handlers = new Map<string, (file: { path: string }, previous?: string) => void>()
  const on = vi.fn((name, callback) => {
    handlers.set(name, callback)
  })
  const vault = { on } as unknown as Vault
  primeVaultMutationEvents(vault)
  expect(on).toHaveBeenCalledTimes(4)
  const first = vi.fn(),
    second = vi.fn()
  const stop = observeVaultMutationEvents(vault, first)
  observeVaultMutationEvents(vault, second)
  primeVaultMutationEvents(vault)
  expect(on).toHaveBeenCalledTimes(4)
  handlers.get('rename')!({ path: 'new.md' }, 'old.md')
  expect(first).toHaveBeenCalledWith(['new.md', 'old.md'])
  expect(second).toHaveBeenCalledWith(['new.md', 'old.md'])
  stop()
  handlers.get('modify')!({ path: 'new.md' })
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenLastCalledWith(['new.md'])
})

it('retains every change event while no exchange is running', () => {
  const handlers = new Map<string, (file: { path: string }) => void>()
  const vault = {
    on: (name: string, callback: (file: { path: string }) => void) => {
      handlers.set(name, callback)
    },
  } as unknown as Vault
  primeVaultMutationEvents(vault)
  const changed = vi.fn()
  observeVaultMutationEvents(vault, changed)
  for (const name of ['create', 'modify', 'delete']) handlers.get(name)!({ path: 'sample.md' })
  expect(changed.mock.calls).toEqual([[['sample.md']], [['sample.md']], [['sample.md']]])
})

it('keeps one host subscription across module reloads', async () => {
  const on = vi.fn()
  const vault = { on } as unknown as Vault
  primeVaultMutationEvents(vault)
  vi.resetModules()
  const reloaded = await import('@/sync/vaultMutationEvents')
  reloaded.primeVaultMutationEvents(vault)
  expect(on).toHaveBeenCalledTimes(4)
})
