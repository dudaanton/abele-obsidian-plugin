import { afterEach, expect, it, vi } from 'vitest'
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
