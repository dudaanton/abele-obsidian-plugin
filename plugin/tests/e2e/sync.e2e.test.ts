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
 * The vault, the daemon folder, the database and the blobs all go away at the end, and the
 * device is disconnected before they do. Nothing outside them is written to: the vaults on
 * this machine belong to whoever is using it.
 *
 * Requires Obsidian running, and the sibling repository built — see docs/Testing.md.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  daemonConfig,
  daemonSyncOnce,
  initDaemon,
  siblingPath,
  siblingBuilt,
  spawnSyncServer,
  type SyncServer,
} from './helpers/syncServer'
import { obsidianRunning, openTestVault, waitFor, type TestVault } from './helpers/syncVault'

const EMAIL = 'obsidian-e2e@example.com'
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

const why = ((): string | null => {
  if (!siblingBuilt()) return `${siblingPath} has no built server and daemon`
  if (!obsidianRunning()) return 'Obsidian is not running, or its CLI is not answering'
  return null
})()
if (why !== null) console.info(`\n  sync e2e skipped: ${why}\n`)

interface SyncStatus {
  state: string
  pending: number
  lastError: string | null
}

interface StateEntry {
  fileId: string
  versionId: string
  sha: string
}

interface VersionInfo {
  version_id: string
  no: number
}

interface TrashItem {
  file_id: string
  path: string
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

const status = (): SyncStatus => app().evalJson<SyncStatus>(`${service}.status.value`)

/** Waits for the device to have nothing left in flight, and says what went wrong if it does. */
function waitIdle(): void {
  let last: SyncStatus = { state: 'unknown', pending: 0, lastError: null }
  waitFor(
    `the plugin to settle (last seen ${JSON.stringify(last)})`,
    () => {
      last = status()
      return last.state === 'idle'
    },
    120_000
  )
  expect(last.lastError).toBeNull()
}

/** A sync the test asked for, rather than one the watcher happened to start. */
function syncNow(): void {
  app().evalJson(`(async () => { await ${service}.syncNow(); return 'ok' })()`)
  waitIdle()
}

const read = (path: string): string =>
  app().evalJson<string>(
    `(async () => app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)})))()`
  )

const paths = (): string[] => app().evalJson<string[]>('app.vault.getFiles().map((f) => f.path)')

/** Appends to a note through Obsidian's own API, so the vault events fire as they would. */
const append = (path: string, text: string): void => {
  app().evalJson(
    `(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)})
      await app.vault.modify(file, (await app.vault.read(file)) + ${JSON.stringify(text)})
      return 'ok'
    })()`
  )
}

const onDisk = (path: string): string => readFileSync(join(daemonDir, path), 'utf8')

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

    vault = openTestVault()
    vault.cli(['dev:errors', 'clear'], 20_000)
    vault.evalJson(
      `(async () => {
        const sync = ${service}
        await sync.connect(${JSON.stringify(server.url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
        await sync.chooseVault(${JSON.stringify(vaultId)}, ${JSON.stringify(DEVICE)})
        return 'ok'
      })()`,
      120_000
    )
    waitIdle()
  }, 300_000)

  afterAll(async () => {
    try {
      if (vault !== null) {
        vault.evalJson(`(async () => { await ${service}.forget(); return 'ok' })()`, 60_000)
      }
    } catch (error) {
      console.warn(`could not disconnect the test device: ${String(error)}`)
    }
    try {
      vault?.dispose()
    } finally {
      await server?.kill()
      if (workspace !== '') rmSync(workspace, { recursive: true, force: true })
    }
  }, 300_000)

  it('carries a note made in Obsidian to the daemon folder', () => {
    app().evalJson(
      `(async () => { await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(FIRST_TEXT)}); return 'ok' })()`
    )
    syncNow()
    daemonSyncOnce(daemonDir)
    expect(onDisk(NOTE)).toBe(FIRST_TEXT)
  })

  it('merges an edit made on each side into both', () => {
    // The daemon's edit is made before it syncs, so it commits against the version it last
    // agreed with — which is what makes this a merge rather than two edits in a row.
    writeFileSync(join(daemonDir, NOTE), `zero\n${onDisk(NOTE)}`)
    append(NOTE, 'four\n')
    syncNow()
    daemonSyncOnce(daemonDir)
    syncNow()

    const merged = onDisk(NOTE)
    expect(merged).toContain('zero')
    expect(merged).toContain('four')
    expect(read(NOTE)).toBe(merged)
  })

  it('in conflict-file mode puts the second edit beside the first, in Obsidian too', () => {
    app().evalJson(
      `(async () => ${service}.client().updateSettings({ conflict: 'conflict-file' }))()`
    )
    writeFileSync(join(daemonDir, NOTE), 'the daemon says something else\n')
    append(NOTE, 'five\n')
    // Obsidian commits first and keeps the path; the daemon's bytes are the copy, named after
    // the device that sent them.
    syncNow()
    daemonSyncOnce(daemonDir)
    syncNow()

    const copy = paths().find((path) =>
      new RegExp(`^Note \\(Conflicted copy ${DAEMON_DEVICE} \\d{12}\\)\\.md$`).test(path)
    )
    expect(copy).toBeDefined()
    expect(read(copy ?? '')).toBe('the daemon says something else\n')
    expect(read(NOTE)).toContain('five')
  })

  it('carries a picture written in Obsidian to the daemon folder byte for byte', () => {
    app().evalJson(
      `(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(PNG_BASE64)}), (c) => c.charCodeAt(0))
        await app.vault.createFolder('Attachments').catch(() => undefined)
        await app.vault.createBinary(${JSON.stringify(PICTURE)}, bytes.buffer)
        return 'ok'
      })()`
    )
    syncNow()
    daemonSyncOnce(daemonDir)
    expect(readFileSync(join(daemonDir, PICTURE))).toEqual(Buffer.from(PNG_BASE64, 'base64'))
  })

  it('restores an older version of a note into the open vault', () => {
    const entry = app().evalJson<StateEntry>(
      `(async () => ${service}.entryFor(${JSON.stringify(NOTE)}))()`
    )
    expect(entry.fileId).not.toBe('')

    const versions = app().evalJson<VersionInfo[]>(
      `(async () => ${service}.client().versions(${JSON.stringify(entry.fileId)}))()`
    )
    const first = versions.find((version) => version.no === 1)
    expect(first).toBeDefined()

    app().evalJson(
      `(async () => ${service}.client().restore(${JSON.stringify(entry.fileId)}, ${JSON.stringify(first?.version_id ?? '')}))()`
    )
    syncNow()
    expect(read(NOTE)).toBe(FIRST_TEXT)
  })

  it('brings a note deleted in Obsidian back out of the trash', () => {
    const entry = app().evalJson<StateEntry>(
      `(async () => ${service}.entryFor(${JSON.stringify(NOTE)}))()`
    )
    app().evalJson(
      `(async () => { await app.vault.delete(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}), true); return 'ok' })()`
    )
    syncNow()
    expect(paths()).not.toContain(NOTE)

    const trash = app().evalJson<TrashItem[]>(`(async () => ${service}.client().trash())()`)
    expect(trash.map((item) => item.path)).toContain(NOTE)

    app().evalJson(
      `(async () => ${service}.client().restoreDeleted(${JSON.stringify(entry.fileId)}))()`
    )
    syncNow()
    expect(paths()).toContain(NOTE)
    expect(read(NOTE)).toBe(FIRST_TEXT)
  })

  it('says nothing went wrong in the app while all that happened', () => {
    const captured = app().cli(['dev:errors'], 20_000)
    expect(captured).not.toMatch(/abele/i)
  })
})
