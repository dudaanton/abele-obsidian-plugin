import { afterEach, expect, it, vi } from 'vitest'
import { Modal } from 'obsidian'
import { parseDeck } from '@/slides/core/markdown'
import { liveRenderer } from '@/slides/liveAdapter'
import { ScriptService } from '@/scripting/ScriptService'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { useVault } from '../helpers/testEnv'
import type { View } from '@/scripting/view/View'

vi.mock('@/scripting/runScript', () => ({
  findScriptByName: () => ({ path: 'Scripts/sample.js', meta: { name: 'Sample', params: [] } }),
  scriptParams: (_script: unknown, params: Record<string, unknown>) => params,
}))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  ScriptService.destroy()
})

it('shares one pending network decision for parallel blocks and audience renderers', async () => {
  const dialogs: Modal[] = []
  vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
    dialogs.push(this)
  })
  const storage = new Map<string, unknown>()
  const app = {
    loadLocalStorage: (key: string) => storage.get(key),
    saveLocalStorage: (key: string, value: unknown) => storage.set(key, value),
  }
  const markdown = { render: async () => () => {} }
  const first = liveRenderer(app as never, () => 'sample-deck.md', markdown)
  const audience = liveRenderer(app as never, () => 'sample-deck.md', markdown)
  const deck = parseDeck('---\nhtmlNetwork: true\n---\n# Sample')
  const a = first.allowNetwork!(deck)
  const b = first.allowNetwork!(deck)
  const c = audience.allowNetwork!(deck)
  expect(dialogs).toHaveLength(1)
  expect((dialogs[0] as unknown as { titleText: string }).titleText).toBe('Allow network access?')
  dialogs[0].close()
  expect(await Promise.all([a, b, c])).toEqual([false, false, false])
  expect(await audience.allowNetwork!(deck)).toBe(false)
  expect(dialogs).toHaveLength(1)
})

it('disposes every view at cancellation even before it opens', async () => {
  useVault([])
  vi.useFakeTimers()
  const service = ScriptService.getInstance()
  vi.spyOn(service, 'ready', 'get').mockReturnValue(Promise.resolve())
  const tick = vi.fn()
  const created: View[] = []
  let finish: () => void = () => {}
  vi.spyOn(service, 'execute').mockImplementation(async (_path, _params, options) => {
    const opts = options as Exclude<typeof options, AbortSignal | undefined>
    const ctx = buildScriptContext({
      params: {},
      logs: [],
      signal: opts.signal!,
      viewHost: opts.viewHost,
    })
    for (let i = 0; i < 2; i++) {
      const view = ctx.view({ title: 'Sample delayed view' })
      view.every(100, tick)
      created.push(view)
    }
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    return ''
  })
  const controller = new AbortController()
  const renderer = liveRenderer({} as never, () => 'sample-deck.md', {
    render: async () => () => {},
  })
  const running = renderer.script!(
    { type: 'script', name: 'Sample', params: {}, refresh: 'enter' },
    document.createElement('div'),
    controller.signal
  )
  const outcome = running.catch(() => {})
  await vi.advanceTimersByTimeAsync(200)
  expect(tick).toHaveBeenCalled()
  controller.abort()
  expect(created.map((view) => view.signal.aborted)).toEqual([true, true])
  const before = tick.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000)
  expect(tick).toHaveBeenCalledTimes(before)
  expect(vi.getTimerCount()).toBe(0)
  finish()
  await outcome
})
