/**
 * Many files deleted at once, and the ways back (phase 3b, decision 8), end to end: the running
 * Obsidian on one side, a daemon folder standing in for the other device, a real server between.
 *
 * - Sixty notes deleted here are held: the status bar says **Deletions held (60)**, the dialog
 *   asks, **Put them back** brings them back from the server, and nothing reaches the trash; the
 *   other device never loses them.
 * - Deleted again and answered **Delete everywhere**, confirmed, they go to the trash and off the
 *   other device.
 * - **Restore all deleted since** "the last hour" names sixty, asks, brings them back on both
 *   devices, and the notice counts them.
 * - Two rows of the deleted-files dialog pressed back to back: the second says **Queued**, and
 *   both come back (three-node B5).
 * - Paused: a hold answered on the Sync tab is filed, says it waits for **Resume**, and a second
 *   answer replaces the first; on Resume the files come back and nothing reaches the trash.
 * - **Sync now** while paused moves nothing and says so in the log (B6).
 * - A folder renamed on the other device leaves no empty folder here, and **Skip a folder** offers
 *   neither it nor a folder emptied here (B4).
 *
 * The window is behind whatever is in front, and the held-deletes question is only asked while
 * the app is in front; the suite says it is (`SyncDriver.inFront`) for its whole length.
 *
 * Requires Obsidian running with a vault open, the sibling repository built, and
 * `npm run build:test` newer than the source — see docs/Testing.md.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
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

const EMAIL = 'sync-deletes@example.com'
const PASSWORD = 'a-password-nobody-prints'
const HELD = 'Held'
const COUNT = 60
const NOTES: [string, string][] = Array.from({ length: COUNT }, (_, i) => {
  const n = String(i + 1).padStart(2, '0')
  return [`${HELD}/Note ${n}.md`, `note ${n}\n`]
})
/** Enough files besides the held ones that sixty is not the whole vault. */
const OTHERS: [string, string][] = Array.from({ length: 20 }, (_, i) => [
  `Kept/Other ${i + 1}.md`,
  `other ${i + 1}\n`,
])

const why = siblingMissing() ?? obsidianMissing()
if (why !== null) console.info(`\n  sync deletes e2e skipped: ${why}\n`)

let workspace = ''
let daemonDir = ''
let server: SyncServer | null = null
let vault: TestVault | null = null

const app = (): TestVault => {
  if (vault === null) throw new Error('the test vault was never opened')
  return vault
}
const sync = new SyncDriver(app)

const heldPaths = (): string[] => sync.filesUnder(HELD)
const trashedHeld = (): string[] => sync.trashPaths().filter((p) => p.startsWith(`${HELD}/`))
const onDaemon = (path: string): boolean => existsSync(join(daemonDir, path))

/** Deletes every held note here and syncs, which holds the deletions. */
async function deleteAllHeld(): Promise<void> {
  // Removing a folder emits one vault event per child. Keep the watcher from starting a sync
  // halfway through that burst, or the guard can judge a prefix instead of all sixty files.
  sync.run(`svc.pause(); return 'ok'`)
  try {
    sync.remove([HELD])
  } finally {
    sync.run(`svc.resume(); return 'ok'`)
  }
  const status = await sync.syncNow()
  expect(status.heldDeletes, sync.log().join('\n')).toBe(COUNT)
}

/** Waits for the held-deletes dialog, and reads its lead line. */
async function heldDialogLead(): Promise<string> {
  let lead = ''
  await waitFor(
    'the held-deletes dialog',
    () =>
      (lead = sync.run<string>(`
        const modal = modalOf('.abele-held-deletes')
        return modal ? textOf(modal.querySelector('.abele-held-deletes__lead')) : ''
      `)) !== '',
    20_000
  )
  return lead
}

/** Syncs until every held note is back here, or says how many are. */
async function heldComeBack(): Promise<void> {
  await waitFor(
    () => `the ${COUNT} notes to be back (${heldPaths().length} are)`,
    () => {
      if (heldPaths().length === COUNT) return true
      app().evalAwait(
        `(async () => { await ${'window.__abeleTest.SyncService.getInstance()'}.syncNow(); return 'ok' })()`
      )
      return heldPaths().length === COUNT
    },
    90_000
  )
}

describe.skipIf(why !== null)('many files deleted at once', () => {
  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'abele-sync-deletes-'))
    daemonDir = join(workspace, 'daemon')
    mkdirSync(daemonDir)
    server = await spawnSyncServer(workspace)
    server.createAccount(EMAIL, PASSWORD)
    initDaemon({
      dir: daemonDir,
      serverUrl: server.url,
      email: EMAIL,
      password: PASSWORD,
      vaultName: 'Deletes',
      deviceName: 'daemon',
    })
    const vaultId = daemonConfig(daemonDir).vaultId

    vault = await openTestVault()
    vault.run(['dev:errors', 'clear'], 20_000)
    sync.run(`
      await svc.connect(${JSON.stringify(server.url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
      await svc.chooseVault(${JSON.stringify(vaultId)}, 'obsidian')
      return 'ok'
    `)
    await sync.waitIdle()
    sync.inFront()
    sync.recordNotices()

    sync.createMany([...NOTES, ...OTHERS])
    await sync.syncNow()
    daemonSyncOnce(daemonDir)
    expect(onDaemon(`${HELD}/Note 60.md`)).toBe(true)
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

  it('holds sixty deletions, and Put them back brings the notes back with nothing in the trash', async () => {
    await deleteAllHeld()
    expect(sync.statusBar()).toBe(`Deletions held (${COUNT})`)
    expect(await heldDialogLead()).toContain(`${COUNT} files`)
    // The other device never heard of it.
    daemonSyncOnce(daemonDir)
    expect(onDaemon(`${HELD}/Note 01.md`)).toBe(true)

    sync.run(`
      await press(() => modalOf('.abele-held-deletes'), 'Put them back')
      if (!(await poll(() => !modalOf('.abele-held-deletes'), 20000))) throw new Error('the dialog stayed open')
      return 'ok'
    `)
    await heldComeBack()
    expect(sync.status().heldDeletes).toBe(0)
    expect(trashedHeld(), sync.log().join('\n')).toEqual([])
  })

  it('Delete everywhere, confirmed, sends them to the trash and off the other device', async () => {
    await deleteAllHeld()
    await heldDialogLead()
    sync.run(`
      await press(() => modalOf('.abele-held-deletes'), 'Delete everywhere')
      await press(() => modalOf('.abele-confirm'), 'Delete everywhere')
      if (!(await poll(() => !modalOf('.abele-held-deletes'), 20000))) throw new Error('the dialog stayed open')
      return 'ok'
    `)
    await sync.waitIdle()
    await waitFor(
      () => `the ${COUNT} notes in the trash (${trashedHeld().length} are)`,
      () => trashedHeld().length === COUNT,
      30_000
    )
    expect(sync.status().heldDeletes).toBe(0)
    daemonSyncOnce(daemonDir)
    expect(onDaemon(`${HELD}/Note 01.md`)).toBe(false)
    expect(onDaemon(`${HELD}/Note 60.md`)).toBe(false)
  })

  it('Restore all deleted since the last hour names them, asks, and brings them back on both devices', async () => {
    const preview = await sync.long<string>(
      'the deleted-files dialog and its restore',
      `
      app.commands.executeCommandById('abele:sync-deleted-files')
      if (!(await poll(() => document.querySelectorAll('.abele-deleted-files .abele-card').length >= ${COUNT}, 20000)))
        throw new Error('the trash never listed ${COUNT} files')
      const row = document.querySelector('.abele-restore-since')
      const preview = textOf(row.querySelector('.setting-item-description'))
      await press(row, 'Restore ${COUNT}…')
      await press(() => modalOf('.abele-confirm'), 'Restore')
      if (!(await poll(() => document.querySelectorAll('.abele-deleted-files .abele-card').length === 0, 60000)))
        throw new Error('the list still shows ' + document.querySelectorAll('.abele-deleted-files .abele-card').length)
      await escapeIn()
      return preview
      `,
      120_000
    )
    expect(preview).toContain(`${COUNT} files deleted since then`)
    expect(await sync.noticeSaying(`Restored ${COUNT};`)).toContain('0 failed')
    await heldComeBack()
    daemonSyncOnce(daemonDir)
    expect(onDaemon(`${HELD}/Note 01.md`)).toBe(true)
  })

  it('queues a second Restore pressed while the first runs, and brings both back', async () => {
    const two = [`${HELD}/Note 01.md`, `${HELD}/Note 02.md`]
    sync.remove(two)
    await sync.syncNow()
    const second = await sync.long<string>(
      'two Restores pressed back to back',
      `
      app.commands.executeCommandById('abele:sync-deleted-files')
      const cardOf = (path) => [...document.querySelectorAll('.abele-deleted-files .abele-card')].find(
        (c) => textOf(c.querySelector('.abele-card__name')) === path)
      if (!(await poll(() => cardOf(${JSON.stringify(two[0])}) && cardOf(${JSON.stringify(two[1])}), 20000)))
        throw new Error('the trash does not list both notes')
      const buttonOf = (path) => cardOf(path).querySelector('.abele-card__actions button')
      // Every word the second row's button shows, as it shows it: against a server on this
      // machine the first restore can be over, and the second under way, before a poll looks.
      const second = buttonOf(${JSON.stringify(two[1])})
      const said = []
      const watch = new MutationObserver(() => {
        const now = second.isConnected ? textOf(second) : 'gone'
        if (said[said.length - 1] !== now) said.push(now)
      })
      watch.observe(document.querySelector('.abele-deleted-files'), { childList: true, subtree: true, characterData: true })
      buttonOf(${JSON.stringify(two[0])}).click()
      second.click()
      const bothGone = await poll(() => !cardOf(${JSON.stringify(two[0])}) && !cardOf(${JSON.stringify(two[1])}), 60000)
      watch.disconnect()
      if (!bothGone) throw new Error('the two notes stayed in the list')
      await escapeIn()
      return said.join(' > ')
      `,
      120_000
    )
    // Pressed while the first ran, so it said Queued before it went ahead.
    expect(second.split(' > ')[0]).toBe('Queued')
    await sync.syncNow()
    expect(sync.exists(two[0])).toBe(true)
    expect(sync.exists(two[1])).toBe(true)
  })

  it('paused: an answer on the Sync tab waits for Resume, a second replaces it, and nothing reaches the trash', async () => {
    const trashedBefore = trashedHeld().length
    await deleteAllHeld()
    await heldDialogLead()
    sync.run(`await escapeIn(); svc.pause(); return 'ok'`)
    await sync.waitState('paused', 20_000)

    const decided = await sync.long<string>(
      'the held deletions answered twice on the Sync tab',
      `
      const root = await openSyncTab()
      const section = () => sectionTitled(root, 'Deletions held back')
      if (!(await poll(section, 10000))) throw new Error('the Sync tab has no "Deletions held back"')
      await press(section, 'Delete everywhere')
      await press(() => modalOf('.abele-confirm', root.ownerDocument), 'Delete everywhere')
      if (!(await poll(() => section() && section().querySelector('.abele-held-deletes__filed'), 20000)))
        throw new Error('the tab never said the answer was filed')
      const filed = textOf(section().querySelector('.abele-held-deletes__filed'))
      await press(section, 'Put them back')
      await sleep(500)
      await closeSettings()
      return filed
      `,
      120_000
    )
    expect(decided).toMatch(/Decided: delete everywhere \(60 files\).*resumed/)
    expect(await sync.noticeSaying('will be deleted everywhere when sync is resumed')).toContain(
      '60 files'
    )
    expect(await sync.noticeSaying('will come back when sync is resumed')).toContain('60 files')
    expect(heldPaths()).toEqual([])

    sync.run(`svc.resume(); return 'ok'`)
    await sync.waitIdle()
    await heldComeBack()
    expect(trashedHeld().length).toBe(trashedBefore)
  })

  it('Sync now while paused moves nothing, and the log says why', async () => {
    sync.run(`svc.pause(); return 'ok'`)
    sync.create('Paused/While paused.md', 'written while paused\n')
    sync.run(`await svc.syncNow(); return 'ok'`)
    expect(sync.log().some((line) => line.includes('sync is paused'))).toBe(true)
    expect(sync.serverPaths()).not.toContain('Paused/While paused.md')
    sync.run(`svc.resume(); return 'ok'`)
    await sync.syncNow()
    expect(sync.serverPaths()).toContain('Paused/While paused.md')
  })

  it('leaves no empty folder behind a rename on the other device, and offers no empty folder to skip', async () => {
    daemonSyncOnce(daemonDir)
    renameSync(join(daemonDir, 'Kept'), join(daemonDir, 'Kept renamed'))
    daemonSyncOnce(daemonDir)
    // A folder emptied here, by a delete made here, stays; it is not offered either.
    sync.create('Emptied here/Only file.md', 'about to go\n')
    await sync.syncNow()
    sync.remove(['Emptied here/Only file.md'])
    await sync.syncNow()

    const left = sync.run<{ kept: boolean; renamed: number; emptied: boolean }>(`
      const kids = (path) => {
        const folder = app.vault.getAbstractFileByPath(path)
        return folder && folder.children ? folder.children.length : -1
      }
      return { kept: !!app.vault.getAbstractFileByPath('Kept'), renamed: kids('Kept renamed'), emptied: !!app.vault.getAbstractFileByPath('Emptied here') }
    `)
    expect(left.kept).toBe(false)
    expect(left.renamed).toBe(OTHERS.length)
    expect(left.emptied).toBe(true)

    const offered = await sync.long<string[]>(
      'the folder picker on the Sync tab',
      `
      const root = await openSyncTab()
      const doc = root.ownerDocument
      const input = root.querySelector('input[placeholder="e.g. Archive/Video"]')
      if (!input) throw new Error('no "Skip a folder" field')
      input.focus()
      typeInto(input, 'e')
      await sleep(600)
      const items = [...doc.querySelectorAll('.suggestion-container .suggestion-item')].map(textOf)
      typeInto(input, '')
      await closeSettings()
      return items
      `,
      60_000
    )
    expect(offered).toContain('Kept renamed')
    expect(offered).not.toContain('Kept')
    expect(offered).not.toContain('Emptied here')
  })

  it('says nothing went wrong in the plugin while all that happened', () => {
    const captured = app().run(['dev:errors'], 20_000)
    expect(captured).not.toMatch(/plugin:abele|\/plugins\/abele\//)
  })
})
