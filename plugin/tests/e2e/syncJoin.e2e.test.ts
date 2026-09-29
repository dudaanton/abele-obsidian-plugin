/**
 * Joining a vault that already has files (phase 3b, decision 7), end to end: the running
 * Obsidian on one side, daemon folders filling the server's vaults on the other.
 *
 * Every case is the same shape. A daemon makes a vault on the server and fills it — a note both
 * sides will hold with other words in it, a note only the server holds. This vault holds the
 * same note with its own words, and a note of its own. Then it joins, one way or another, and
 * what each side ends up holding is read off both disks and off the server's history:
 *
 * - **the question itself** — only the server holds files: a download confirmation; only this
 *   vault: an upload confirmation; both: the choice; a vault this device synced to the end
 *   before: a reconnect;
 * - **Merge both** — the note keeps both texts, on both disks;
 * - **This device wins** — the note is this device's everywhere, the server's words are a
 *   version in its history; and Abele's own settings are the vault's, not this device's: the
 *   daemon's `tasksFolder` survives the join, and this device's settings file is in history;
 * - **The server wins**, answered in the join dialog itself — the sign-in card, a click on the
 *   vault, the choice, **Connect** — the note is the server's here, this device's words a
 *   version in history;
 * - **a transfer receipt** — a device a transfer connected syncs nothing, the status bar says
 *   **Choose how to join**, the Sync tab opens the dialog by itself, and answering it starts the
 *   sync.
 *
 * Nothing is stubbed, as in `sync.e2e.test.ts`, whose vault and cleanup this shares. The server
 * lets one address sign in ten times a minute and this file signs in about eight times, so the
 * sign-ins are spaced out (`beforeSignIn`); the file takes a couple of minutes for it.
 *
 * Requires Obsidian running with a vault open, the sibling repository built, and
 * `npm run build:test` newer than the source — see docs/Testing.md.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  daemonConfig,
  daemonSyncOnce,
  delay,
  initDaemon,
  siblingMissing,
  spawnSyncServer,
  type SyncServer,
} from './helpers/syncServer'
import { obsidianMissing, openTestVault, type TestVault } from './helpers/syncVault'
import { beforeSignIn, shaOf, SyncDriver } from './helpers/syncDriver'

const EMAIL = 'sync-join@example.com'
const PASSWORD = 'a-password-nobody-prints'
const DEVICE = 'obsidian'
const SHARED = 'Join/Shared.md'
const SERVER_ONLY = 'Join/Server only.md'
const LOCAL_ONLY = 'Join/Local only.md'
const SERVER_TEXT = 'the server wrote this line\n'
const LOCAL_TEXT = 'this device wrote this line\n'
/** Abele's own settings file, which syncs like any plugin's — and here, deliberately, does. */
const OWN_SETTINGS = '.obsidian/plugins/abele/data.json'
const DAEMON_TASKS = 'Tasks the daemon chose'

const why = siblingMissing() ?? obsidianMissing()
if (why !== null) console.info(`\n  sync join e2e skipped: ${why}\n`)

let workspace = ''
let server: SyncServer | null = null
let vault: TestVault | null = null

const app = (): TestVault => {
  if (vault === null) throw new Error('the test vault was never opened')
  return vault
}
const sync = new SyncDriver(app)

interface ServerVault {
  name: string
  dir: string
  id: string
}

/** Server vaults by name, each made and filled by a daemon folder of its own. */
const vaults: Record<string, ServerVault> = {}

/** A vault on the server holding `files`, put there by a daemon that made it. */
async function serverVault(name: string, files: Record<string, string>): Promise<ServerVault> {
  if (server === null) throw new Error('no server')
  const dir = join(workspace, name.replace(/[^a-z0-9]+/gi, '-'))
  mkdirSync(dir)
  await beforeSignIn()
  initDaemon({
    dir,
    serverUrl: server.url,
    email: EMAIL,
    password: PASSWORD,
    vaultName: name,
    deviceName: `daemon of ${name}`,
  })
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  if (Object.keys(files).length > 0) daemonSyncOnce(dir)
  const made = { name, dir, id: daemonConfig(dir).vaultId }
  vaults[name] = made
  return made
}

const onDaemon = (v: ServerVault, path: string): string => readFileSync(join(v.dir, path), 'utf8')

/** The join question the service would ask about a vault a sign-in listed: its kind. */
function questionKind(v: ServerVault): string {
  return sync.run<string>(`
    const listed = svc.__e2eListed || []
    const vault = listed.find((one) => one.id === ${JSON.stringify(v.id)})
    if (!vault) throw new Error('the sign-in did not list ${v.name}')
    return (await svc.joinQuestion(vault)).kind
  `)
}

/** Signs in through the service, as the sign-in card does, and keeps the vaults it listed. */
async function signIn(): Promise<void> {
  if (server === null) throw new Error('no server')
  await beforeSignIn()
  sync.run(`
    svc.__e2eListed = await svc.connect(${JSON.stringify(server.url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
    return 'ok'
  `)
}

/** Enrols on a vault the last sign-in listed, with the answer to the join question. */
async function enrolOn(v: ServerVault, prefer: 'mine' | 'theirs' | null): Promise<void> {
  sync.run(`
    await svc.chooseVault(${JSON.stringify(v.id)}, ${JSON.stringify(DEVICE)}, ${JSON.stringify(prefer)})
    return 'ok'
  `)
  await sync.waitIdle()
}

/** This vault as each case starts it: its own words in the shared note, and a note of its own. */
function localFiles(): void {
  sync.remove(['Join'])
  sync.createMany([
    [SHARED, LOCAL_TEXT],
    [LOCAL_ONLY, 'only on this device\n'],
  ])
}

const forget = (): void => {
  sync.run(`await svc.forget(); return 'ok'`)
}

/** Abele's `tasksFolder` as the running plugin holds it, not as the file says. */
const tasksFolder = (): string =>
  app().evalAwait<string>('window.__abeleTest.AbeleConfig.getInstance().tasksFolder')

describe.skipIf(why !== null)('joining a vault that already has files', () => {
  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'abele-sync-join-'))
    server = await spawnSyncServer(workspace)
    server.createAccount(EMAIL, PASSWORD)

    vault = await openTestVault()
    // Abele's own settings travel in this file, which the default ignore file keeps out with
    // the rest of the config folder; the plugin's sixteen megabytes of `main.js` stay out.
    writeFileSync(join(vault.path, '.abele-sync-ignore'), `.obsidian/\n!${OWN_SETTINGS}\n`)
    vault.run(['dev:errors', 'clear'], 20_000)

    const serverFiles = { [SHARED]: SERVER_TEXT, [SERVER_ONLY]: 'only on the server\n' }
    await serverVault('Join merge', serverFiles)
    await serverVault('Join mine', {
      ...serverFiles,
      // The other device's Abele settings: this device's own file, with one setting changed.
      [OWN_SETTINGS]: JSON.stringify({
        ...JSON.parse(readFileSync(join(vault.path, OWN_SETTINGS), 'utf8') || '{}'),
        tasksFolder: DAEMON_TASKS,
      }),
    })
    await serverVault('Join theirs', serverFiles)
    await serverVault('Join empty', {})
  }, 600_000)

  afterAll(async () => {
    try {
      if (vault !== null) forget()
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

  it('asks for a download, an upload or a choice, by which side holds files', async () => {
    await signIn()
    // Nothing in scope here yet: the vault holds only its config folder, which is kept out.
    expect(questionKind(vaults['Join merge'])).toBe('download')
    localFiles()
    expect(questionKind(vaults['Join empty'])).toBe('upload')
    expect(questionKind(vaults['Join merge'])).toBe('choose')
  })

  it('merges both: the note keeps both texts, on both disks', async () => {
    // The sign-in of the test before is still open; the choice is the one it asked.
    await enrolOn(vaults['Join merge'], null)
    const merged = sync.read(SHARED) ?? ''
    expect(merged).toContain('the server wrote this line')
    expect(merged).toContain('this device wrote this line')
    expect(sync.read(SERVER_ONLY)).toBe('only on the server\n')

    daemonSyncOnce(vaults['Join merge'].dir)
    expect(onDaemon(vaults['Join merge'], SHARED)).toBe(merged)
    expect(onDaemon(vaults['Join merge'], LOCAL_ONLY)).toBe('only on this device\n')
  })

  it('reconnects to a vault it synced to the end, asking nothing', async () => {
    sync.run(`await svc.disconnect(); return 'ok'`)
    await signIn()
    expect(questionKind(vaults['Join merge'])).toBe('reconnect')
    await enrolOn(vaults['Join merge'], null)
    expect(sync.status().state).toBe('idle')
    forget()
  })

  it("this device wins: its note everywhere, the server's in history, the vault's settings kept", async () => {
    localFiles()
    const before = tasksFolder()
    expect(before).not.toBe(DAEMON_TASKS)
    await signIn()
    expect(questionKind(vaults['Join mine'])).toBe('choose')
    await enrolOn(vaults['Join mine'], 'mine')

    expect(sync.read(SHARED)).toBe(LOCAL_TEXT)
    expect(sync.read(SERVER_ONLY)).toBe('only on the server\n')
    daemonSyncOnce(vaults['Join mine'].dir)
    expect(onDaemon(vaults['Join mine'], SHARED)).toBe(LOCAL_TEXT)
    expect(sync.versionShas(SHARED)).toContain(await shaOf(SERVER_TEXT))

    // Abele's settings file sat out the join and is taken up by the sync after it, the way a
    // first contact is: the vault's copy wins, whichever side was chosen for the notes.
    for (let tries = 0; tries < 20 && tasksFolder() !== DAEMON_TASKS; tries++) {
      await sync.syncNow()
      if (tasksFolder() !== DAEMON_TASKS) await delay(1_000)
    }
    expect(tasksFolder()).toBe(DAEMON_TASKS)
    expect(onDaemon(vaults['Join mine'], OWN_SETTINGS)).toContain(DAEMON_TASKS)
    // This device's own settings file is in the file's history, as the version that lost.
    expect(sync.versionShas(OWN_SETTINGS).length).toBeGreaterThanOrEqual(2)
    forget()
  })

  it("the server wins, answered in the join dialog: the server's note here, this device's in history", async () => {
    localFiles()
    if (server === null) throw new Error('no server')
    await beforeSignIn()
    const target = vaults['Join theirs']
    const answered = await sync.long<{ lead: string; chosen: boolean }>(
      'the sign-in, the vault and the join dialog',
      `
      const root = await openSyncTab()
      const doc = root.ownerDocument
      const card = root.querySelector('.abele-sync-settings')
      const url = card.querySelector('input[placeholder="https://sync.example.com"]')
      if (!url) throw new Error('the sign-in card is not showing')
      typeInto(url, ${JSON.stringify(server.url)})
      typeInto(card.querySelector('input[placeholder="you@example.com"]'), ${JSON.stringify(EMAIL)})
      typeInto(card.querySelector('input[type="password"]'), ${JSON.stringify(PASSWORD)})
      await press(card, 'Sign in')
      const vaultCard = () => [...card.querySelectorAll('.abele-card')].find(
        (c) => textOf(c.querySelector('.abele-card__name')) === ${JSON.stringify(target.name)})
      if (!(await poll(vaultCard, 20000))) throw new Error('the sign-in never listed ${target.name}')
      vaultCard().click()
      if (!(await poll(() => doc.querySelector('.abele-join-vault'), 20000))) throw new Error('the join dialog never opened')
      const dialog = doc.querySelector('.abele-join-vault')
      const lead = textOf(dialog.querySelector('.abele-join-vault__lead'))
      const option = [...dialog.querySelectorAll('.abele-card')].find(
        (c) => textOf(c.querySelector('.abele-card__name')) === 'The server wins')
      if (!option) throw new Error('the dialog offers no "The server wins"')
      option.click()
      await sleep(200)
      const chosen = option.classList.contains('abele-card_selected')
      typeInto(dialog.querySelector('input.abele-obsidian-input'), ${JSON.stringify(DEVICE)})
      await press(dialog, 'Connect')
      if (!(await poll(() => !doc.querySelector('.abele-join-vault'), 40000)))
        throw new Error('the join dialog stayed open: ' + textOf(dialog.querySelector('.abele-join-vault__error')))
      await closeSettings()
      return { lead, chosen }
      `,
      120_000
    )
    expect(answered.lead).toMatch(/both hold files/)
    expect(answered.chosen).toBe(true)
    await sync.waitIdle()

    expect(sync.read(SHARED)).toBe(SERVER_TEXT)
    expect(sync.read(LOCAL_ONLY)).toBe('only on this device\n')
    expect(sync.versionShas(SHARED)).toContain(await shaOf(LOCAL_TEXT))
    daemonSyncOnce(target.dir)
    expect(onDaemon(target, SHARED)).toBe(SERVER_TEXT)
    expect(onDaemon(target, LOCAL_ONLY)).toBe('only on this device\n')
  })

  it('a transfer receipt waits for the join question, and the Sync tab asks it', async () => {
    // The device a transfer would bring: a sibling of this one, on the vault it syncs now.
    const sibling = sync.run<Record<string, string>>(
      `return await svc.enrolSibling('receiver of a transfer')`
    )
    forget()
    sync.run(`
      const { maxFileBytes, ...shared } = svc.connection.value.selective
      await svc.adoptTransferred(${JSON.stringify({ ...sibling, token: undefined })}, ${JSON.stringify(sibling.token)}, shared)
      return 'ok'
    `)
    await sync.waitState('joining', 20_000)
    expect(sync.statusBar()).toBe('Choose how to join')

    const asked = await sync.long<{ section: boolean; kind: string }>(
      'the Sync tab and the join dialog it opens',
      `
      const root = await openSyncTab()
      const doc = root.ownerDocument
      const section = !!sectionTitled(root, 'Choose how to join')
      if (!(await poll(() => doc.querySelector('.abele-join-vault'), 20000)))
        throw new Error('the Sync tab never opened the join dialog')
      const dialog = doc.querySelector('.abele-join-vault')
      const options = dialog.querySelectorAll('.abele-card').length
      const merge = [...dialog.querySelectorAll('.abele-card')].find(
        (c) => textOf(c.querySelector('.abele-card__name')) === 'Merge both')
      if (merge) merge.click()
      await press(dialog, 'Connect')
      if (!(await poll(() => !doc.querySelector('.abele-join-vault'), 40000)))
        throw new Error('the join dialog stayed open')
      await closeSettings()
      return { section, kind: options === 3 ? 'choose' : 'confirm' }
      `,
      120_000
    )
    expect(asked.section).toBe(true)
    // Both sides hold the same files here — this vault synced them a moment ago — and a fresh
    // ledger still asks, since a transfer cannot know that.
    expect(asked.kind).toBe('choose')
    await sync.waitIdle()
    expect(sync.statusBar(), JSON.stringify(sync.status()) + '\n' + sync.log().join('\n')).toBe(
      'Fully synced'
    )
    expect(sync.read(SHARED)).toBe(SERVER_TEXT)
  })

  it('says nothing went wrong in the plugin while all that happened', () => {
    const captured = app().run(['dev:errors'], 20_000)
    expect(captured).not.toMatch(/plugin:abele|\/plugins\/abele\//)
  })
})
