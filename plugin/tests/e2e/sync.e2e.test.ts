/**
 * Sync, end to end: the running Obsidian on one side, a daemon folder on the other, a real
 * server in between, and assertions on the bytes each side ends up holding.
 *
 * Nothing here is stubbed. The plugin is this branch's build, installed into a vault made for
 * the run and opened in the Obsidian that is running on this machine; the server and the
 * daemon are the sibling repository's own `dist`. The device is paired the way the settings
 * screen pairs one — `connect` then `chooseVault` on the plugin's own service — because a
 * test that wrote the token into `data.json` itself would prove only that the engine works
 * when somebody else does the enrolling.
 *
 * The two restores go through the dialogs a person uses — the file list's context menu and
 * the deleted-files command, the Restore button, the confirmation — and are read off the
 * editor. The component tests mock the server; this is the one place the dialogs meet a real
 * one, and a restore sent straight to the client from here would test the server instead.
 *
 * The vault, the daemon folder, the database and the blobs all go away at the end, and the
 * device is disconnected before they do. Nothing outside them is written to: the vaults on
 * this machine belong to whoever is using it.
 *
 * Requires Obsidian running with a vault open, the sibling repository built, and
 * `npm run build:test` newer than the source — see docs/Testing.md.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const EMAIL = 'sync-e2e@example.com'
const PASSWORD = 'a-password-nobody-prints'
const VAULT_NAME = 'ObsidianE2E'
const DEVICE = 'obsidian'
const DAEMON_DEVICE = 'daemon'
const NOTE = 'Note.md'
const PICTURE = 'Attachments/pixels.png'
/** What the note says when it is made, and what a restore of its first version brings back. */
const FIRST_TEXT = 'one\ntwo\nthree\n'
/** A real PNG — header, IHDR, IDAT, IEND — small enough to compare byte for byte in a test. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAIAAADZF8uwAAABx0lEQVR42gG8AUP+AKVNyhglMLsdbRMs3tYjey7ZHj9yH8sZcRdElNZJPJ1cNGC+MQAgHmn+2qDu6LmZf1x8KZn9r+WTJTzWVK9N+tcUJ6Cus/7pIy8AivIhH57kkcWxC+y1Vjv8Hm+TQn7LyP4pVeXNjkbcjtS3wnZNACpaTXZ3BvhdhpACSta9o0Ab6cjLzMk19s0fYSJq4VM4rho0AABNM7oNJGrATIGxuvI+O/nu9fefK0k0r4f1UgtpuUsNmC6Fu1UAtnKocmN6zXRm/LYODo/xhGOw5LK6KXA0dPBkrGj3APWwKz3GAGb0W96qLMrtzStRV0EOTe5K8rNPQwoHNEfeY2wOgGyVe6aE1gBDH7Xq10JNCeFdAkxYSPI9H6b3Nh1/YY0VMucOIOKmZo3n9H4AhGflRtU+yOKhJXvbJWybPk+7SYFG73Awy/lTclLczq3XZLajAC+7Ca3q4QnEqZcgOXU1K4eLFFyKQtiEz0z9py2OHV3ZJYkILQCFKnEihz7oBa3ViUIWejhShhlcZ5+caZTkW4qxCYASBwlh830A5Dbd/cmdbnWvZUfPsRtCBySC3FMcK8OQfJYX615QieQBhrqoqnLSr+FIv5IAAAAASUVORK5CYII='

const why = siblingMissing() ?? obsidianMissing()
if (why !== null) console.info(`\n  sync e2e skipped: ${why}\n`)

interface SyncStatus {
  state: string
  pending: number
  lastError: string | null
}

let workspace = ''
let daemonDir = ''
let server: SyncServer | null = null
let vault: TestVault | null = null
let vaultId = ''

/** The vault, or a failure that says the setup did not get far enough to have one. */
const app = (): TestVault => {
  if (vault === null) throw new Error('the test vault was never opened')
  return vault
}

const service = 'window.__abeleTest.SyncService.getInstance()'

const status = (): SyncStatus => app().evalAwait<SyncStatus>(`${service}.status.value`)

/**
 * Waits for the device to have nothing left in flight, and says what went wrong if it does.
 *
 * `error` and `offline` end the wait at once: neither clears itself inside a test's budget,
 * and waiting two minutes to report one is two minutes spent learning nothing.
 */
async function waitIdle(): Promise<void> {
  let last: SyncStatus = { state: 'unknown', pending: 0, lastError: null }
  await waitFor(
    () => `the plugin to settle (last seen ${JSON.stringify(last)})`,
    () => {
      last = status()
      if (last.state === 'error' || last.state === 'offline') {
        throw new Error(`sync went ${last.state}: ${last.lastError ?? 'no reason given'}`)
      }
      return last.state === 'idle'
    },
    120_000
  )
  expect(last.lastError).toBeNull()
}

/** A sync the test asked for, rather than one the watcher happened to start. */
async function syncNow(): Promise<void> {
  app().evalAwait(`(async () => { await ${service}.syncNow(); return 'ok' })()`)
  await waitIdle()
}

const read = (path: string): string =>
  app().evalAwait<string>(
    `app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))`
  )

const paths = (): string[] => app().evalAwait<string[]>('app.vault.getFiles().map((f) => f.path)')

/** Appends to a note through Obsidian's own API, so the vault events fire as they would. */
const append = (path: string, text: string): void => {
  app().evalAwait(
    `(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)})
      await app.vault.modify(file, (await app.vault.read(file)) + ${JSON.stringify(text)})
      return 'ok'
    })()`
  )
}

const onDisk = (path: string): string => readFileSync(join(daemonDir, path), 'utf8')

/**
 * Runs a piece of DOM work in the test window and returns what it said.
 *
 * Clicks are `element.click()` from inside the page, not a pointer: the window sits behind
 * whatever the person is working in, and nothing here needs it in front.
 */
const dom = <T>(body: string): T => app().evalAwait<T>(`(() => { ${body} })()`)

/**
 * Presses a button inside the dialog whose body carries `dialog`, on the card titled `card`.
 * Says why it could not, rather than returning quietly, so a wait on it can report that.
 */
function pressRestore(dialog: string, card: string): string {
  return dom<string>(`
    const root = document.querySelector(${JSON.stringify(dialog)})
    if (!root) return 'no dialog'
    const row = [...root.querySelectorAll('.abele-card')].find(
      (el) => el.querySelector('.abele-card__name')?.textContent.trim() === ${JSON.stringify(card)}
    )
    if (!row) return 'no card ' + ${JSON.stringify(card)}
    const button = [...row.querySelectorAll('.abele-card__actions button')].find(
      (el) => el.textContent.trim() === 'Restore'
    )
    if (!button) return 'no Restore button'
    if (button.disabled) return 'Restore is disabled'
    button.click()
    return 'pressed'
  `)
}

/** Whether the dialog whose body carries `dialog` lists a card titled `card`. */
const hasCard = (dialog: string, card: string): boolean =>
  dom<boolean>(`
    return [...document.querySelectorAll(${JSON.stringify(`${dialog} .abele-card__name`)})].some(
      (el) => el.textContent.trim() === ${JSON.stringify(card)}
    )
  `)

/** The error line a dialog shows above its list, or null while it shows none. */
const dialogError = (selector: string): string | null =>
  dom<string | null>(
    `return document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`
  )

/**
 * Opens a note in an editor tab the way a click in the file list would, and hands back what
 * that editor shows — the text a person sees, not what the vault would say if asked.
 */
function openInEditor(path: string): void {
  app().evalAwait(
    `(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)})
      await app.workspace.getLeaf(false).openFile(file)
      return 'ok'
    })()`
  )
}

const editorText = (path: string): string | null =>
  dom<string | null>(`
    const leaf = app.workspace
      .getLeavesOfType('markdown')
      .find((l) => l.view.file?.path === ${JSON.stringify(path)})
    return leaf ? leaf.view.editor.getValue() : null
  `)

/** Waits for the editor on `path` to show `text`, and says what it showed when it never did. */
async function editorShows(path: string, text: string): Promise<void> {
  let last: string | null = null
  await waitFor(
    () =>
      `the editor on ${path} to show ${JSON.stringify(text)} (it shows ${JSON.stringify(last)})`,
    () => (last = editorText(path)) === text,
    20_000
  )
}

describe.skipIf(why !== null)('sync between Obsidian and a daemon folder', () => {
  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'abele-sync-e2e-'))
    daemonDir = join(workspace, 'daemon')
    mkdirSync(daemonDir)

    server = await spawnSyncServer(workspace)
    server.createAccount(EMAIL, PASSWORD)
    // The daemon enrols first and makes the vault; the plugin joins the one it made, which is
    // how a second device is added in real life.
    initDaemon({
      dir: daemonDir,
      serverUrl: server.url,
      email: EMAIL,
      password: PASSWORD,
      vaultName: VAULT_NAME,
      deviceName: DAEMON_DEVICE,
    })
    vaultId = daemonConfig(daemonDir).vaultId

    vault = await openTestVault()
    vault.run(['dev:errors', 'clear'], 20_000)
    vault.evalAwait(
      `(async () => {
        const sync = ${service}
        await sync.connect(${JSON.stringify(server.url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
        await sync.chooseVault(${JSON.stringify(vaultId)}, ${JSON.stringify(DEVICE)})
        return 'ok'
      })()`
    )
    await waitIdle()
  }, 300_000)

  afterAll(async () => {
    try {
      if (vault !== null) {
        vault.evalAwait(`(async () => { await ${service}.forget(); return 'ok' })()`)
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

  it('carries a note made in Obsidian to the daemon folder', async () => {
    app().evalAwait(
      `(async () => { await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(FIRST_TEXT)}); return 'ok' })()`
    )
    await syncNow()
    daemonSyncOnce(daemonDir)
    expect(onDisk(NOTE)).toBe(FIRST_TEXT)
  })

  it('merges an edit made on each side into both', async () => {
    // The daemon's edit is made before it syncs, so it commits against the version it last
    // agreed with — which is what makes this a merge rather than two edits in a row.
    writeFileSync(join(daemonDir, NOTE), `zero\n${onDisk(NOTE)}`)
    append(NOTE, 'four\n')
    await syncNow()
    daemonSyncOnce(daemonDir)
    await syncNow()

    const merged = onDisk(NOTE)
    expect(merged).toContain('zero')
    expect(merged).toContain('four')
    expect(read(NOTE)).toBe(merged)
  })

  it('in conflict-file mode puts the second edit beside the first, in Obsidian too', async () => {
    app().evalAwait(`${service}.client().updateSettings({ conflict: 'conflict-file' })`)
    writeFileSync(join(daemonDir, NOTE), 'the daemon says something else\n')
    append(NOTE, 'five\n')
    // Obsidian commits first and keeps the path; the daemon's bytes are the copy, named after
    // the device that sent them.
    await syncNow()
    daemonSyncOnce(daemonDir)
    await syncNow()

    const copy = paths().find((path) =>
      new RegExp(`^Note \\(Conflicted copy ${DAEMON_DEVICE} \\d{12}\\)\\.md$`).test(path)
    )
    expect(copy).toBeDefined()
    expect(read(copy ?? '')).toBe('the daemon says something else\n')
    expect(read(NOTE)).toContain('five')
  })

  it('carries a picture written in Obsidian to the daemon folder byte for byte', async () => {
    app().evalAwait(
      `(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(PNG_BASE64)}), (c) => c.charCodeAt(0))
        await app.vault.createFolder('Attachments').catch(() => undefined)
        await app.vault.createBinary(${JSON.stringify(PICTURE)}, bytes.buffer)
        return 'ok'
      })()`
    )
    await syncNow()
    daemonSyncOnce(daemonDir)
    expect(readFileSync(join(daemonDir, PICTURE))).toEqual(Buffer.from(PNG_BASE64, 'base64'))
  })

  it('restores an older version through the history dialog, and the editor shows it', async () => {
    // The note open in an editor first, as it would be for somebody undoing an edit in it.
    openInEditor(NOTE)
    expect(editorText(NOTE)).toContain('five')

    // The file list's context menu, where a person finds "Open version history (Abele)".
    let menu = ''
    await waitFor(
      () => `the file menu to offer version history (${menu})`,
      () =>
        (menu = dom<string>(`
          if (!document.querySelector('.menu')) {
            const row = document.querySelector('.nav-file-title[data-path=${JSON.stringify(NOTE)}]')
            if (!row) return 'no row for the note in the file list'
            const box = row.getBoundingClientRect()
            row.dispatchEvent(new MouseEvent('contextmenu', {
              bubbles: true, cancelable: true, clientX: box.left + 5, clientY: box.top + 5,
            }))
          }
          const item = [...document.querySelectorAll('.menu .menu-item')].find(
            (el) => el.querySelector('.menu-item-title')?.textContent.trim() === 'Open version history (Abele)'
          )
          if (!item) return 'the menu has no "Open version history (Abele)"'
          item.click()
          return 'clicked'
        `)) === 'clicked',
      10_000
    )

    // Version #1 is the note as it was made; the list is read from the server when it opens.
    let pressed = ''
    await waitFor(
      () => `Restore on version #1 (${pressed})`,
      () => (pressed = pressRestore('.abele-version-history', '#1')) === 'pressed',
      20_000
    )
    let confirmed = ''
    await waitFor(
      () => `the confirmation (${confirmed})`,
      () =>
        (confirmed = dom<string>(`
          const button = document.querySelector('.abele-confirm__actions button.mod-warning')
          if (!button) return 'no confirmation'
          button.click()
          return 'confirmed'
        `)) === 'confirmed',
      10_000
    )

    // The dialog closes itself once the restore is applied and pulled; a refusal stays in it
    // as a line above the list, and is the failure to report rather than a text mismatch later.
    await waitFor(
      'the history dialog to close',
      () => {
        const refused = dialogError('.abele-version-history__error')
        if (refused !== null) throw new Error(refused)
        return !dom<boolean>(`return !!document.querySelector('.abele-version-history')`)
      },
      60_000
    )
    await waitIdle()
    await editorShows(NOTE, FIRST_TEXT)
  })

  it('brings a note deleted in Obsidian back through the deleted-files dialog', async () => {
    app().evalAwait(
      `(async () => { await app.vault.delete(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}), true); return 'ok' })()`
    )
    await syncNow()
    expect(paths()).not.toContain(NOTE)

    expect(
      app().evalAwait<boolean>(`app.commands.executeCommandById('abele:sync-deleted-files')`)
    ).toBe(true)
    let pressed = ''
    await waitFor(
      () => `Restore on ${NOTE} in the trash (${pressed})`,
      () => (pressed = pressRestore('.abele-deleted-files', NOTE)) === 'pressed',
      20_000
    )
    // The row leaves the list once the file is back; a refusal stays as a line above it.
    await waitFor(
      'the note to leave the trash',
      () => {
        const refused = dialogError('.abele-deleted-files__error')
        if (refused !== null) throw new Error(refused)
        return !hasCard('.abele-deleted-files', NOTE)
      },
      60_000
    )
    dom(`
      document.querySelector('.abele-deleted-files')?.closest('.modal')
        ?.querySelector('.modal-close-button')?.click()
      return 'ok'
    `)
    await waitIdle()

    expect(paths()).toContain(NOTE)
    openInEditor(NOTE)
    await editorShows(NOTE, FIRST_TEXT)
  })

  it('says nothing went wrong in the plugin while all that happened', () => {
    // The plugin's own traces, not the word: the vault is called abele-sync-e2e-…, and an
    // error that merely mentioned its path would otherwise count.
    const captured = app().run(['dev:errors'], 20_000)
    expect(captured).not.toMatch(/plugin:abele|\/plugins\/abele\//)
  })
})
