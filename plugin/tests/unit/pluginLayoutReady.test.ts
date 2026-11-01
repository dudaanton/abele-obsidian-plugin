import { expect, it, vi } from 'vitest'
import type { Plugin } from 'obsidian'
import { onPluginLayoutReady } from '@/helpers/pluginLayoutReady'

function host(ready = false) {
  const callbacks: Array<() => void> = []
  const disposals: Array<() => void> = []
  const plugin = {
    register: (dispose: () => void) => disposals.push(dispose),
    app: { workspace: { onLayoutReady: (fn: () => void) => (ready ? fn() : callbacks.push(fn)) } },
  } as unknown as Plugin
  return {
    plugin,
    ready: () => callbacks.forEach((fn) => fn()),
    unload: () => disposals.forEach((fn) => fn()),
  }
}

it('drops queued work on unload even when the host delivers it afterwards', () => {
  const h = host(),
    run = vi.fn()
  onPluginLayoutReady(h.plugin, run)
  h.unload()
  h.ready()
  expect(run).not.toHaveBeenCalled()
})

it('runs live work once and permits a fresh registration after reload', () => {
  const first = host(),
    run = vi.fn()
  onPluginLayoutReady(first.plugin, run)
  first.ready()
  first.unload()
  first.ready()
  const next = host()
  onPluginLayoutReady(next.plugin, run)
  next.ready()
  expect(run).toHaveBeenCalledTimes(2)
})

it('runs immediately when the layout was already ready', () => {
  const h = host(true),
    run = vi.fn()
  onPluginLayoutReady(h.plugin, run)
  expect(run).toHaveBeenCalledOnce()
  h.unload()
  expect(run).toHaveBeenCalledOnce()
})
