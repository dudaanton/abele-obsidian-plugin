import { expect } from 'vitest'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
const fixture = liveSuite()
liveCase(
  'personalBaseline',
  'native token exchange replays a committed response lost before local settlement',
  [96, 103],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      path = s.root + '/response.md'
    const id = await s.connect()
    await s.connect(b)
    await a.pause(id, true)
    a.run(
      `window.__abeleLostResponse=false;const client=svc.runtimes.get(${JSON.stringify(id)}).historyClient;const commit=client.commitRaw.bind(client);let once=true;client.commitRaw=async(...args)=>{const result=await commit(...args);if(once){once=false;window.__abeleLostResponse=true;throw new Error('Sample lost response')}return result};return true`
    )
    a.create(path, 'committed once')
    await a.pause(id, false)
    // Resume can start the watcher before Sync now. Either run may observe the lost response.
    try {
      await a.syncNow(id)
    } catch {
      /* Recovery is checked after reopening the real host. */
    }
    expect(
      a.run(
        `await poll(()=>window.__abeleLostResponse);delete window.__abeleLostResponse;return true`
      )
    ).toBe(true)
    a.run(
      `await app.plugins.disablePlugin('abele');await app.plugins.enablePlugin('abele');return true`
    )
    await a.waitIdle(id)
    await s.cycle()
    expect(b.read(path)).toBe('committed once')
    const file = (await s.items()).find((one) => one.path === path)!
    expect(await s.client().versions(file.file_id)).toHaveLength(1)
    const before = file.version_id
    await s.cycle()
    expect((await s.items()).find((one) => one.path === path)?.version_id).toBe(before)
  },
  fixture
)
liveCase(
  'personalBaseline',
  'unavailable sole source never turns an offloaded record into delivered bytes',
  [113],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = s.root + '/unavailable.bin',
      id = await s.connect()
    a.create(path, 'real bytes retained on server')
    await a.syncNow()
    await a.long(
      'evict stored bytes',
      `await host.evict(${JSON.stringify(id)},${JSON.stringify(path)});return true`
    )
    expect(a.exists(path)).toBe(false)
    await s.server.kill()
    await expect(
      a.long(
        'hydrate unavailable source',
        `await host.hydrate(${JSON.stringify(path)});return true`
      )
    ).rejects.toThrow()
    expect(a.exists(path)).toBe(false)
    expect(a.rows().map((one) => one.id)).toContain(id)
  },
  fixture
)
liveCase(
  'personalBaseline',
  'offloaded bytes hydrate through another live connection and preserve a new edit',
  [111, 114],
  async () => {
    const s = fixture(),
      a = s.primary,
      second = await s.addServer(),
      path = s.root + '/sample.bin',
      id = await s.connect()
    const other = await s.connect(a, second.rootToken)
    a.create(path, 'real attachment bytes')
    await a.syncNow()
    await a.syncNow()
    await a.long(
      'evict through the host',
      `await host.evict(${JSON.stringify(other)},${JSON.stringify(path)});return true`
    )
    expect(a.exists(path)).toBe(false)
    await second.kill()
    await a.long(
      'hydrate through a live source',
      `await host.hydrate(${JSON.stringify(path)});return true`
    )
    expect(a.read(path)).toBe('real attachment bytes')
    a.create(path, 'new local attachment edit')
    await a.syncNow(id)
    expect(a.read(path)).toBe('new local attachment edit')
    const file = (await s.items()).find((one) => one.path === path)!
    expect(
      new TextDecoder().decode(await s.client().versionBytes(file.file_id, file.version_id))
    ).toBe('new local attachment edit')
  },
  fixture
)
