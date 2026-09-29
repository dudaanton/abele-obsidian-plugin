/**
 * Settings that travel (phase 3b, decisions 5 and 11), end to end: the running Obsidian on one
 * side, a daemon folder standing in for another device, a real server between.
 *
 * - **Abele's own settings file syncs**: it reaches the server and the other device, the chat
 *   index beside it does not, and a setting changed on the other device is taken up here with a
 *   single reload — the log says so once — after which neither side has anything to send.
 * - **Obsidian's settings from another device wait**: a change to `app.json` made on the other
 *   device is not written here but asked about in **Settings changed on another device**.
 *   **Keep this device's** sends this device's file over it; **Later** leaves it on the Sync tab
 *   under **Settings waiting**, where **Apply and reload** writes it and reloads; **Reload now**
 *   in the dialog does the same. The reload is the test seam, `settingsPrompt.reloader`, counted
 *   rather than run: a real reload would take the test window's state with it (GUESS-19).
 * - **A local change before reloading wins**: a hotkey file changed here while another device's
 *   change to it waits goes out, and the log says it replaced the one that waited.
 *
 * The test vault's ignore file keeps the config folder out, as every sync suite's does, but lets
 * through the three files these cases need; the plugin's sixteen megabytes of `main.js` stay out.
 * The questions are asked only while the app is in front, which the suite says it is.
 *
 * Requires Obsidian running with a vault open, the sibling repository built, and
 * `npm run build:test` newer than the source — see docs/Testing.md.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
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
import { SyncDriver } from './helpers/syncDriver'

const EMAIL = 'sync-settings@example.com'
const PASSWORD = 'a-password-nobody-prints'
const OWN_SETTINGS = '.obsidian/plugins/abele/data.json'
const CHAT_INDEX = '.obsidian/plugins/abele/chat-index.json'
const APP_JSON = '.obsidian/app.json'
const HOTKEYS = '.obsidian/hotkeys.json'
const FROM_DAEMON = 'Tasks the other device chose'

const why = siblingMissing() ?? obsidianMissing()
if (why !== null) console.info(`\n  sync settings e2e skipped: ${why}\n`)

let workspace = ''
let daemonDir = ''
let server: SyncServer | null = null
let vault: TestVault | null = null

const app = (): TestVault => {
  if (vault === null) throw new Error('the test vault was never opened')
  return vault
}
const sync = new SyncDriver(app)

const here = (path: string): string => readFileSync(join(app().path, path), 'utf8')
const onDaemon = (path: string): string => readFileSync(join(daemonDir, path), 'utf8')

/**
 * Writes a file in the daemon's folder as the other device changing it, a little in the future
 * so the newer-mtime rule is never a coin toss against this device's copy, and syncs the daemon.
 */
function daemonWrites(path: string, text: string): void {
  const file = join(daemonDir, path)
  writeFileSync(file, text)
  const later = new Date(Date.now() + 5_000)
  utimesSync(file, later, later)
  daemonSyncOnce(daemonDir)
}

const tasksFolder = (): string =>
  app().evalAwait<string>('window.__abeleTest.AbeleConfig.getInstance().tasksFolder')

/** Syncs here until the settings question is open, and hands back its lead line. */
async function askedAboutSettings(): Promise<string> {
  let lead = ''
  await waitFor(
    'the "Settings changed on another device" dialog',
    () => {
      lead = sync.run<string>(`
        const modal = modalOf('.abele-staged-settings')
        if (!modal) { await svc.syncNow(); return '' }
        return textOf(modal.querySelector('.abele-staged-settings__lead'))
      `)
      return lead !== ''
    },
    60_000
  )
  return lead
}

/** The reload counted rather than run, from here on. */
function countReloads(): void {
  sync.run(`
    window.__abeleReloads = 0
    svc.settingsPrompt.reloader = {
      available: () => true,
      reload: () => { window.__abeleReloads++; return true },
    }
    return 'ok'
  `)
}

const reloads = (): number => app().evalAwait<number>('window.__abeleReloads ?? 0')

describe.skipIf(why !== null)('settings that travel between devices', () => {
  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'abele-sync-settings-'))
    daemonDir = join(workspace, 'daemon')
    mkdirSync(daemonDir)
    server = await spawnSyncServer(workspace)
    server.createAccount(EMAIL, PASSWORD)
    initDaemon({
      dir: daemonDir,
      serverUrl: server.url,
      email: EMAIL,
      password: PASSWORD,
      vaultName: 'Settings',
      deviceName: 'daemon',
    })
    const vaultId = daemonConfig(daemonDir).vaultId

    vault = await openTestVault()
    writeFileSync(
      join(vault.path, '.abele-sync-ignore'),
      ['.obsidian/', `!${APP_JSON}`, `!${HOTKEYS}`, `!${OWN_SETTINGS}`, ''].join('\n')
    )
    writeFileSync(join(vault.path, HOTKEYS), '{}\n')
    vault.run(['dev:errors', 'clear'], 20_000)
    sync.run(`
      await svc.connect(${JSON.stringify(server.url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
      await svc.chooseVault(${JSON.stringify(vaultId)}, 'obsidian')
      return 'ok'
    `)
    await sync.waitIdle()
    // The first sync after a join takes up Abele's own settings file; one more settles it.
    await sync.syncNow()
    sync.inFront()
    sync.recordNotices()
    daemonSyncOnce(daemonDir)
  }, 300_000)

  afterAll(async () => {
    try {
      if (vault !== null) {
        sync.frontAsIs()
        sync.run(`svc.resume(); await svc.forget(); return 'ok'`)
      }
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

  it("carries Abele's settings file to the other device, and not the chat index", () => {
    const paths = sync.serverPaths()
    expect(paths).toContain(OWN_SETTINGS)
    expect(paths).not.toContain(CHAT_INDEX)
    expect(JSON.parse(onDaemon(OWN_SETTINGS))).toMatchObject({ tasksFolder: tasksFolder() })
  })

  it('takes up a setting changed on the other device with one reload, and then settles', async () => {
    const before = sync.log().length
    const changed = { ...JSON.parse(onDaemon(OWN_SETTINGS)), tasksFolder: FROM_DAEMON }
    daemonWrites(OWN_SETTINGS, JSON.stringify(changed, null, 2))

    for (let tries = 0; tries < 10 && tasksFolder() !== FROM_DAEMON; tries++) {
      await sync.syncNow()
    }
    expect(tasksFolder()).toBe(FROM_DAEMON)
    const arrived = sync
      .log()
      .slice(before)
      .filter((line) => line.includes('Abele settings arrived from another device'))
    expect(arrived).toHaveLength(1)

    // Two more rounds on both sides, and nobody has anything to send: the reload wrote nothing
    // a serialisation apart from the other device's.
    await sync.syncNow()
    daemonSyncOnce(daemonDir)
    await sync.syncNow()
    const last = sync
      .log()
      // Each line opens with its time.
      .filter((line) => line.includes(' sync: done'))
      .pop()
    expect(last).toContain('pushed 0')
  })

  it("asks about Obsidian's settings from another device, and Keep this device's sends this one's", async () => {
    const ours = here(APP_JSON)
    daemonWrites(APP_JSON, JSON.stringify({ ...JSON.parse(ours), e2eFromDaemon: 1 }, null, 2))

    const lead = await askedAboutSettings()
    expect(lead).toContain('App settings')
    // Staged, not written: the file here is still this device's.
    expect(here(APP_JSON)).not.toContain('e2eFromDaemon')

    sync.run(`
      await press(() => modalOf('.abele-staged-settings'), "Keep this device's")
      if (!(await poll(() => !modalOf('.abele-staged-settings'), 20000))) throw new Error('the dialog stayed open')
      return 'ok'
    `)
    await sync.waitIdle()
    expect(sync.status().deferred ?? 0).toBe(0)
    daemonSyncOnce(daemonDir)
    expect(onDaemon(APP_JSON)).not.toContain('e2eFromDaemon')
    expect(JSON.parse(onDaemon(APP_JSON))).toEqual(JSON.parse(here(APP_JSON)))
  })

  it('leaves them waiting on the Sync tab after Later, where Apply and reload writes them and reloads', async () => {
    countReloads()
    daemonWrites(APP_JSON, JSON.stringify({ ...JSON.parse(here(APP_JSON)), e2eFromDaemon: 2 }))
    await askedAboutSettings()
    sync.run(`
      await press(() => modalOf('.abele-staged-settings'), 'Later')
      if (!(await poll(() => !modalOf('.abele-staged-settings'), 10000))) throw new Error('the dialog stayed open')
      return 'ok'
    `)
    expect(
      app().evalAwait<string>(
        `document.querySelector('.abele-sync-status')?.getAttribute('aria-label') ?? ''`
      )
    ).toContain('Settings waiting (1)')

    const waiting = await sync.long<boolean>(
      'the waiting settings on the Sync tab',
      `
      const root = await openSyncTab()
      const section = () => sectionTitled(root, 'Settings waiting (1)')
      if (!(await poll(section, 10000))) return false
      await press(section, 'Apply and reload')
      await poll(() => window.__abeleReloads > 0, 20000)
      await closeSettings()
      return true
      `,
      60_000
    )
    expect(waiting).toBe(true)
    expect(reloads()).toBe(1)
    expect(here(APP_JSON)).toContain('e2eFromDaemon')
    // The reload that did not happen here left the engine paused for it: take it up again.
    sync.run(`svc.resume(); return 'ok'`)
    await sync.waitIdle()
  })

  it('Reload now in the dialog writes what arrived and reloads, once', async () => {
    countReloads()
    daemonWrites(APP_JSON, JSON.stringify({ ...JSON.parse(here(APP_JSON)), e2eFromDaemon: 3 }))
    await askedAboutSettings()
    sync.run(`
      await press(() => modalOf('.abele-staged-settings'), 'Reload now')
      if (!(await poll(() => !modalOf('.abele-staged-settings'), 20000))) throw new Error('the dialog stayed open')
      return 'ok'
    `)
    await waitFor('the reload', () => reloads() > 0, 20_000)
    expect(reloads()).toBe(1)
    expect(JSON.parse(here(APP_JSON))).toMatchObject({ e2eFromDaemon: 3 })
    sync.run(`svc.resume(); return 'ok'`)
    await sync.waitIdle()
  })

  it("a settings file changed here while another device's change to it waits goes out, and says so", async () => {
    daemonWrites(
      HOTKEYS,
      JSON.stringify({ 'editor:toggle-bold': [{ modifiers: ['Mod'], key: 'J' }] })
    )
    await askedAboutSettings()
    sync.run(`await escapeIn(); return 'ok'`)
    const mine = JSON.stringify({ 'editor:toggle-italic': [{ modifiers: ['Mod'], key: 'K' }] })
    // Written the way Obsidian writes its own settings: through the adapter, under it.
    app().evalAwait(
      `app.vault.adapter.write(${JSON.stringify(HOTKEYS)}, ${JSON.stringify(mine)}).then(() => 'ok')`
    )
    await waitFor(
      () =>
        'the log to say this device replaced the change that waited (its lines on the file: ' +
        JSON.stringify(sync.log().filter((line) => line.includes('hotkeys'))) +
        ')',
      () => {
        app().evalAwait(
          `(async () => { await window.__abeleTest.SyncService.getInstance().syncNow(); return 'ok' })()`
        )
        return sync
          .log()
          .some((line) =>
            /your change to .*hotkeys\.json on this device replaced the one from/.test(line)
          )
      },
      60_000
    )
    expect(sync.status().deferred ?? 0).toBe(0)
    daemonSyncOnce(daemonDir)
    expect(onDaemon(HOTKEYS)).toBe(mine)
  })

  it('says nothing went wrong in the plugin while all that happened', () => {
    const captured = app().run(['dev:errors'], 20_000)
    expect(captured).not.toMatch(/plugin:abele|\/plugins\/abele\//)
  })
})
