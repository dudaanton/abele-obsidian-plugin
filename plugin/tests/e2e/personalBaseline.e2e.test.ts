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
    const refusal = await a.long(
      'open unavailable external file',
      `try{await svc.openFile(${JSON.stringify(path)});return 'unexpected success'}catch(error){return String(error.message)}`
    )
    expect(String(refusal)).toMatch(/unavailable|offline|recovery/i)
    expect(
      a.run(
        `return [...document.querySelectorAll('.notice')].some(one=>one.textContent.includes('Cannot get this file yet: '+${JSON.stringify(path)}))`
      )
    ).toBe(true)
  },
  fixture
)
liveCase(
  'personalBaseline',
  'offloaded content forwards through a newly permitted connection as real bytes',
  [112],
  async () => {
    const s = fixture(),
      a = s.primary,
      target = await s.addServer(),
      path = s.root + '/forward.bin',
      source = await s.connect()
    a.create(path, 'real forwarded binary bytes')
    await a.syncNow(source)
    expect(
      await a.long(
        'offload source',
        `return await host.evict(${JSON.stringify(source)},${JSON.stringify(path)})`
      )
    ).toMatchObject({ status: 'complete' })
    expect(a.exists(path)).toBe(false)
    const recipient = await s.connect(a, target.rootToken)
    await a.syncNow(recipient)
    const remote = (await s.items(target)).find((one) => one.path === path)!
    expect(remote).toBeDefined()
    expect(
      new TextDecoder().decode(
        await s.client(target).versionBytes(remote.file_id, remote.version_id)
      )
    ).toBe('real forwarded binary bytes')
    expect((await s.items(target)).some((one) => one.path.endsWith('.abele-ref'))).toBe(false)
  },
  fixture
)
liveCase(
  'personalBaseline',
  'offload cannot remove the only reachable copy still owed to another server',
  [115],
  async () => {
    const s = fixture(),
      a = s.primary,
      target = await s.addServer(),
      source = await s.connect(),
      other = await s.connect(a, target.rootToken),
      path = s.root + '/owed.bin'
    await a.pause(other, true)
    a.create(path, 'only reachable pending bytes')
    await a.syncNow(source)
    expect((await s.items(target)).some((one) => one.path === path)).toBe(false)
    s.server.suspend()
    try {
      const refused = await a.long(
        'offload unreachable retained source',
        `try{return await host.evict(${JSON.stringify(source)},${JSON.stringify(path)})}catch(error){return {status:'refused',reason:String(error.message)}}`
      )
      expect(refused).not.toMatchObject({ status: 'complete' })
      expect(refused).toMatchObject({ status: 'offline' })
      expect(a.read(path)).toBe('only reachable pending bytes')
      expect(
        a.run(
          `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(source)}),'settings');await poll(()=>inWindows('.abele-sync-window'));return [...inWindows('.abele-sync-window').querySelectorAll('[role=alert]')].some(one=>/reachable|answer|unavailable|interrupted/i.test(textOf(one)))`
        )
      ).toBe(true)
      await a.pause(other, false)
      await a.syncNow(other)
      const remote = (await s.items(target)).find((one) => one.path === path)!
      expect(
        new TextDecoder().decode(
          await s.client(target).versionBytes(remote.file_id, remote.version_id)
        )
      ).toBe('only reachable pending bytes')
    } finally {
      s.server.resume()
    }
  },
  fixture
)
liveCase(
  'personalBaseline',
  'simultaneous hydration edit and transfer preserve the newest local bytes',
  [116],
  async () => {
    const s = fixture(),
      a = s.primary,
      target = await s.addServer(),
      source = await s.connect(),
      other = await s.connect(a, target.rootToken),
      path = s.root + '/race.bin'
    a.create(path, 'old retained version')
    await a.syncNow()
    expect(
      await a.long(
        'offload race source',
        `return await host.evict(${JSON.stringify(source)},${JSON.stringify(path)})`
      )
    ).toMatchObject({ status: 'complete' })
    await a.pause(source, true)
    await a.pause(other, true)
    const outcome = await a.long<{ bytes: string; hydrated: boolean }>(
      'race opening with an edit and transfer',
      `
      const gate=window.__abeleTest.holdTokenDownload(${JSON.stringify(source)})
      try{
        const opened=host.hydrate(${JSON.stringify(path)}).then(()=>true,()=>false)
        await gate.ready
        await app.vault.create(${JSON.stringify(path)},'newest local edit')
        await svc.pause(${JSON.stringify(other)},false)
        const transfer=svc.runtimes.get(${JSON.stringify(other)}).sync().catch(()=>{})
        gate.release()
        const hydrated=await opened
        await transfer
        return {hydrated,bytes:await app.vault.adapter.read(${JSON.stringify(path)})}
      }finally{gate.close()}
    `
    )
    expect(outcome.bytes).toBe('newest local edit')
    await a.syncNow(other)
    const remote = (await s.items(target)).find((one) => one.path === path)!
    expect(
      new TextDecoder().decode(
        await s.client(target).versionBytes(remote.file_id, remote.version_id)
      )
    ).toBe('newest local edit')
    expect(a.read(path)).toBe('newest local edit')
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
