import { afterEach, expect, it } from 'vitest'
import { AccessClient } from '@abele/sync-sdk/core'
import { randomUUID } from 'node:crypto'
import { sha256, V2EngineClient } from '@abele/sync-sdk/core'
import { join } from 'node:path'
import { liveSuite } from './helpers/syncLiveCases'
import { captureSyncScreen, closeSyncScreens } from './helpers/syncScreens'
import { fixtureFetch } from './helpers/syncServer'
import { driver, screenshot } from './helpers/phone'
import { shotDir } from './helpers/shots'
import { onPhone, targets } from './helpers/target'
import type { SyncDriver } from './helpers/syncDriver'
import { V2Client } from '../../src/sync/v2/client'
import { issueDeletionDevice, deletionFolder } from '../helpers/serverDeleteSetup'
import { assertNoNativeSheet, dismissNativeSheet } from './helpers/nativeSheetCleanup'
import { clickSyncMenu } from './helpers/syncMenuClick'
import { reloadAs, setWindowSize, windowSize } from './helpers/phoneWindow'

targets('desktop', 'phone')
const fixture = liveSuite(false)
// Stack order: remove native UI before fixture teardown evaluates the WebView.
afterEach(async () => {
  if (onPhone()) await dismissNativeSheet((args) => driver(args, 10_000))
})
const factsSelector = '.abele-server-delete__facts'
const dialog = `inWindows(${JSON.stringify(factsSelector)})?.closest('.modal')`
const menu = `inWindows('.menu')`

/** Capture the current viewport, including the native notice/menu, never offscreen content. */
async function shot(a: SyncDriver, state: string, selector: string): Promise<void> {
  const name = 'server-delete-' + state + (onPhone() ? '-phone' : '-desktop')
  if (onPhone()) await assertNoNativeSheet((args) => driver(args, 10_000))
  a.run(
    `await poll(()=>![...new Set([document,settingsDoc()])].some(doc=>[...doc.querySelectorAll('.notice')].some(one=>textOf(one).includes('Connection saved'))),15000,'connection setup notice to disappear');await poll(()=>inWindows(${JSON.stringify(selector)})?.checkVisibility());await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true`
  )
  if (onPhone()) {
    await assertNoNativeSheet((args) => driver(args, 10_000))
    screenshot(join(shotDir('abele-token-screens'), name + '.png'))
  } else {
    const screen = await captureSyncScreen(a, name, selector)
    expect(screen.error).toBe('')
    expect(screen.over).toEqual([])
    expect(screen.clipped).toEqual([])
    expect(screen.shot).toContain(name + '.png')
  }
}

async function openConfirmation(a: SyncDriver, id: string, state: string): Promise<void> {
  const labels = await a.long<string[]>(
    'open connection deletion menu',
    `
    await poll(()=>![...new Set([document,settingsDoc()])].some(doc=>[...doc.querySelectorAll('.notice')].some(one=>textOf(one).includes('Connection saved'))),15000,'connection setup notice to disappear');
    const root=await openSyncTab();const native=app.vault.getConfig('nativeMenus');
    try{app.vault.setConfig('nativeMenus',false);(${clickSyncMenu.toString()})(connectionRow(root,${JSON.stringify(id)}))}finally{app.vault.setConfig('nativeMenus',native)}
    await poll(()=>[...(${menu})?.querySelectorAll('.menu-item')||[]].some(one=>textOf(one)==='Delete from the server…'&&!one.classList.contains('is-disabled')));
    return [...(${menu}).querySelectorAll('.menu-item-title')].map(textOf)
  `
  )
  expect(labels.slice(-2)).toEqual(['Disconnect…', 'Delete from the server…'])
  await shot(a, state + '-menu', '.menu')
  a.run(
    `const item=[...(${menu}).querySelectorAll('.menu-item')].find(one=>textOf(one)==='Delete from the server…');item.click();await poll(()=>${dialog});return true`
  )
  expect(a.rows().some((row) => row.id === id)).toBe(true)
}

function expectConfirmation(
  a: SyncDriver,
  name: string,
  host: string,
  files: number,
  bytes: number
): void {
  const observed = a.run<{ title: string; facts: Record<string, string>; note: string }>(`
    const box=${dialog};const list=box.querySelector(${JSON.stringify(factsSelector)});
    return {title:textOf(box.querySelector('.modal-title')),facts:Object.fromEntries([...list.querySelectorAll('dt')].map(one=>[textOf(one),textOf(one.nextElementSibling)])),note:textOf(box.querySelector('.abele-server-delete__note'))}
  `)
  expect(observed.title).toBe('Delete ' + name + ' from the server?')
  expect(observed.facts.Server).toBe(host)
  expect(observed.facts.Files).toBe(String(files))
  expect(observed.facts.Size).toBe(bytes + ' B')
  expect(observed.facts['Access closed']).toContain('Sample reading device')
  expect(observed.note).toContain("server's trash for 30 days")
  expect(observed.note).toContain('keeps every file')
  expect(observed.note).toContain('Devices with that access stop and keep their copies')
}

async function confirmDone(
  a: SyncDriver,
  id: string,
  state: string,
  path: string,
  content: string
): Promise<void> {
  a.run(
    `await press(${dialog},'Delete from the server');await poll(()=>!svc.registry.records().some(one=>one.id===${JSON.stringify(id)})&&!(${dialog}));await poll(()=>inWindows('.notice-container')?.textContent.includes('Its files stay on this device.'));return true`
  )
  expect(a.rows().some((row) => row.id === id)).toBe(false)
  expect(a.read(path)).toBe(content)
  expect(a.run(`return textOf(inWindows('.token-sync-settings'))`)).toContain('No connections yet')
  await shot(a, state + '-done', '.token-sync-settings')
}

it('shows whole-vault facts and explicitly deletes only after confirmation, keeping local files', async () => {
  const s = fixture(),
    a = s.primary,
    path = s.root + '/sample.md',
    content = 'Sample vault note'
  await s.put(path, content)
  const { token: reader } = await issueDeletionDevice(
    s.server.rootToken,
    'Sample reading device',
    true,
    fixtureFetch
  )
  const id = await s.connect()
  try {
    await openConfirmation(a, id, 'vault')
    expectConfirmation(
      a,
      'the whole vault',
      new URL(s.server.url).host,
      1,
      Buffer.byteLength(content)
    )
    await shot(a, 'vault-confirmation', factsSelector)
    expect((await s.items()).some((one) => one.path === path)).toBe(true)
    await confirmDone(a, id, 'vault', path, content)
    await expect(
      AccessClient.fromToken(reader, { fetch: fixtureFetch }).connection()
    ).rejects.toMatchObject({ code: 'scope_deleted' })
  } finally {
    closeSyncScreens(a)
  }
}, 180000)

it.each([
  { name: 'Sample folder', state: 'folder' },
  {
    name: 'Sample project with a deliberately long folder name for checking narrow confirmation sheets',
    state: 'folder-long',
  },
])(
  'confirms $state, closes its access and leaves sibling server files untouched',
  async ({ name, state }) => {
    const s = fixture(),
      a = s.primary
    const folder = s.root + '/' + name,
      path = folder + '/sample.md',
      sibling = s.root + '/unrelated.md',
      content = 'Sample folder note'
    await s.put(path, content)
    await s.put(sibling, 'Unrelated server note')
    const scope = await deletionFolder(s.server.rootToken, folder, fixtureFetch)
    expect(scope).toBeDefined()
    const token = await s.server.issue(
      { kind: 'folder', id: scope!.file_id },
      'Sample folder device'
    )
    await issueDeletionDevice(token, 'Sample reading device', true, fixtureFetch)
    const id = await s.connect(a, token)
    try {
      await openConfirmation(a, id, state)
      expectConfirmation(
        a,
        '“' + name + '”',
        new URL(s.server.url).host,
        1,
        Buffer.byteLength(content)
      )
      await shot(a, state + '-confirmation', factsSelector)
      await confirmDone(a, id, state, path, content)
      const items = await s.items()
      expect(items.some((one) => one.path === path)).toBe(false)
      expect(items.some((one) => one.path === sibling)).toBe(true)
    } finally {
      closeSyncScreens(a)
    }
  },
  180000
)

it.skipIf(onPhone())(
  'deletes a large folder while its first download is still running, without a restart',
  async () => {
    const s = fixture(),
      a = s.primary
    const folder = s.root + '/Field Notes',
      first = folder + '/first.md',
      sibling = s.root + '/unrelated.md'
    await s.put(first, 'First sample field note')
    await s.put(sibling, 'Unrelated server note')
    const scope = await deletionFolder(s.server.rootToken, folder, fixtureFetch)
    expect(scope).toBeDefined()
    const token = await s.server.issue(
      { kind: 'folder', id: scope!.file_id },
      'Sample folder device'
    )
    const id = await s.connect(a, token)
    // Enough synthetic files that the next download pass is still running when Delete is pressed.
    const owner = new V2EngineClient(s.server.rootToken, { fetch: fixtureFetch })
    const ops = []
    for (let i = 0; i < 900; i++) {
      const bytes = new TextEncoder().encode(
        i % 45 === 0 ? 'sample attachment '.repeat(60000) : 'Sample field note ' + i
      )
      const sha = await sha256(bytes)
      await owner.putBlob(sha, bytes)
      const name = i % 45 === 0 ? `sample-${i}.bin` : `sample-${i}.md`
      ops.push({
        op: 'create' as const,
        path: folder + '/' + name,
        sha,
        size: bytes.length,
        mtime: Date.now(),
      })
    }
    for (let i = 0; i < ops.length; i += 100) await s.commit(ops.slice(i, i + 100))
    try {
      a.run(
        `void svc.sync(${JSON.stringify(id)}).catch(()=>{});await poll(()=>app.plugins.plugins.abele.tokenEngines.live.get(${JSON.stringify(id)})?.engine.status.state==='syncing',30000,'download pass to start');return true`
      )
      await openConfirmation(a, id, 'in-flight')
      const elapsed = await a.long<{ ms: number; syncing: boolean }>(
        'delete while syncing',
        `const syncing=app.plugins.plugins.abele.tokenEngines.live.get(${JSON.stringify(id)})?.engine.status.state==='syncing';const started=Date.now();await press(${dialog},'Delete from the server');await poll(()=>!svc.registry.records().some(one=>one.id===${JSON.stringify(id)})&&!(${dialog})||(${dialog})?.querySelector('[role="alert"]'),90000,'deletion to finish');const alert=(${dialog})?.querySelector('[role="alert"]');if(alert) throw new Error('Deletion failed: '+textOf(alert));return {ms:Date.now()-started,syncing}`
      )
      console.log('[server delete in flight]', JSON.stringify(elapsed))
      expect(elapsed.syncing).toBe(true)
      expect(a.rows().some((row) => row.id === id)).toBe(false)
      expect(a.read(first)).toBe('First sample field note')
      const items = await s.items()
      expect(items.some((one) => one.path.startsWith(folder + '/'))).toBe(false)
      expect(items.some((one) => one.path === sibling)).toBe(true)
      // Nothing restarts the stopped connection after the deletion.
      expect(
        a.run(`return app.plugins.plugins.abele.tokenEngines.live.has(${JSON.stringify(id)})`)
      ).toBe(false)
    } finally {
      closeSyncScreens(a)
    }
  },
  300000
)

it('keeps an in-progress confirmation open and shows a real server error without removing local files', async () => {
  const s = fixture(),
    a = s.primary,
    path = s.root + '/sample.md',
    content = 'Retained during a network failure'
  await s.put(path, content)
  const id = await s.connect()
  try {
    await openConfirmation(a, id, 'error')
    s.server.suspend()
    a.run(
      `await press(${dialog},'Delete from the server');await poll(()=>buttonIn(${dialog},'Deleting…')?.disabled);return true`
    )
    expect(a.run(`const box=${dialog};buttonIn(box,'Cancel').click();return !!(${dialog})`)).toBe(
      true
    )
    await shot(a, 'in-progress', factsSelector)
    await s.server.crash()
    await a.long(
      'server deletion failure appears',
      `await poll(()=>(${dialog})?.querySelector('[role="alert"]'));return true`
    )
    expect(a.run(`return textOf((${dialog}).querySelector('[role="alert"]'))`)).toBe(
      `No answer from ${new URL(s.server.url).host}. It may already be deleted: Try again to find out.`
    )
    expect(a.run(`return !buttonIn(${dialog},'Try again').disabled`)).toBe(true)
    expect(a.rows().some((row) => row.id === id)).toBe(true)
    expect(a.read(path)).toBe(content)
    await shot(a, 'server-error', factsSelector)
  } finally {
    // Also thaw on an earlier assertion failure; crash/kill itself is idempotent.
    s.server.resume()
    closeSyncScreens(a)
  }
}, 180000)

for (const layout of onPhone() ? ['phone'] : ['desktop', 'emulated-phone'])
  it(
    'explains an overdue stop and retries without restarting on ' + layout,
    async () => {
      const s = fixture(),
        a = s.primary,
        path = s.root + '/sample.md',
        size = onPhone() ? undefined : windowSize(a.vault())
      try {
        if (layout === 'emulated-phone') {
          await setWindowSize(a.vault(), 390, 844)
          await reloadAs(a.vault(), true)
          // Layout emulation has no native phone HTTP bridge. Reuse the explicit desktop
          // host the shared helper installed for this synthetic server, including UI probes.
          a.run(`svc.transport=app.plugins.plugins.abele.tokenEngines.deps.fetch;return true`)
        }
        await s.put(path, 'Retained while stopping')
        const id = await s.connect()
        await openConfirmation(a, id, 'stop-' + layout)
        a.run(`
        const original=svc.stopRuntime,limit=svc.runtimeStopLimitMs;
        window.__deletionStop={original,limit,id:${JSON.stringify(id)},temp:${JSON.stringify(s.root + '/.sample-refusal.tmp')}};
        svc.runtimeStopLimitMs=100;
        svc.stopRuntime=async id=>{await original(id);await new Promise(resolve=>{window.__deletionStop.release=resolve})};
        await press(${dialog},'Delete from the server');
        await poll(()=>textOf((${dialog})?.querySelector('[role="alert"]')).includes('Sync is still stopping'));
        return true
      `)
        expect(a.run(`return !buttonIn(${dialog},'Try again').disabled`)).toBe(true)
        expect((await s.items()).some((one) => one.path === path)).toBe(true)
        expect(a.read(path)).toBe('Retained while stopping')
        await shot(a, 'still-stopping-' + layout, factsSelector)
        a.run(`
        svc.runtimeStopLimitMs=window.__deletionStop.limit;
        window.__deletionStop.release();
        const entries=app.loadLocalStorage('abele-sync-writes')||[];
        app.saveLocalStorage('abele-sync-writes',[...entries,{owner:${JSON.stringify(id)},target:${JSON.stringify(path)},temp:window.__deletionStop.temp}]);
        await press(${dialog},'Try again');
        await poll(()=>textOf((${dialog})?.querySelector('[role="alert"]')).includes('installation or retained-byte recovery is unfinished'));
        return true
      `)
        expect((await s.items()).some((one) => one.path === path)).toBe(true)
        expect(a.read(path)).toBe('Retained while stopping')
        await shot(a, 'local-refusal-' + layout, factsSelector)
        a.run(`
        const held=window.__deletionStop,entries=app.loadLocalStorage('abele-sync-writes')||[];
        app.saveLocalStorage('abele-sync-writes',entries.filter(one=>!(one.owner===held.id&&one.temp===held.temp)));
        await press(${dialog},'Try again');
        await poll(()=>!svc.registry.records().some(one=>one.id===${JSON.stringify(id)})&&!(${dialog}));
        return true
      `)
        await expect(s.items()).rejects.toMatchObject({ code: 'scope_deleted' })
        expect(a.read(path)).toBe('Retained while stopping')
        await shot(a, 'retry-done-' + layout, '.token-sync-settings')
      } finally {
        a.run(
          `const held=window.__deletionStop;if(held){held.release?.();const entries=app.loadLocalStorage('abele-sync-writes')||[];app.saveLocalStorage('abele-sync-writes',entries.filter(one=>!(one.owner===held.id&&one.temp===held.temp)));svc.stopRuntime=held.original;svc.runtimeStopLimitMs=held.limit;delete window.__deletionStop}return true`
        )
        closeSyncScreens(a)
        if (layout === 'emulated-phone') {
          await reloadAs(a.vault(), false)
          await setWindowSize(a.vault(), ...size!)
        }
      }
    },
    180000
  )

it('shows another device stopped by scope_deleted after the owner deletes the same server scope', async () => {
  const s = fixture(),
    a = s.primary,
    path = s.root + '/sample.md',
    content = 'Retained on the other device'
  await s.put(path, content)
  const owner = AccessClient.fromToken(s.server.rootToken, { fetch: fixtureFetch })
  const { token } = await issueDeletionDevice(
    s.server.rootToken,
    'Sample other device',
    false,
    fixtureFetch
  )
  const id = await s.connect(a, token)
  try {
    await new V2Client(owner.token, fixtureFetch).deleteScope(randomUUID())
    // The owner request is the explicit confirmation on the simulated second device.
    await a.syncNow(id).catch(() => {})
    await a.long(
      'other device permanently stops',
      `await openSyncTab();await poll(()=>!!svc.registry.records().find(one=>one.id===${JSON.stringify(id)})?.state['abele-sync-token-state:scope-deleted']);await poll(()=>textOf(connectionRow(app.setting.activeTab.containerEl,${JSON.stringify(id)})).includes('Deleted on the server'));return true`
    )
    expect(a.read(path)).toBe(content)
    expect(
      a.run(`return textOf(connectionRow(app.setting.activeTab.containerEl,${JSON.stringify(id)}))`)
    ).toContain('Deleted on the server')
    expect(
      a.run(
        `const row=connectionRow(app.setting.activeTab.containerEl,${JSON.stringify(id)});return {sync:!!row.querySelector('svg.lucide-refresh-cw'),red:!!row.querySelector('.abele-status-dot_red'),menu:!!row.querySelector('svg.lucide-more-horizontal')}`
      )
    ).toEqual({ sync: false, red: true, menu: true })
    expect(
      a.run(`try{await svc.pause(${JSON.stringify(id)},false);return false}catch{return true}`)
    ).toBe(true)
    await shot(a, 'other-device-stopped', '.token-sync-settings')
  } finally {
    closeSyncScreens(a)
  }
}, 180000)

it('shows a disabled read-only deletion action with its reason and never offers confirmation', async () => {
  const s = fixture(),
    a = s.primary,
    path = s.root + '/read-only.md'
  await s.put(path, 'Sample read-only note')
  const { token } = await issueDeletionDevice(
    s.server.rootToken,
    'Sample read-only device',
    true,
    fixtureFetch
  )
  const id = await s.connect(a, token)
  try {
    const observed = await a.long<{ disabled: boolean; reason: string; labels: string[] }>(
      'open read-only deletion menu',
      `
      await poll(()=>![...new Set([document,settingsDoc()])].some(doc=>[...doc.querySelectorAll('.notice')].some(one=>textOf(one).includes('Connection saved'))),15000,'connection setup notice to disappear');
      const root=await openSyncTab(),native=app.vault.getConfig('nativeMenus');
      try{app.vault.setConfig('nativeMenus',false);(${clickSyncMenu.toString()})(connectionRow(root,${JSON.stringify(id)}))}finally{app.vault.setConfig('nativeMenus',native)}
      let item;await poll(()=>item=[...(${menu})?.querySelectorAll('.menu-item')||[]].find(one=>textOf(one)==='Delete from the server: read only'));
      return {disabled:item.classList.contains('is-disabled')||item.getAttribute('aria-disabled')==='true',reason:item.getAttribute('aria-label'),labels:[...(${menu}).querySelectorAll('.menu-item-title')].map(textOf)}
    `
    )
    expect(observed.disabled).toBe(true)
    expect(observed.reason).toBe(
      'This key can only read. Only someone who can change these files can delete them.'
    )
    expect(observed.labels.slice(-2)).toEqual(['Disconnect…', 'Delete from the server: read only'])
    await shot(a, 'read-only-menu', '.menu')
    a.run(
      `const item=[...(${menu}).querySelectorAll('.menu-item')].find(one=>textOf(one)==='Delete from the server: read only');item.click();return true`
    )
    expect(a.run(`return !!(${dialog})`)).toBe(false)
    expect((await s.items()).some((one) => one.path === path)).toBe(true)
    expect(a.read(path)).toBe('Sample read-only note')
  } finally {
    closeSyncScreens(a)
  }
}, 180000)
