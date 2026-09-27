/**
 * A note's header listens to the metadata cache for its note, and stops listening when it is
 * cleaned up. The store keeps headers in a reactive list, so the header's methods run on Vue's
 * proxy of it, and the listener handles it kept came back out of that proxy as proxies too —
 * which Obsidian's `offref` does not recognise. Every header ever drawn stayed subscribed, and
 * through its listener kept the plugin it came from alive after the plugin was reloaded
 * (2026-09-27, found in a heap snapshot).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { reactive } from 'vue'
import { Header } from '@/entities/Header'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { AbeleConfig } from '@/services/AbeleConfig'
import { buildFakeTaskVault, type FakeTaskVault } from '../helpers/fakeTaskVault'

const NOTE = 'Notes/Plain.md'

let vault: FakeTaskVault
/** Obsidian's listener lists: a handle is taken off only when it is the very object handed out. */
let listeners: Record<string, object[]>

beforeEach(() => {
  vault = buildFakeTaskVault({ [NOTE]: 'Just a note\n' })
  AbeleConfig.getInstance().journals = []
  listeners = {}
  const events = {
    on(name: string, fn: unknown) {
      const ref = { name, fn }
      ;(listeners[name] ??= []).push(ref)
      return ref
    },
    offref(ref: { name: string }) {
      listeners[ref.name] = (listeners[ref.name] ?? []).filter((r) => r !== ref)
    },
  }
  Object.assign(vault.app.metadataCache, events)
  vault.app.vault.on = () => ({})
  vault.app.vault.offref = () => {}
  VaultWatcherWrapper.destroy()
})

afterEach(() => {
  VaultWatcherWrapper.destroy()
})

describe("a note header's metadata listeners", () => {
  it('are all taken off when a header held in the reactive store is cleaned up', async () => {
    const header = reactive(new Header({ id: 'h', filePath: NOTE })) as unknown as Header
    await header.load()
    expect((listeners.changed ?? []).length + (listeners.resolved ?? []).length).toBeGreaterThan(0)

    header.cleanup()

    expect(listeners.changed ?? []).toEqual([])
    expect(listeners.resolved ?? []).toEqual([])
  })
})
