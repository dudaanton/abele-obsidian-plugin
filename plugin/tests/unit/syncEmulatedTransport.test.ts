import { expect, it, vi } from 'vitest'
import { reloadAs } from '../e2e/helpers/phoneWindow'
import { tokenUiFixture } from '@/testing/tokenUiFixture'

vi.mock('../e2e/helpers/syncVault', () => ({ waitFor: vi.fn() }))
vi.mock('../e2e/helpers/syncServer', () => ({ delay: vi.fn() }))

it('routes UI metadata and engine requests through the native host after mobile emulation reload', async () => {
  let injected = ''
  await reloadAs(
    {
      evalRaw: () => '1',
      evalAwait: (code: string) => {
        injected = code
      },
    } as never,
    true
  )
  const ui = tokenUiFixture()
  const unavailable = vi.fn().mockRejectedValue(new Error('No native mobile bridge in emulation'))
  Object.assign(ui, { transport: unavailable })
  Object.assign(ui.itemSets, { transport: unavailable })
  const transport = vi
    .fn()
    .mockImplementation(async () => new Response(JSON.stringify({ items: [] })))
  const host = {
    ui,
    deps: { fetch: unavailable },
    engines: { settled: vi.fn(), reset: vi.fn() },
    start: vi.fn(),
  }
  await new Function('app', 'window', 'require', `return ${injected}`)(
    { plugins: { plugins: { abele: { tokenEngines: host } } } },
    { __abeleTest: { desktopTransport: () => transport } },
    () => ({ getCurrentWebContents: () => ({ session: {} }), Buffer: {} })
  )
  await ui.client(ui.rows.value[0].id).tokens()
  await host.deps.fetch('https://sync.example/v2/changes')
  expect(transport).toHaveBeenCalledTimes(2)
  expect(unavailable).not.toHaveBeenCalled()
})
