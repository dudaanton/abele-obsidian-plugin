import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'

/**
 * `runAfterSync` waits for two services, not one.
 *
 * Obsidian Sync is asked first, exactly as this helper always asked it, and Abele Sync after
 * it. The service itself is mocked here: what is under test is the waiting, and standing a
 * whole engine up to report a status would test the engine instead.
 */

const abele = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    settled: true,
    listeners,
    isFullySynced: () => abele.settled,
    onStatusChange: (cb: () => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    /** Moves the service into a state and tells everyone listening, as the real one does. */
    move(settled: boolean) {
      abele.settled = settled
      for (const cb of [...listeners]) cb()
    },
    reset() {
      abele.settled = true
      listeners.clear()
    },
  }
})

vi.mock('@/sync/SyncService', () => ({ SyncService: { getInstance: () => abele } }))

import { runAfterSync } from '@/helpers/runAfterSync'

/** Obsidian Sync as the helper reaches for it: absent, settled, or still going. */
function appWith(sync: unknown): App {
  return { internalPlugins: { plugins: { sync: { instance: sync } } } } as unknown as App
}

function obsidianSync(status: string) {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  return {
    syncStatus: status,
    on(event: string, cb: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), cb])
    },
    off(event: string, cb: (...args: unknown[]) => void) {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((held) => held !== cb)
      )
    },
    listeners: (event: string) => handlers.get(event) ?? [],
    /** What the real one does: sets the status and fires the event. */
    become(status: string) {
      this.syncStatus = status
      for (const cb of [...(handlers.get('status-change') ?? [])]) cb()
    },
  }
}

beforeEach(() => {
  abele.reset()
})

describe('runAfterSync — Obsidian Sync', () => {
  it('runs straight away when no sync plugin is installed', () => {
    const ran = vi.fn()
    runAfterSync(appWith(undefined), ran)
    expect(ran).toHaveBeenCalledOnce()
  })

  it('runs straight away when the vault is already fully synced', () => {
    const ran = vi.fn()
    runAfterSync(appWith(obsidianSync('Fully synced')), ran)
    expect(ran).toHaveBeenCalledOnce()
  })

  it('waits for the status to reach fully synced, then unregisters', () => {
    const ran = vi.fn()
    const sync = obsidianSync('Uploading')
    runAfterSync(appWith(sync), ran)
    expect(ran).not.toHaveBeenCalled()

    sync.become('Downloading')
    expect(ran).not.toHaveBeenCalled()

    sync.become('Fully synced')
    expect(ran).toHaveBeenCalledOnce()
    expect(sync.listeners('status-change')).toHaveLength(0)
  })
})

describe('runAfterSync — Abele Sync', () => {
  it('waits for a sync in flight and runs when it is through', () => {
    abele.settled = false
    const ran = vi.fn()
    runAfterSync(appWith(undefined), ran)
    expect(ran).not.toHaveBeenCalled()

    abele.move(true)
    expect(ran).toHaveBeenCalledOnce()
    expect(abele.listeners.size).toBe(0)
  })

  it('runs once, however many status changes follow', () => {
    abele.settled = false
    const ran = vi.fn()
    runAfterSync(appWith(undefined), ran)

    abele.move(true)
    abele.move(false)
    abele.move(true)
    expect(ran).toHaveBeenCalledOnce()
  })

  it('does not wait on a device that is not going to settle', () => {
    // Offline, paused and in error all report the same thing: nothing is in flight. Waiting
    // for those to become `idle` would hold the callback until the network came back.
    const ran = vi.fn()
    runAfterSync(appWith(undefined), ran)
    expect(ran).toHaveBeenCalledOnce()
  })

  it('waits for Obsidian Sync first and Abele Sync after it', () => {
    abele.settled = false
    const ran = vi.fn()
    const sync = obsidianSync('Uploading')
    runAfterSync(appWith(sync), ran)

    // Nothing is listening to Abele Sync yet: the first wait has not finished.
    expect(abele.listeners.size).toBe(0)

    sync.become('Fully synced')
    expect(ran).not.toHaveBeenCalled()
    expect(abele.listeners.size).toBe(1)

    abele.move(true)
    expect(ran).toHaveBeenCalledOnce()
  })
})
