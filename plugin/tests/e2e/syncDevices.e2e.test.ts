/**
 * The devices on a vault, and leaving one (phase 3b, decisions 3 and 6), end to end: the running
 * Obsidian, a daemon folder as a second device, a real server.
 *
 * - **Devices on this vault** on the Sync tab lists the daemon, this device (marked, with no
 *   Revoke) and a device made for a transfer (`enrolSibling`), which it says this one enrolled.
 * - **Revoke** on the daemon, confirmed: the row goes, the daemon's next sync is refused and says
 *   to connect again, and this device keeps syncing.
 * - **Disconnect** tells the server: this device is gone from the account's own list, and the
 *   device made for the transfer is still on it — disconnecting one no longer cuts off both.
 * - **Disconnect with the server down** keeps the token to tell it later: the Sync tab shows
 *   **Waiting to tell the server**, and **Forget without telling the server**, confirmed, lets it
 *   go. Last, since it kills the server.
 *
 * The account's own list is read over HTTP from the test process (`accountDevices`), because it
 * is exactly what a device that left can no longer read for itself.
 *
 * Requires Obsidian running with a vault open, the sibling repository built, and
 * `npm run build:test` newer than the source — see docs/Testing.md.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  daemonConfig,
  daemonSyncOnce,
  initDaemon,
  siblingMissing,
  spawnSyncServer,
  type SyncServer,
} from './helpers/syncServer'
import { obsidianMissing, openTestVault, waitFor, type TestVault } from './helpers/syncVault'
import { accountDevices, beforeSignIn, SyncDriver } from './helpers/syncDriver'

const EMAIL = 'sync-devices@example.com'
const PASSWORD = 'a-password-nobody-prints'
const DEVICE = 'obsidian on this desk'
const DAEMON = 'daemon in a cupboard'
const SIBLING = 'the phone a transfer set up'

const why = siblingMissing() ?? obsidianMissing()
if (why !== null) console.info(`\n  sync devices e2e skipped: ${why}\n`)

let workspace = ''
let daemonDir = ''
let server: SyncServer | null = null
let vault: TestVault | null = null
let siblingId = ''

const app = (): TestVault => {
  if (vault === null) throw new Error('the test vault was never opened')
  return vault
}
const sync = new SyncDriver(app)

const liveServer = (): SyncServer => {
  if (server === null) throw new Error('no server')
  return server
}

interface Row {
  id: string
  name: string
  desc: string
  self: boolean
  revoke: boolean
}

/** The Sync tab's device list, row by row, once it has read the server. */
function deviceRows(): Promise<Row[]> {
  return sync.long<Row[]>(
    'the device list on the Sync tab',
    `
    const root = await openSyncTab()
    const section = () => sectionTitled(root, 'Devices on this vault')
    if (!(await poll(() => section() && section().querySelector('[data-device]'), 20000)))
      throw new Error('the device list never filled: ' + textOf(section()))
    const rows = [...section().querySelectorAll('[data-device]')].map((row) => ({
      id: row.getAttribute('data-device'),
      name: textOf(row.querySelector('.setting-item-name')),
      desc: textOf(row.querySelector('.setting-item-description')),
      self: textOf(row.querySelector('.setting-item-control')).includes('This device'),
      revoke: !!buttonIn(row, 'Revoke'),
    }))
    await closeSettings()
    return rows
    `,
    60_000
  )
}

describe.skipIf(why !== null)('the devices on a vault', () => {
  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'abele-sync-devices-'))
    daemonDir = join(workspace, 'daemon')
    mkdirSync(daemonDir)
    server = await spawnSyncServer(workspace)
    server.createAccount(EMAIL, PASSWORD)
    await beforeSignIn()
    initDaemon({
      dir: daemonDir,
      serverUrl: server.url,
      email: EMAIL,
      password: PASSWORD,
      vaultName: 'Devices',
      deviceName: DAEMON,
    })
    const vaultId = daemonConfig(daemonDir).vaultId

    vault = await openTestVault()
    vault.run(['dev:errors', 'clear'], 20_000)
    await beforeSignIn()
    sync.run(`
      await svc.connect(${JSON.stringify(server.url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
      await svc.chooseVault(${JSON.stringify(vaultId)}, ${JSON.stringify(DEVICE)})
      return 'ok'
    `)
    await sync.waitIdle()
    daemonSyncOnce(daemonDir)
  }, 300_000)

  afterAll(async () => {
    try {
      if (vault !== null) sync.run(`await svc.forget(); return 'ok'`, 30_000)
    } catch (error) {
      console.warn(`could not disconnect the test device: ${String(error)}`)
    }
    try {
      await vault?.dispose()
    } finally {
      await server?.kill()
      if (workspace !== '') rmSync(workspace, { recursive: true, force: true })
    }
  }, 300_000)

  it('lists every device on the vault, this one marked, and says which one enrolled the sibling', async () => {
    siblingId = sync.run<{ deviceId: string }>(
      `return await svc.enrolSibling(${JSON.stringify(SIBLING)})`
    ).deviceId
    const rows = await deviceRows()
    expect(rows.map((row) => row.name).sort()).toEqual([DAEMON, DEVICE, SIBLING].sort())
    const self = rows.find((row) => row.name === DEVICE)
    expect(self).toMatchObject({ self: true, revoke: false })
    expect(rows.find((row) => row.name === SIBLING)?.desc).toContain(`enrolled by ${DEVICE}`)
    expect(rows.find((row) => row.name === DAEMON)?.desc).toContain(
      'enrolled with the account password'
    )
  })

  it('Revoke stops the daemon at its next sync, and this device keeps syncing', async () => {
    const gone = await sync.long<boolean>(
      'Revoke on the daemon, confirmed',
      `
      const root = await openSyncTab()
      const doc = root.ownerDocument
      const section = () => sectionTitled(root, 'Devices on this vault')
      const row = () => [...section().querySelectorAll('[data-device]')].find(
        (r) => textOf(r.querySelector('.setting-item-name')) === ${JSON.stringify(DAEMON)})
      if (!(await poll(row, 20000))) throw new Error('no row for the daemon')
      await press(row(), 'Revoke')
      await press(() => modalOf('.abele-confirm__message', doc), 'Revoke')
      const left = await poll(() => !row(), 20000)
      await closeSettings()
      return left
      `,
      60_000
    )
    expect(gone).toBe(true)
    expect(() => daemonSyncOnce(daemonDir)).toThrow(/abele-sync run --once failed/)

    sync.create('Devices/After the revoke.md', 'still syncing\n')
    await sync.syncNow()
    expect(sync.serverPaths()).toContain('Devices/After the revoke.md')
  })

  it('Disconnect tells the server, and the device a transfer made stays enrolled', async () => {
    const own = sync.run<string>(`return svc.connection.value.deviceId`)
    const before = await accountDevices(liveServer().url, EMAIL, PASSWORD)
    expect(before.map((d) => d.id)).toContain(own)

    sync.run(`await svc.disconnect(); return 'ok'`, 30_000)
    expect(sync.run<unknown[]>(`return svc.connection.value.pendingRevoke`)).toEqual([])

    const after = await accountDevices(liveServer().url, EMAIL, PASSWORD)
    expect(after.map((d) => d.id)).not.toContain(own)
    expect(after.map((d) => d.id)).toContain(siblingId)
  })

  it('Disconnect with the server down keeps the token to tell it later, until it is forgotten', async () => {
    const vaultId = daemonConfig(daemonDir).vaultId
    await beforeSignIn()
    sync.run(`
      await svc.connect(${JSON.stringify(liveServer().url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
      await svc.chooseVault(${JSON.stringify(vaultId)}, ${JSON.stringify(DEVICE)})
      return 'ok'
    `)
    await sync.waitIdle()
    await liveServer().kill()

    // Up to ten seconds for a server that does not answer; a refused socket is quicker.
    await sync.long(
      'a Disconnect with nobody answering',
      `await svc.disconnect(); return 'ok'`,
      60_000
    )
    expect(sync.run<unknown[]>(`return svc.connection.value.pendingRevoke`)).toHaveLength(1)

    const shown = await sync.long<{ row: boolean; after: number }>(
      'the waiting line on the Sync tab, and forgetting it',
      `
      const root = await openSyncTab()
      const doc = root.ownerDocument
      const row = () => [...root.querySelectorAll('.setting-item')].find(
        (r) => textOf(r.querySelector('.setting-item-name')) === 'Waiting to tell the server')
      const seen = await poll(row, 10000)
      if (seen) {
        await press(row(), 'Forget without telling the server')
        await press(() => modalOf('.abele-confirm__message', doc), 'Forget')
        await poll(() => !row(), 10000)
      }
      await closeSettings()
      return { row: seen, after: svc.connection.value.pendingRevoke.length }
      `,
      60_000
    )
    expect(shown).toEqual({ row: true, after: 0 })
    await waitFor(
      'the status to say not connected',
      () => sync.status().state === 'disconnected',
      10_000
    )
  })
})
