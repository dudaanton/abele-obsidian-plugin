import { expect, it } from 'vitest'
import { AccessClient } from '@abele/sync-core'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { liveSuite } from './helpers/syncLiveCases'
import { captureSyncScreen, closeSyncScreens } from './helpers/syncScreens'
import { fixtureFetch } from './helpers/syncServer'
import { screenshot } from './helpers/phone'
import { shotDir } from './helpers/shots'
import { onPhone, targets } from './helpers/target'
import type { SyncDriver } from './helpers/syncDriver'
import { V2Client } from '../../src/sync/v2/client'
import { issueDeletionDevice, deletionFolder } from '../helpers/serverDeleteSetup'

targets('desktop', 'phone')
const fixture = liveSuite(false)
const factsSelector = '.abele-server-delete__facts'
const dialog = `inWindows(${JSON.stringify(factsSelector)})?.closest('.modal')`
const menu = `inWindows('.menu')`

/** Capture the current viewport, including the native notice/menu, never offscreen content. */
async function shot(a: SyncDriver, state: string, selector: string): Promise<void> {
  const name = 'server-delete-' + state + (onPhone() ? '-phone' : '-desktop')
  a.run(
    `await poll(()=>inWindows(${JSON.stringify(selector)})?.checkVisibility());await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true`
  )
  if (onPhone()) screenshot(join(shotDir('abele-token-screens'), name + '.png'))
  else {
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
    const root=await openSyncTab();const native=app.vault.getConfig('nativeMenus');
    try{app.vault.setConfig('nativeMenus',false);icon(connectionRow(root,${JSON.stringify(id)}),'more-horizontal')}finally{app.vault.setConfig('nativeMenus',native)}
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
    expect(a.run(`return textOf((${dialog}).querySelector('[role="alert"]'))`)).toContain(
      'Deletion could not be confirmed'
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
      a.run(`try{await svc.pause(${JSON.stringify(id)},false);return false}catch{return true}`)
    ).toBe(true)
    await shot(a, 'other-device-stopped', '.token-sync-settings')
  } finally {
    closeSyncScreens(a)
  }
}, 180000)
