import { expect, it, vi } from 'vitest'
import { TokenEngines } from '@/sync/tokenEngines'

function fixture() {
  const makePort = () => ({
    includes: () => true,
    pinned: vi.fn(async () => false),
    inspect: vi.fn(async (path: string) => ({
      path,
      size: 4,
      version: 'v',
      pinned: false,
      blocked: null as string | null,
    })),
    evict: vi.fn(async () => ({ status: 'complete', reclaimedBytes: 4 })),
    setPinned: vi.fn(async () => ({ status: 'complete', reclaimedBytes: 0 })),
  })
  const broad = makePort(),
    narrow = makePort()
  const ports = new Map([
    ['broad', broad],
    ['narrow', narrow],
  ])
  const records = [
    { id: 'broad', scope: { path: '/' } },
    { id: 'narrow', scope: { path: 'Media' } },
  ]
  const saved = new Map<string, unknown>()
  const app = {
    loadLocalStorage: (key: string) => saved.get(key),
    saveLocalStorage: (key: string, value: unknown) => saved.set(key, value),
    workspace: { iterateAllLeaves: (_visit: (leaf: unknown) => void) => {} },
  }
  const activity = { value: {} }
  const host = Object.assign(Object.create(TokenEngines.prototype), {
    app,
    ui: { registry: { records: () => records }, activity },
    offloadPorts: ports,
  }) as TokenEngines
  return { host, broad, narrow, ports, app, activity }
}

it('uses the narrowest covering port and binds a confirmed preview to that runtime', async () => {
  const { host, broad, narrow, ports } = fixture()
  const actions = host.actions()
  const preview = await actions.preview(['Media/sample.bin'])
  ports.delete('narrow')
  narrow.evict.mockResolvedValueOnce({ status: 'offline', reclaimedBytes: 0 })
  expect((await actions.apply(preview))[0].status).toBe('offline')
  expect(narrow.evict).toHaveBeenCalledOnce()
  expect(broad.evict).not.toHaveBeenCalled()
})

it('keeps pins across covering connections above a selected connection rule', async () => {
  const { host, broad, narrow } = fixture()
  narrow.inspect.mockImplementation(async (path) => ({
    path,
    size: 4,
    version: 'v',
    pinned: true,
    blocked: null,
  }))
  narrow.pinned.mockResolvedValue(true)
  const preview = await host.actions('broad').preview(['Media/sample.bin'])
  expect(preview.files).toEqual([])
  expect(preview.skipped[0].status).toBe('pinned')
  await host.pin('Media/sample.bin', false)
  expect(broad.setPinned).toHaveBeenCalledWith('Media/sample.bin', false)
  expect(narrow.setPinned).toHaveBeenCalledWith('Media/sample.bin', false)
})

it('keeps nonactive editor paths and refused publications out of rule previews', async () => {
  const { host, app, activity } = fixture()
  app.workspace.iterateAllLeaves = (visit) =>
    visit({ view: { getState: () => ({ file: 'Media/sample.bin' }) } })
  expect((await host.actions().preview(['Media/sample.bin'])).skipped[0].status).toBe('busy')
  app.workspace.iterateAllLeaves = () => {}
  activity.value = { broad: { refused: [{ path: 'Media/sample.bin', reason: 'quota' }] } }
  expect((await host.actions().preview(['Media/sample.bin'])).skipped[0].status).toBe('refused')
})

it('retains the device pin when its original connection is no longer running', async () => {
  const { host, broad, ports } = fixture()
  await host.pin('Media/sample.bin', true)
  ports.clear()
  ports.set('broad', broad)
  expect((await host.actions().preview(['Media/sample.bin'])).skipped[0]?.status).toBe('pinned')
  expect((await host.evict('broad', 'Media/sample.bin')).status).toBe('pinned')
  await host.pin('Media/sample.bin', false)
  expect((await host.actions().preview(['Media/sample.bin'])).files).toHaveLength(1)
})
