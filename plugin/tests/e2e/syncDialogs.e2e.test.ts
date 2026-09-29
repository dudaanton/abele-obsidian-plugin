/**
 * The phase-3b sync screens on a phone and their focus rings on the desktop, and a phone's own
 * sync while it is in front.
 *
 * `syncPhone.e2e.test.ts` pictures the history, the trash, the log and the Sync tab as they were
 * before phase 3b. This file does the same for what 3b added, in a vault of its own made the
 * same way — a real server, a device paired to it — and filled so each screen is at its longest:
 *
 * - **Deletions held back** with sixty files under long folder names, and its confirmation
 *   stacked over it;
 * - **Settings changed on another device**, naming App settings and two plugins;
 * - **Deleted files** with **Restore all deleted since** in each of its three presets — the
 *   date-time field among them — and the restore's confirmation;
 * - the **Sync tab** holding all of it at once: held deletions, waiting settings, three devices
 *   with long names, and the Revoke confirmation;
 * - the **join dialog** as a sign-in opens it — choose (both sides hold files), upload (the
 *   server holds none), reconnect — and as a transfer's receipt leaves it, with the tab in its
 *   **Choose how to join** state;
 * - the not-connected tab with **Waiting to tell the server** after a Disconnect nobody answered,
 *   and its "Forget without telling the server?" confirmation.
 *
 * Each is asked what the phone probe asks — nothing past the edge, nothing capped, no clipped
 * focus ring, the buttons on the screen and on top — at 390 and 320 wide under the phone's
 * emulation, and the rings again on the desktop (what `dialogRings.e2e.test.ts` does for the
 * chat's dialogs; these need a paired vault, which that file does not make). The settings screens
 * are also asked `settingsLayout.e2e.test.ts`'s question about half-empty rows.
 *
 * And, as a phone: a note made while the app is in front reaches the server with nothing else
 * done (three-node B1), and so does one made right before the app leaves the front.
 *
 * Pictures go to `/tmp/abele-phone/`. Look at them.
 *
 * Requires Obsidian running with a vault open, the sibling repository built, and
 * `npm run build:test` newer than the source — see docs/Testing.md.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  daemonConfig,
  daemonSyncOnce,
  initDaemon,
  siblingMissing,
  spawnSyncServer,
  type SyncServer,
} from './helpers/syncServer'
import { obsidianMissing, waitFor, type TestVault } from './helpers/syncVault'
import { probePrelude, type Screen } from './helpers/layoutProbe'
import { openVaultUnderLock, reloadAs, setWindowSize, windowSize } from './helpers/phoneWindow'
import { beforeSignIn, SyncDriver } from './helpers/syncDriver'
import {
  heldScreens,
  joinScreens,
  restoreSinceScreens,
  signInOnTab,
  stagedScreen,
  syncTabScreens,
} from './helpers/syncScreens'

const EMAIL = 'sync-dialogs@example.com'
const PASSWORD = 'a-password-nobody-prints'
const SHOTS = '/tmp/abele-phone'
const PHONE: [number, number] = [390, 844]
const NARROW: [number, number] = [320, 844]
const VAULT = 'A vault with a name long enough to wrap on the narrowest phone still sold'
const EMPTY_VAULT = 'An empty vault'
const DEVICE = 'The phone this probe pretends to be, with a long name'
const SIBLING = 'A device a transfer made, with a name as long as the others'
const HELD_DIR = 'Held back/A folder with a name long enough to wrap onto a second line'
const HELD = 60
const TRASHED = 12

const why = siblingMissing() ?? obsidianMissing()
if (why !== null) console.info(`\n  sync dialogs probe skipped: ${why}\n`)

let workspace = ''
let daemonDir = ''
let server: SyncServer | null = null
let vault: TestVault | null = null
let size: [number, number] = [0, 0]
const phone: Record<string, Screen> = {}
const desktop: Record<string, Screen> = {}
/** How long each phone push took to reach the server, or why it did not. */
const pushed: Record<string, number | string> = {}

const app = (): TestVault => {
  if (vault === null) throw new Error('the test vault was never opened')
  return vault
}
const sync = new SyncDriver(app)
const liveServer = (): SyncServer => {
  if (server === null) throw new Error('no server')
  return server
}

/**
 * One probe step: the layout probe's prelude (the driver adds its own), then `body`. A step that
 * fails is kept as a screen that says so, and the rest go on.
 */
async function collect(into: Record<string, Screen>, body: string): Promise<void> {
  try {
    Object.assign(
      into,
      await sync.long<Record<string, Screen>>(
        'a probe step',
        `${probePrelude(SHOTS)}\n${body}`,
        180_000
      )
    )
  } catch (error) {
    into[`failed step ${Object.keys(into).length + 1}`] = {
      over: [],
      scrollers: [],
      capped: [],
      stranded: [],
      clipped: [],
      fill: 0,
      width: 0,
      shot: '',
      error: String(error),
      extra: {},
    }
  }
}

/** A daemon's file, and one sync of it. */
function daemonWrites(files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(daemonDir, path)), { recursive: true })
    writeFileSync(join(daemonDir, path), text)
  }
  daemonSyncOnce(daemonDir)
}

/** How long a note made now takes to show on the server, doing `then` right after making it. */
async function pushTime(path: string, then: () => void): Promise<number | string> {
  const started = Date.now()
  try {
    sync.create(path, 'made on the phone\n')
    then()
    await waitFor(`${path} on the server`, () => sync.serverPaths().includes(path), 20_000)
    return Date.now() - started
  } catch (error) {
    return String(error)
  }
}

/** Every screen of the connected device, at the width the window has now. */
async function connectedScreens(into: Record<string, Screen>, suffix: string, pages: number) {
  await collect(into, heldScreens(suffix))
  await collect(into, stagedScreen(suffix))
  await collect(into, restoreSinceScreens(suffix, TRASHED))
  await collect(into, syncTabScreens(`sync tab full${suffix}`, pages, { revoke: SIBLING }))
}

describe.skipIf(why !== null)('the phase-3b sync screens', () => {
  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'abele-sync-dialogs-'))
    daemonDir = join(workspace, 'daemon')
    mkdirSync(daemonDir)
    server = await spawnSyncServer(workspace)
    server.createAccount(EMAIL, PASSWORD)
    for (const [dir, name] of [
      [daemonDir, VAULT],
      [join(workspace, 'empty'), EMPTY_VAULT],
    ]) {
      mkdirSync(dir, { recursive: true })
      await beforeSignIn()
      initDaemon({
        dir,
        serverUrl: server.url,
        email: EMAIL,
        password: PASSWORD,
        vaultName: name,
        deviceName: name === VAULT ? 'The daemon in a cupboard, named at length too' : 'daemon',
      })
    }
    const vaultId = daemonConfig(daemonDir).vaultId

    vault = await openVaultUnderLock()
    // Obsidian's own settings and other plugins' travel here, for the settings question to have
    // something to name; the plugin's sixteen megabytes of `main.js` stay out.
    writeFileSync(
      join(vault.path, '.abele-sync-ignore'),
      '.obsidian/\n!.obsidian/app.json\n!.obsidian/plugins/*/data.json\n'
    )
    await beforeSignIn()
    sync.run(`
      await svc.connect(${JSON.stringify(server.url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
      await svc.chooseVault(${JSON.stringify(vaultId)}, ${JSON.stringify(DEVICE)})
      return 'ok'
    `)
    await sync.waitIdle()

    // What the screens show: a trash, a hold, staged settings, a third device.
    const held = Array.from({ length: HELD }, (_, i): [string, string] => [
      `${HELD_DIR}/A note whose name also runs long ${String(i + 1).padStart(2, '0')}.md`,
      'about to be deleted\n',
    ])
    const trashed = Array.from({ length: TRASHED }, (_, i): [string, string] => [
      `Trashed/Deleted note ${i + 1}.md`,
      'deleted a moment ago\n',
    ])
    sync.createMany([...held, ...trashed])
    await sync.syncNow()
    sync.remove(trashed.map(([path]) => path))
    await sync.syncNow()
    sync.remove(['Held back'])
    expect((await sync.syncNow()).heldDeletes).toBe(HELD)
    daemonSyncOnce(daemonDir)
    daemonWrites({
      '.obsidian/app.json': JSON.stringify({ nativeMenus: false, spellcheck: false }),
      '.obsidian/plugins/dataview/data.json': JSON.stringify({ renderNullAs: '-' }),
      '.obsidian/plugins/obsidian-tasks-plugin/data.json': JSON.stringify({ globalFilter: '' }),
    })
    await sync.syncNow()
    // Two devices made as a transfer makes them: one for the device list to show beside the
    // daemon and this one, one for the transfer's receipt later on.
    sync.run(`return await svc.enrolSibling(${JSON.stringify(SIBLING)})`)
    const sibling = sync.run<Record<string, string>>(
      `return await svc.enrolSibling(${JSON.stringify(`${SIBLING} (receiver)`)})`
    )
    size = windowSize(app())

    // The desktop: rings, in a window the size of a laptop's.
    await setWindowSize(app(), 1200, 900)
    await connectedScreens(desktop, ' desktop', 1)

    // The phone.
    await setWindowSize(app(), ...PHONE)
    await reloadAs(app(), true)
    await sync.waitIdle()
    await setWindowSize(app(), ...PHONE)
    await connectedScreens(phone, '', 6)
    await setWindowSize(app(), ...NARROW)
    await connectedScreens(phone, ' 320', 8)
    await setWindowSize(app(), ...PHONE)

    // A phone in front pushes by itself; one leaving the front pushes on the way out.
    sync.frontAsIs()
    pushed.inFront = await pushTime('Phone/Made in front.md', () => sync.inFront())
    pushed.leaving = await pushTime('Phone/Made before leaving.md', () => sync.leftFront())
    sync.backInFront()
    sync.frontAsIs()

    // A transfer's receipt: the tab waits for the join question, and the dialog asks it.
    sync.run(`await svc.forget(); return 'ok'`)
    sync.run(`
      const { maxFileBytes, ...shared } = svc.connection.value.selective
      await svc.adoptTransferred(${JSON.stringify({ ...sibling, token: undefined })}, ${JSON.stringify(sibling.token)}, shared)
      return 'ok'
    `)
    await sync.waitState('joining', 20_000)
    await collect(phone, syncTabScreens('sync tab joining', 2))
    await collect(
      phone,
      `
      await closeDialog()
      const root = await openSyncTab()
      if (!(await until(() => document.querySelector('.abele-join-vault'), 20000))) throw new Error('the tab never asked')
      await wait(400)
      const modal = document.querySelector('.abele-join-vault').closest('.modal')
      const out = { 'join transfer': await screen('join transfer', modal, modal.querySelector('.abele-modal__body')) }
      out['join transfer'].extra = { name: !!modal.querySelector('.abele-join-vault input'), cards: modal.querySelectorAll('.abele-card').length }
      await press(modal, 'Connect')
      await until(() => !document.querySelector('.abele-join-vault'), 30000)
      await closeSettings()
      return out
      `
    )
    await sync.waitIdle()

    // The join dialog as a sign-in opens it: reconnect, then — the record forgotten — choose
    // and upload, each at 390 and 320.
    sync.run(`await svc.disconnect(); return 'ok'`, 30_000)
    await beforeSignIn()
    await collect(phone, signInOnTab(liveServer().url, EMAIL, PASSWORD))
    await collect(phone, joinScreens(VAULT, 'join reconnect', [PHONE, NARROW]))
    sync.run(`await svc.forget(); return 'ok'`, 30_000)
    await collect(phone, joinScreens(VAULT, 'join choose', [PHONE, NARROW]))
    await collect(phone, joinScreens(EMPTY_VAULT, 'join upload', [PHONE, NARROW]))
    await collect(phone, `await closeSettings(); return {}`)

    // The desktop's rings on the join dialog with its three choices and its name field.
    await reloadAs(app(), false)
    await setWindowSize(app(), 1200, 900)
    await beforeSignIn()
    await collect(desktop, signInOnTab(liveServer().url, EMAIL, PASSWORD))
    await collect(desktop, joinScreens(VAULT, 'join choose desktop', [[1200, 900]]))
    await collect(desktop, `await closeSettings(); return {}`)

    // Last, since it takes the server away: a Disconnect nobody answers.
    await beforeSignIn()
    sync.run(`
      await svc.connect(${JSON.stringify(liveServer().url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
      await svc.chooseVault(${JSON.stringify(vaultId)}, ${JSON.stringify(DEVICE)}, null)
      return 'ok'
    `)
    await sync.waitIdle()
    await liveServer().kill()
    await sync.long('a Disconnect nobody answers', `await svc.disconnect(); return 'ok'`, 60_000)
    await collect(desktop, syncTabScreens('sync tab waiting desktop', 1, { forget: true }))
    await setWindowSize(app(), ...PHONE)
    await reloadAs(app(), true)
    await setWindowSize(app(), ...PHONE)
    await collect(phone, syncTabScreens('sync tab waiting', 2, { forget: true }))
    await setWindowSize(app(), ...NARROW)
    await collect(phone, syncTabScreens('sync tab waiting 320', 2, { forget: true }))

    const lines = Object.entries({ ...desktop, ...phone }).map(
      ([label, s]) => `  ${label.padEnd(40)} ${s.width}px ${s.shot || s.error}`
    )
    console.info(`\n${lines.join('\n')}\n`)
  }, 1_500_000)

  afterAll(async () => {
    try {
      if (vault !== null) {
        sync.frontAsIs()
        if (size[0]) await setWindowSize(app(), size[0], size[1])
        await reloadAs(app(), false).catch((error) =>
          console.warn(`desktop again: ${String(error)}`)
        )
        // The token kept to tell a server that is gone now: let go of it, and of the device.
        sync.run(
          `
          for (const one of [...svc.connection.value.pendingRevoke]) svc.forgetPendingRevoke(one.tokenId)
          await svc.forget()
          return 'ok'
        `,
          30_000
        )
      }
    } catch (error) {
      console.warn(`could not put the test window back: ${String(error)}`)
    }
    try {
      await vault?.dispose()
    } finally {
      await server?.kill()
      if (workspace !== '') rmSync(workspace, { recursive: true, force: true })
    }
    // Disposing the throwaway vault waits for other users of the app's pool to drain. That
    // wait is not sync work; it may outlast the default five-minute hook timeout.
  }, 700_000)

  /** Every screen asked for by name; the pages of the Sync tab after its first come on top. */
  const ON_PHONE = [
    'held deletes',
    'held deletes confirm',
    'settings arrived',
    'restore since hour',
    'restore since today',
    'restore since custom',
    'restore since confirm',
    'sync tab full',
    'sync tab full revoke confirm',
    'sync tab joining',
    'join transfer',
    'join reconnect',
    'join choose',
    'join upload',
    'sync tab waiting',
    'sync tab waiting forget confirm',
    'held deletes 320',
    'held deletes confirm 320',
    'settings arrived 320',
    'restore since hour 320',
    'restore since today 320',
    'restore since custom 320',
    'restore since confirm 320',
    'sync tab full 320',
    'sync tab full 320 revoke confirm',
    'join reconnect 320',
    'join choose 320',
    'join upload 320',
    'sync tab waiting 320',
    'sync tab waiting 320 forget confirm',
  ]
  const ON_DESKTOP = [
    'held deletes desktop',
    'held deletes confirm desktop',
    'settings arrived desktop',
    'restore since hour desktop',
    'restore since today desktop',
    'restore since custom desktop',
    'restore since confirm desktop',
    'sync tab full desktop',
    'sync tab full desktop revoke confirm',
    'join choose desktop',
    'sync tab waiting desktop',
    'sync tab waiting desktop forget confirm',
  ]
  const all = (): Record<string, Screen> => ({ ...phone, ...desktop })
  /** What each screen that failed a check says, one line per screen. */
  const offenders = (screens: Record<string, Screen>, check: (s: Screen) => unknown[]): string[] =>
    Object.entries(screens)
      .filter(([, s]) => s.error === '' && check(s).length > 0)
      .map(([label, s]) => `${label}: ${check(s).map(String).join('; ')}`)

  it('reaches every screen, at the width it meant to', () => {
    const failed = Object.entries(all())
      .filter(([, s]) => s.error !== '')
      .map(([label, s]) => `${label}: ${s.error}`)
    expect(failed).toEqual([])
    expect([...ON_PHONE, ...ON_DESKTOP].filter((label) => all()[label] === undefined)).toEqual([])
    for (const label of ON_PHONE)
      expect(phone[label]?.width, label).toBe(label.includes('320') ? NARROW[0] : PHONE[0])
  })

  it('puts nothing past the edge of a phone', () => {
    expect(offenders(phone, (s) => s.over)).toEqual([])
  })

  it('caps no box below the height of the sheet on a phone', () => {
    expect(offenders(phone, (s) => s.capped)).toEqual([])
  })

  it('cuts the focus ring off no field, on the phone or the desktop', () => {
    expect(offenders(all(), (s) => s.clipped)).toEqual([])
  })

  it('keeps every button of a dialog on the screen, and on top of what is under it', () => {
    expect(
      offenders(all(), (s) =>
        s.extra.buttons === undefined ||
        (s.extra.buttonsInView === s.extra.buttons && s.extra.onTop === true)
          ? []
          : [JSON.stringify(s.extra)]
      )
    ).toEqual([])
  })

  it.each(['held deletes confirm', 'held deletes confirm 320', 'held deletes confirm desktop'])(
    '%s: Cancel leaves the held-deletes sheet where it was',
    (label) => {
      expect(all()[label]?.extra.sheetStays).toBe(true)
    }
  )

  it('never shows held paths below the answer row', () => {
    for (const label of ['held deletes', 'held deletes 320', 'held deletes desktop']) {
      expect(all()[label]?.extra.visibleBelowActions, label).toBe(false)
    }
  })

  it('lists twenty held files and counts the rest', () => {
    expect(phone['held deletes']?.extra.more).toBe(`and ${HELD - 20} more`)
  })

  it('names App settings and both plugins in the settings question', () => {
    const lead = String(phone['settings arrived']?.extra.lead ?? '')
    expect(lead).toContain('App settings')
    expect(lead).toMatch(/2 plugins/)
  })

  it('keeps the restore-since row inside the dialog, its field and its button on the screen', () => {
    const rows = Object.keys(all()).filter(
      (label) => label.startsWith('restore since ') && !label.includes('confirm')
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const label of rows) {
      const extra = all()[label]?.extra ?? {}
      expect(extra.rowReach, `${label}: ${JSON.stringify(extra.reachers)}`).toBe(0)
      expect(extra.restoreInView, label).toBe(true)
      expect(extra.dateField, label).toBe(label.includes('custom'))
    }
  })

  it('gives no half of a Sync-tab row more room than it fills', () => {
    const tabs = Object.fromEntries(
      Object.entries(all()).filter(
        ([label]) => label.startsWith('sync tab') && !label.includes('confirm')
      )
    )
    expect(offenders(tabs, (s) => (s.extra.voids as string[] | undefined) ?? [])).toEqual([])
  })

  it('shows each section the state asks for', () => {
    const full = (phone['sync tab full']?.extra.sections as string[] | undefined) ?? []
    expect(full).toEqual(
      expect.arrayContaining(['This device', 'Deletions held back', 'Devices on this vault'])
    )
    expect(full.some((s) => s.startsWith('Settings waiting'))).toBe(true)
    expect(phone['sync tab joining']?.extra.sections).toContain('Choose how to join')
    expect(phone['sync tab waiting']?.extra.connectCard).toBe(true)
  })

  it('does not show join fields below the answer row on a narrow phone', () => {
    expect(phone['join choose 320']?.extra.visibleBelowActions).toBe(false)
  })

  it('asks the join question each way it can be asked', () => {
    expect(phone['join choose']?.extra.cards).toBe(3)
    expect(phone['join upload']?.extra.cards).toBe(0)
    expect(phone['join reconnect']?.extra.cards).toBe(0)
    expect(phone['join transfer']?.extra).toMatchObject({ name: false, cards: 3 })
    expect(String(phone['join choose']?.extra.lead)).toMatch(/both hold files/)
    expect(String(phone['join upload']?.extra.lead)).toMatch(/will be uploaded/)
  })

  it('sends a note made on a phone in front, with nothing else done', () => {
    expect(typeof pushed.inFront, String(pushed.inFront)).toBe('number')
    expect(pushed.inFront as number).toBeLessThan(10_000)
  })

  it('sends a note made right before the phone leaves the front', () => {
    expect(typeof pushed.leaving, String(pushed.leaving)).toBe('number')
  })
})
