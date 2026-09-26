/**
 * The sync screens on a phone, and their focus rings on the desktop.
 *
 * `phoneLayout.e2e.test.ts` measures the chat's dialogs in whatever vault the tier drives. The
 * sync dialogs cannot be measured there: a history, a trash and a log are only worth looking
 * at when they are long, and only a server makes them long. So this file makes a vault of its
 * own the way `sync.e2e.test.ts` does — a real server, an account, a device paired to it — and
 * fills it: one note with fifty versions, forty files deleted, a log with lines no phone is
 * wide enough for. Then it asks of each screen what the phone probe asks of the chat's:
 *
 * - nothing reaches past the right edge of the screen;
 * - one thing scrolls inside the body, and it reaches the bottom of it;
 * - no box is capped below the sheet by a height written for a desktop;
 * - a tall dialog stands the height of the screen;
 * - a card's Restore stays on the row of its title;
 * - no ancestor cuts the focus ring off a field — at 390 wide under the phone's emulation, and
 *   on the desktop.
 *
 * And a few things only these screens have: a diff that wraps inside its card rather than
 * reaching sideways; the restore's confirmation standing over the history sheet with both its
 * buttons on the screen; the log wrapping at 320 wide, the narrowest phone still sold; the
 * Sync tab both paired and not.
 *
 * A picture of every screen goes to `/tmp/abele-phone/`, beside the chat's. A measurement says
 * that nothing is wrong in the ways listed; a person looking at the picture says whether it is
 * right. Look at them.
 *
 * The phone is this window's alone. Obsidian keeps "emulate a phone" in one `localStorage` key
 * every window shares and reads it as a window starts; set and left set, it turned whichever
 * other window reloaded next into a phone. So the key is set for the few seconds this window
 * takes to reload, under the lock the rest of the tier takes for the same thing, and taken away
 * again after.
 *
 * Requires Obsidian running with a vault open, the sibling repository built, and
 * `npm run build:test` newer than the source — see docs/Testing.md.
 */
import { mkdirSync, mkdtempSync, rmSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  daemonConfig,
  delay,
  initDaemon,
  siblingMissing,
  spawnSyncServer,
  type SyncServer,
} from './helpers/syncServer'
import { obsidianMissing, openTestVault, waitFor, type TestVault } from './helpers/syncVault'
import { probePrelude, type Screen } from './helpers/layoutProbe'

const EMAIL = 'sync-phone@example.com'
const PASSWORD = 'a-password-nobody-prints'
const VAULT_NAME = 'PhoneProbe'
const SHOTS = '/tmp/abele-phone'
const PHONE = { width: 390, height: 844 }
/** The narrowest phone still in use: an iPhone SE of the first generation, and small Androids. */
const NARROW = 320

/** A note deep enough in folders that its path, above the list, has to wrap on a phone. */
const HISTORY_NOTE =
  'Sync probe/A folder with a name long enough to wrap on a phone/History of one note.md'
const VERSIONS = 50
const DELETED = 40

const why = siblingMissing() ?? obsidianMissing()
if (why !== null) console.info(`\n  sync phone probe skipped: ${why}\n`)

let workspace = ''
let server: SyncServer | null = null
let vault: TestVault | null = null
let size: [number, number] = [0, 0]
const phone: Record<string, Screen> = {}
const desktop: Record<string, Screen> = {}

const app = (): TestVault => {
  if (vault === null) throw new Error('the test vault was never opened')
  return vault
}

const service = 'window.__abeleTest.SyncService.getInstance()'

interface SyncStatus {
  state: string
  pending: number
  lastError: string | null
}

async function waitIdle(): Promise<void> {
  let last: SyncStatus = { state: 'unknown', pending: 0, lastError: null }
  await waitFor(
    () => `the plugin to settle (last seen ${JSON.stringify(last)})`,
    () => {
      last = app().evalAwait<SyncStatus>(`${service}.status.value`)
      if (last.state === 'error') throw new Error(`sync went wrong: ${last.lastError ?? '?'}`)
      return last.state === 'idle'
    },
    120_000
  )
}

/** One eval of a probe step: the prelude, then `body`, which returns a `Screen` or an object. */
const step = <T>(body: string): T =>
  app().evalAwait<T>(`(async () => {${probePrelude(SHOTS)}
    ${body}
  })()`)

// ─── the phone, for this window only ──────────────────────────────────────────────────────────

/** Obsidian's key, and this window's own wish, which its `sessionStorage` keeps over a reload. */
const MOBILE_KEY = 'EmulateMobile'
const MOBILE_WISH = 'abele-e2e-mobile'
/** The lock the rest of the tier holds while the shared key is set; see the file's comment. */
const RELOAD_LOCK = join(tmpdir(), 'abele-e2e-reload.lock')
const RELOAD_LOCK_STALE_MS = 120_000

async function takeReloadLock(): Promise<void> {
  const deadline = Date.now() + 5 * 60_000
  for (;;) {
    try {
      mkdirSync(RELOAD_LOCK)
      return
    } catch {
      try {
        if (Date.now() - statSync(RELOAD_LOCK).mtimeMs > RELOAD_LOCK_STALE_MS)
          rmdirSync(RELOAD_LOCK)
      } catch {
        /* gone in between */
      }
      if (Date.now() > deadline) throw new Error(`${RELOAD_LOCK} was not released in 5 minutes`)
      await delay(250)
    }
  }
}

const hasTestApi = (): boolean => {
  try {
    return app().evalRaw('String(typeof window.__abeleTest === "object")', 10_000) === 'true'
  } catch {
    return false
  }
}

/**
 * Reloads the test window as a phone or as a desktop, and waits for the plugin — and, on a
 * device that is paired, for its first sync after the reload.
 */
async function reloadAs(mobile: boolean, paired: boolean): Promise<void> {
  await takeReloadLock()
  try {
    app().evalRaw(
      `(() => {
        sessionStorage.setItem('${MOBILE_WISH}', '${mobile ? '1' : ''}')
        if (${mobile}) localStorage.setItem('${MOBILE_KEY}', '1')
        else localStorage.removeItem('${MOBILE_KEY}')
        setTimeout(() => location.reload(), 50)
        return 'ok'
      })()`,
      20_000
    )
    await delay(4000)
    await waitFor('the plugin to be back after the reload', hasTestApi, 60_000)
    app().evalRaw(`(() => { localStorage.removeItem('${MOBILE_KEY}'); return 'ok' })()`, 20_000)
  } finally {
    try {
      rmdirSync(RELOAD_LOCK)
    } catch {
      /* taken away as stale by another run */
    }
  }
  app().evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`,
    20_000
  )
  if (paired) await waitIdle()
}

const windowSize = (): [number, number] =>
  app().evalAwait<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`
  )

/** Resizes, then nudges by two pixels and back: a capture after a reload waits on a frame. */
async function setWindowSize(width: number, height: number): Promise<void> {
  app().evalRaw(
    `(() => {
      const w = require('@electron/remote').getCurrentWindow()
      w.setContentSize(${width + 2}, ${height + 2})
      setTimeout(() => w.setContentSize(${width}, ${height}), 300)
      return 'ok'
    })()`,
    20_000
  )
  await delay(1500)
}

// ─── seeding ──────────────────────────────────────────────────────────────────────────────────

/** Version `n` of the note: every version changes the long line and adds an item. */
const versionText = (n: number): string =>
  [
    '# History of one note',
    '',
    'This line stays the same in every version.',
    `A line long enough to run well past the width of a phone, so the diff has to wrap it rather than scroll sideways — revision ${n}, and a link with no space to break at: https://example.com/a/very/long/path/without/any/spaces/that/must/break/anywhere/revision-${n}`,
    '',
    ...Array.from({ length: n }, (_, i) => `- item ${i + 1}${i + 1 === n ? ' (newest)' : ''}`),
    '',
  ].join('\n')

async function seed(): Promise<void> {
  // Fifty versions: each one written and synced before the next, so each is a commit.
  app().evalAwait(
    `(async () => {
      const path = ${JSON.stringify(HISTORY_NOTE)}
      const dir = path.split('/').slice(0, -1).join('/')
      let at = ''
      for (const part of dir.split('/')) {
        at = at ? at + '/' + part : part
        if (!app.vault.getAbstractFileByPath(at)) await app.vault.createFolder(at)
      }
      await app.vault.create(path, ${JSON.stringify(versionText(1))})
      await ${service}.syncNow()
      return 'ok'
    })()`
  )
  await waitIdle()
  for (let from = 2; from <= VERSIONS; from += 10) {
    const texts = Array.from({ length: Math.min(10, VERSIONS - from + 1) }, (_, i) =>
      versionText(from + i)
    )
    app().evalAwait(
      `(async () => {
        const sync = ${service}
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(HISTORY_NOTE)})
        for (const text of ${JSON.stringify(texts)}) {
          await app.vault.modify(file, text)
          await sync.syncNow()
          for (let i = 0; i < 100 && sync.status.value.state !== 'idle'; i++) await new Promise((r) => setTimeout(r, 50))
        }
        return 'ok'
      })()`
    )
    await waitIdle()
  }

  // Forty files made, synced, and deleted: the trash, long, with paths of every length.
  const names = Array.from({ length: DELETED }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    if (i % 10 === 0)
      return `Sync probe/Trash/Deeper/Still deeper/A note whose name is long enough to wrap onto a second line on a phone ${n}.md`
    if (i % 10 === 5)
      return `Sync probe/Trash/an-attachment-name-with-no-spaces-at-all-that-has-to-break-somewhere-${n}.canvas`
    return `Sync probe/Trash/Deleted note ${n}.md`
  })
  app().evalAwait(
    `(async () => {
      for (const dir of ['Sync probe/Trash', 'Sync probe/Trash/Deeper', 'Sync probe/Trash/Deeper/Still deeper'])
        if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)
      for (const path of ${JSON.stringify(names)})
        await app.vault.create(path, path.endsWith('.canvas') ? '{"nodes":[],"edges":[]}' : 'A note that is about to be deleted: ' + path + '\\n')
      await ${service}.syncNow()
      return 'ok'
    })()`
  )
  await waitIdle()
  app().evalAwait(
    `(async () => {
      for (const path of ${JSON.stringify(names)}) await app.vault.delete(app.vault.getAbstractFileByPath(path), true)
      await ${service}.syncNow()
      return 'ok'
    })()`
  )
  await waitIdle()

  fillLog()
}

/**
 * The log is the service's memory, not a file: a reload empties it. So it is filled for each
 * window it is pictured in — lines of the lengths the engine writes, and two that no phone is
 * wide enough for, as a failure report carries them: a path with no space in it, and a server's
 * own long message.
 */
function fillLog(): void {
  app().evalAwait(
    `(async () => {
      const sync = ${service}
      for (let i = 1; i <= 24; i++)
        sync.note('sync: done (pulled 0, pushed ' + i + ', merged 0, conflicts 0, rejected 0, held 0)')
      sync.note('pull: could not write Sync-probe/an-attachment-name-with-no-spaces-at-all-that-has-to-break-somewhere/and-then-some-more-of-it.canvas')
      sync.note('push failed: the server answered 409 Conflict — the version this device based its change on is no longer the head of the file, so the change is sent again as a merge')
      return 'ok'
    })()`
  )
}

// ─── the screens ──────────────────────────────────────────────────────────────────────────────

/** Opens the history of the seeded note and waits for all fifty cards. */
const OPEN_HISTORY = `
  await closeDialog()
  window.__abeleTest.GlobalStore.getInstance().versionHistoryPath.value = ${JSON.stringify(HISTORY_NOTE)}
  if (!(await until(() => document.querySelectorAll('.abele-version-history .abele-card').length >= ${VERSIONS}, 20000)))
    throw new Error('the history never listed ${VERSIONS} versions: ' + document.querySelectorAll('.abele-version-history .abele-card').length)
  await wait(300)
  const modal = document.querySelector('.abele-version-history').closest('.modal')
  const body = modal.querySelector('.abele-modal__body')
  const cardNamed = (title) => [...modal.querySelectorAll('.abele-card')].find(
    (el) => el.querySelector('.abele-card__name')?.textContent.trim() === title)
`

/** The history, as it opens; then with an old version's diff expanded and scrolled to. */
const historyScreens = (suffix: string): string => `
  ${OPEN_HISTORY}
  const out = {}
  out['sync history' + ${JSON.stringify(suffix)}] = await screen('sync history' + ${JSON.stringify(suffix)}, modal, body)
  const card = cardNamed('#25')
  card.click()
  if (!(await until(() => card.querySelector('.abele-version-history__diff'), 10000)))
    throw new Error('the diff never opened: ' + (card.querySelector('.abele-version-history__note')?.textContent || 'nothing'))
  await wait(200)
  card.scrollIntoView({ block: 'start' })
  await wait(300)
  const label = 'sync history diff' + ${JSON.stringify(suffix)}
  out[label] = await screen(label, modal, body)
  const diff = card.querySelector('.abele-version-history__diff')
  out[label].extra = {
    diffReach: diff.scrollWidth - diff.clientWidth,
    diffRight: Math.round(diff.getBoundingClientRect().right - card.getBoundingClientRect().right),
  }
  await closeDialog()
  return out
`

/** The restore's confirmation, over the history sheet; then Cancel, which leaves the sheet. */
const CONFIRM_SCREEN = `
  ${OPEN_HISTORY}
  const card = cardNamed('#2')
  const restore = [...card.querySelectorAll('.abele-card__actions button')].find((b) => b.textContent.trim() === 'Restore')
  restore.click()
  if (!(await until(() => document.querySelector('.abele-confirm'), 5000))) throw new Error('no confirmation')
  await wait(300)
  const confirm = document.querySelector('.abele-confirm').closest('.modal')
  const entry = await screen('sync restore confirm', confirm, confirm)
  const inView = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1
  }
  const buttons = [...confirm.querySelectorAll('.abele-confirm__actions button')]
  // On top means the button is what a finger at its middle lands on, not the sheet under it.
  const onTop = buttons.every((b) => {
    const r = b.getBoundingClientRect()
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
    return !!hit && b.contains(hit)
  })
  entry.extra = { buttons: buttons.length, buttonsInView: buttons.filter(inView).length, onTop, dialogInView: inView(confirm) }
  buttons.find((b) => b.textContent.trim() === 'Cancel').click()
  await wait(400)
  entry.extra.sheetStays = !!document.querySelector('.abele-version-history') && !document.querySelector('.abele-confirm')
  await closeDialog()
  return { 'sync restore confirm': entry }
`

const deletedScreen = (suffix: string): string => `
  await closeDialog()
  app.commands.executeCommandById('abele:sync-deleted-files')
  if (!(await until(() => document.querySelectorAll('.abele-deleted-files .abele-card').length >= ${DELETED}, 20000)))
    throw new Error('the trash never listed ${DELETED} files: ' + document.querySelectorAll('.abele-deleted-files .abele-card').length)
  await wait(300)
  const modal = document.querySelector('.abele-deleted-files').closest('.modal')
  const label = 'sync deleted files' + ${JSON.stringify(suffix)}
  const out = { [label]: await screen(label, modal, modal.querySelector('.abele-modal__body')) }
  await closeDialog()
  return out
`

const logScreen = (suffix: string): string => `
  await closeDialog()
  app.commands.executeCommandById('abele:sync-log')
  if (!(await until(() => document.querySelectorAll('.abele-sync-log__line').length > 20, 10000)))
    throw new Error('the log never filled')
  await wait(300)
  const modal = document.querySelector('.abele-sync-log').closest('.modal')
  const label = 'sync log' + ${JSON.stringify(suffix)}
  const entry = await screen(label, modal, modal.querySelector('.abele-modal__body'))
  const feed = modal.querySelector('.abele-sync-log__feed')
  const copy = modal.querySelector('.abele-sync-log__head button')
  const r = copy.getBoundingClientRect()
  entry.extra = {
    feedReach: feed.scrollWidth - feed.clientWidth,
    copyInView: r.left >= 0 && r.right <= window.innerWidth + 1,
    lines: modal.querySelectorAll('.abele-sync-log__line').length,
  }
  await closeDialog()
  return { [label]: entry }
`

/**
 * The Sync tab: opened through the plugin's settings the way a person gets there — on a phone,
 * the list of pages and then Sync — and pictured from the top down, a screen at a time.
 */
const settingsScreen = (label: string, pages: number): string => `
  await closeDialog()
  app.setting.open()
  app.setting.openTabById('abele')
  await wait(800)
  const root = app.setting.activeTab.containerEl
  const tab = [...root.querySelectorAll('.abele-tabs__tab')].find((t) => t.textContent.trim() === 'Sync')
  if (!tab) throw new Error('no Sync tab')
  tab.click()
  if (!(await until(() => root.querySelector('.abele-sync-settings > *'), 5000))) throw new Error('the Sync tab is empty')
  await wait(800)
  const modal = root.closest('.modal') || root
  // The settings dialog scrolls its page itself; that page is what is pictured a screen at a time.
  const view = root.ownerDocument.defaultView
  const page = [root, ...root.querySelectorAll('*')].find((el) => {
    const s = view.getComputedStyle(el)
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1
  }) || root
  const out = {}
  out[${JSON.stringify(label)}] = await screen(${JSON.stringify(label)}, modal, root)
  out[${JSON.stringify(label)}].extra = { connectCard: root.textContent.includes('Connect to a server'), pageScrolls: page.scrollHeight > page.clientHeight + 1 }
  for (let i = 2; i <= ${pages} && page.scrollTop + page.clientHeight < page.scrollHeight - 1; i++) {
    page.scrollTop += page.clientHeight - 40
    await wait(300)
    out[${JSON.stringify(label)} + ' ' + i] = await screen(${JSON.stringify(label)} + ' ' + i, modal, root)
  }
  app.setting.close()
  await wait(400)
  return out
`

const collect = (into: Record<string, Screen>, body: string): void => {
  try {
    Object.assign(into, step<Record<string, Screen>>(body))
  } catch (error) {
    into[`failed: ${body.slice(0, 60).trim()}`] = {
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

describe.skipIf(why !== null)('the sync screens on a phone', () => {
  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'abele-sync-phone-'))
    const daemonDir = join(workspace, 'daemon')
    mkdirSync(daemonDir)
    server = await spawnSyncServer(workspace)
    server.createAccount(EMAIL, PASSWORD)
    initDaemon({
      dir: daemonDir,
      serverUrl: server.url,
      email: EMAIL,
      password: PASSWORD,
      vaultName: VAULT_NAME,
      deviceName: 'daemon',
    })
    const vaultId = daemonConfig(daemonDir).vaultId

    // Opening a vault starts a window, which reads the shared phone key as it starts.
    await takeReloadLock()
    try {
      vault = await openTestVault()
    } finally {
      try {
        rmdirSync(RELOAD_LOCK)
      } catch {
        /* taken as stale */
      }
    }
    vault.evalAwait(
      `(async () => {
        const sync = ${service}
        await sync.connect(${JSON.stringify(server.url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
        await sync.chooseVault(${JSON.stringify(vaultId)}, 'phone probe')
        return 'ok'
      })()`
    )
    await waitIdle()
    await seed()
    size = windowSize()

    // The desktop: rings only, in a window the size of a laptop's.
    await setWindowSize(1200, 900)
    collect(desktop, historyScreens(' desktop'))
    collect(
      desktop,
      CONFIRM_SCREEN.replace(/sync restore confirm/g, 'sync restore confirm desktop')
    )
    collect(desktop, deletedScreen(' desktop'))
    collect(desktop, logScreen(' desktop'))
    collect(desktop, settingsScreen('sync settings desktop', 1))

    // The phone.
    await setWindowSize(PHONE.width, PHONE.height)
    await reloadAs(true, true)
    fillLog()
    await setWindowSize(PHONE.width, PHONE.height)
    collect(phone, historyScreens(''))
    collect(phone, CONFIRM_SCREEN)
    collect(phone, deletedScreen(''))
    collect(phone, logScreen(''))
    collect(phone, settingsScreen('sync settings connected', 5))

    await setWindowSize(NARROW, PHONE.height)
    collect(phone, logScreen(' 320'))
    collect(phone, historyScreens(' 320'))
    collect(phone, deletedScreen(' 320'))

    await setWindowSize(PHONE.width, PHONE.height)
    app().evalAwait(`(async () => { await ${service}.disconnect(); return 'ok' })()`)
    await delay(500)
    collect(phone, settingsScreen('sync settings not connected', 2))

    const lines = Object.entries({ ...desktop, ...phone }).map(
      ([label, s]) => `  ${label.padEnd(34)} ${s.width}px ${s.shot || s.error}`
    )
    console.info(`\n${lines.join('\n')}\n`)
  }, 900_000)

  afterAll(async () => {
    try {
      if (vault !== null) {
        if (size[0]) await setWindowSize(size[0], size[1])
        await reloadAs(false, false).catch((error) =>
          console.warn(`desktop again: ${String(error)}`)
        )
        vault.evalAwait(`(async () => { await ${service}.forget(); return 'ok' })()`)
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
  }, 300_000)

  const PHONE_SCREENS = [
    'sync history',
    'sync history diff',
    'sync restore confirm',
    'sync deleted files',
    'sync log',
    'sync settings connected',
    'sync log 320',
    'sync history 320',
    'sync history diff 320',
    'sync deleted files 320',
    'sync settings not connected',
  ]
  /** The tall dialogs, which stand as a sheet with one list scrolling in it. */
  const SHEETS = PHONE_SCREENS.filter((s) => /history|deleted|log/.test(s))
  const DESKTOP_SCREENS = [
    'sync history desktop',
    'sync history diff desktop',
    'sync restore confirm desktop',
    'sync deleted files desktop',
    'sync log desktop',
    'sync settings desktop',
  ]

  it('reaches every screen', () => {
    const failed = Object.entries({ ...phone, ...desktop })
      .filter(([, s]) => s.error !== '')
      .map(([label, s]) => `${label}: ${s.error}`)
    expect(failed).toEqual([])
    for (const label of [...PHONE_SCREENS, ...DESKTOP_SCREENS])
      expect(phone[label] ?? desktop[label], label).toBeDefined()
  })

  it('measures at the widths it meant to', () => {
    for (const label of PHONE_SCREENS)
      expect(phone[label]?.width, label).toBe(label.endsWith('320') ? NARROW : PHONE.width)
  })

  it.each(PHONE_SCREENS)('%s: nothing reaches past the edge of the screen', (label) => {
    expect(phone[label]?.over ?? ['no report']).toEqual([])
  })

  it.each(SHEETS)('%s: one thing scrolls inside the body, and it reaches the bottom', (label) => {
    const scrollers = phone[label]?.scrollers ?? []
    expect(scrollers.length, JSON.stringify(scrollers)).toBeLessThanOrEqual(1)
    for (const s of scrollers)
      expect(s.spare, `${s.name} leaves ${s.spare}px blank under it`).toBeLessThanOrEqual(24)
  })

  it.each(PHONE_SCREENS)('%s: no box is capped below the height of the sheet', (label) => {
    expect(phone[label]?.capped ?? ['no report']).toEqual([])
  })

  it.each(SHEETS)('%s: the sheet stands the height of the screen', (label) => {
    expect(phone[label]?.fill ?? 0).toBeGreaterThanOrEqual(0.85)
  })

  it.each(PHONE_SCREENS.filter((s) => /history|deleted/.test(s)))(
    '%s: every card keeps Restore on the row of its title',
    (label) => {
      expect(phone[label]?.stranded ?? ['no report']).toEqual([])
    }
  )

  it.each([...PHONE_SCREENS, ...DESKTOP_SCREENS])(
    '%s: nothing cuts the focus ring off any field',
    (label) => {
      expect((phone[label] ?? desktop[label])?.clipped ?? ['no report']).toEqual([])
    }
  )

  it.each(['sync history diff', 'sync history diff 320', 'sync history diff desktop'])(
    '%s: the diff wraps inside its card rather than reaching sideways',
    (label) => {
      const extra = (phone[label] ?? desktop[label])?.extra ?? {}
      expect(extra.diffReach, JSON.stringify(extra)).toBe(0)
      expect(extra.diffRight as number, JSON.stringify(extra)).toBeLessThanOrEqual(0)
    }
  )

  it.each(['sync log', 'sync log 320'])(
    '%s: every line wraps, and Copy is on the screen',
    (label) => {
      const extra = phone[label]?.extra ?? {}
      expect(extra.feedReach, JSON.stringify(extra)).toBe(0)
      expect(extra.copyInView, JSON.stringify(extra)).toBe(true)
    }
  )

  it.each(['sync restore confirm', 'sync restore confirm desktop'])(
    '%s: stands over the history with both buttons on the screen, and Cancel leaves the history',
    (label) => {
      const extra = (phone[label] ?? desktop[label])?.extra ?? {}
      expect(extra, JSON.stringify(extra)).toMatchObject({
        buttons: 2,
        buttonsInView: 2,
        onTop: true,
        dialogInView: true,
        sheetStays: true,
      })
    }
  )

  it('shows the paired tab to a paired device, and the sign-in to one that is not', () => {
    expect(phone['sync settings connected']?.extra.connectCard).toBe(false)
    expect(phone['sync settings not connected']?.extra.connectCard).toBe(true)
  })
})
