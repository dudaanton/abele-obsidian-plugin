import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'
import type { SyncDriver } from './syncDriver'
import { captureSyncScreen, closeSyncScreens } from './syncScreens'
import { screenshot } from './phone'
import { onPhone } from './target'
import { shotDir } from './shots'

const description =
  'Automatically installs incoming code and shares linked private files without asking on this device.'
const trustRow = `
 const box=inWindows('.abele-sync-window');
 if(!box)throw new Error('Connection window unavailable');
 const row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Trusted');
 if(!row)throw new Error('Trusted setting unavailable');
 const toggle=row.querySelector('[role="checkbox"]');
 if(!toggle)throw new Error('Trusted toggle unavailable');
`

export function openTrustedConnection(device: SyncDriver, id: string): void {
  closeSyncScreens(device)
  device.run(
    `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(id)}),'settings');await poll(()=>inWindows('.abele-sync-window'));return true`
  )
}

export function expectTrustedRow(device: SyncDriver, enabled: boolean): void {
  const state = device.run<{ visible: boolean; description: string; checked: string }>(`
    ${trustRow}
    row.scrollIntoView({block:'center'});await sleep(250);
    const win=row.ownerDocument.defaultView,body=row.closest('.abele-modal__body');
    const bodyRect=body?.getBoundingClientRect();
    const visible=element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=win.innerWidth+1&&r.top>=Math.max(0,bodyRect?.top||0)&&r.bottom<=Math.min(win.innerHeight,bodyRect?.bottom||win.innerHeight)+1};
    const desc=row.querySelector('.setting-item-description');
    return {visible:!!desc&&visible(row)&&visible(row.querySelector('.setting-item-name'))&&visible(desc)&&visible(toggle),description:textOf(desc),checked:toggle.getAttribute('aria-checked')}
  `)
  expect(state.description).toBe(description)
  expect(state.visible).toBe(true)
  expect(state.checked).toBe(String(enabled))
}

/** Only operate the real switch; never set the registry or a UI service preference here. */
export function toggleTrusted(device: SyncDriver, id: string, enabled: boolean): void {
  expectTrustedRow(device, !enabled)
  device.run(`
    ${trustRow}
    toggle.click();
    await poll(()=>toggle.getAttribute('aria-checked')===${JSON.stringify(String(enabled))}&&!!svc.registry.records().find(one=>one.id===${JSON.stringify(id)})?.trusted===${enabled});
    return true
  `)
  expectTrustedRow(device, enabled)
}

export function expectDeviceLocalTrust(device: SyncDriver, id: string, enabled: boolean): void {
  const state = device.run<{ trusted: boolean; synced: boolean }>(`
    const settings=await app.plugins.plugins.abele.loadData();
    const hasTrust=value=>!!value&&typeof value==='object'&&(Object.hasOwn(value,'trusted')||Object.values(value).some(hasTrust));
    return {trusted:!!svc.registry.records().find(one=>one.id===${JSON.stringify(id)})?.trusted,synced:hasTrust(settings?.sync)||Object.hasOwn(settings||{},'trusted')}
  `)
  expect(state).toEqual({ trusted: enabled, synced: false })
}

async function captureTrustedWindow(device: SyncDriver, label: string): Promise<void> {
  if (onPhone()) {
    const directory = shotDir('abele-token-screens')
    mkdirSync(directory, { recursive: true })
    screenshot(join(directory, label + '.png'))
  } else {
    const screen = await captureSyncScreen(device, label, '.abele-sync-window')
    expect(screen.error).toBe('')
    expect(screen.over).toEqual([])
    expect(screen.clipped).toEqual([])
    expect(screen.shot).toMatch(/\.png$/)
  }
}

/** Leaves trust off, after proving both saved states survive closing and reopening. */
export async function exerciseTrustedWindow(
  device: SyncDriver,
  id: string,
  label: string
): Promise<void> {
  try {
    openTrustedConnection(device, id)
    expectTrustedRow(device, false)
    expectDeviceLocalTrust(device, id, false)
    await captureTrustedWindow(device, label + '-off')
    toggleTrusted(device, id, true)
    expectDeviceLocalTrust(device, id, true)
    await captureTrustedWindow(device, label + '-on')
    openTrustedConnection(device, id)
    expectTrustedRow(device, true)
    toggleTrusted(device, id, false)
    openTrustedConnection(device, id)
    expectTrustedRow(device, false)
    expectDeviceLocalTrust(device, id, false)
  } finally {
    closeSyncScreens(device)
  }
}
