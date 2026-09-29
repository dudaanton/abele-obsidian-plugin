/**
 * Driving the sync side of a test vault: the service's status and verbs, the vault's files, the
 * dialogs a person answers, and the few things a window behind the others cannot do by itself.
 *
 * `sync.e2e.test.ts` grew these one at a time inside itself. The suites that came with phase 3b
 * — the join, the held deletions, the settings that arrive, the devices — ask the same things,
 * so they are here once. Everything that runs inside the app is source text evaluated in the
 * test window, the way the rest of the tier does it; `SYNC_PRELUDE` is the part of that text
 * every body may lean on.
 *
 * Two things this machine does that a person's does not, and that the helpers work around:
 *
 * - **The window is behind whatever is in front.** Chromium then reports the page as hidden,
 *   and the sync service asks its questions — held deletions, settings that arrived — only while
 *   the app is in front, holding them for the next time it is. `inFront()` makes the page say
 *   it is visible for as long as a suite needs it to, and `leftFront()` says what a phone
 *   leaving the screen says. Both are undone by `frontAsIs()`.
 * - **The server lets one address sign in ten times a minute.** A suite that joins three vaults
 *   signs in more than that. `beforeSignIn()` spaces sign-ins out across the whole run.
 */
import type { TestVault } from './syncVault'
import { waitFor } from './syncVault'
import { delay } from './syncServer'

/** The service, as the test API hands it out. */
export const SERVICE = 'window.__abeleTest.SyncService.getInstance()'

export interface SyncStatus {
  state: string
  pending: number
  lastError: string | null
  heldDeletes?: number
  deferred?: number
}

/**
 * Helpers defined inside the renderer, for a body evaluated through `SyncDriver.run`. Named so
 * they never meet the layout probe's (`wait`, `until`, `closeDialog`, `screen`), which a body
 * may splice in beside them.
 *
 * No backticks: the text is itself spliced into a template literal.
 */
export const SYNC_PRELUDE = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const poll = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      try { if (fn()) return true } catch {}
      await sleep(100)
    }
    return false
  }
  const svc = window.__abeleTest.SyncService.getInstance()
  const textOf = (el) => (el && el.textContent ? el.textContent.trim() : '')
  const buttonIn = (root, text) =>
    root ? [...root.querySelectorAll('button')].find((b) => textOf(b) === text) || null : null
  const press = async (root, text, ms) => {
    let found = null
    const ok = await poll(() => (found = buttonIn(typeof root === 'function' ? root() : root, text)) && !found.disabled, ms || 10000)
    if (!ok) throw new Error('no enabled button "' + text + '"' + (found ? ' (it is disabled: ' + (found.getAttribute('aria-label') || '') + ')' : ''))
    found.click()
    await sleep(250)
    return found
  }
  const typeInto = (input, text) => {
    const view = input.ownerDocument.defaultView
    input.value = text
    input.dispatchEvent(new view.Event('input', { bubbles: true }))
    input.dispatchEvent(new view.Event('change', { bubbles: true }))
  }
  const sectionTitled = (root, title) =>
    [...root.querySelectorAll('.abele-section')].find(
      (s) => textOf(s.querySelector(':scope > .abele-section__heading')) === title
    ) || null
  const modalOf = (selector, doc) => {
    const el = (doc || document).querySelector(selector)
    return el ? el.closest('.modal') : null
  }
  const settingsDoc = () =>
    (app.setting && app.setting.activeTab && app.setting.activeTab.containerEl.ownerDocument) || document
  // A Notice shows in the window it was raised from, and settings open in a window of their
  // own: while notices are being kept, that window's are kept too.
  const keepNoticesOf = (doc) => {
    if (!window.__abeleNotices || doc === document || doc.__abeleNoticeWatch) return
    doc.__abeleNoticeWatch = new MutationObserver((changes) => {
      for (const change of changes)
        for (const node of change.addedNodes)
          if (node.nodeType === 1 && node.classList.contains('notice'))
            window.__abeleNotices.push(node.textContent.trim())
    })
    doc.__abeleNoticeWatch.observe(doc.body, { childList: true, subtree: true })
  }
  const openSyncTab = async () => {
    app.setting.open()
    app.setting.openTabById('abele')
    await sleep(800)
    const root = app.setting.activeTab.containerEl
    keepNoticesOf(root.ownerDocument)
    const tab = [...root.querySelectorAll('.abele-tabs__tab')].find((t) => textOf(t) === 'Sync')
    if (!tab) throw new Error('no Sync tab')
    tab.click()
    if (!(await poll(() => root.querySelector('.abele-sync-settings > *'), 5000))) throw new Error('the Sync tab is empty')
    await sleep(600)
    return root
  }
  const closeSettings = async () => {
    try { app.setting.close() } catch {}
    await sleep(400)
  }
  const escapeIn = async (doc) => {
    const d = doc || document
    for (let i = 0; i < 4 && d.querySelector('.modal'); i++) {
      d.body.dispatchEvent(new (d.defaultView.KeyboardEvent)('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      await sleep(300)
    }
    return !d.querySelector('.modal')
  }
`

/** Everything a suite does to its paired test vault, beyond the CLI itself. */
export class SyncDriver {
  constructor(private readonly vault: () => TestVault) {}

  /** A body run inside the app with the prelude above it, awaited, its answer parsed. */
  run<T>(body: string, timeoutMs?: number): T {
    return this.vault().evalAwait<T>(`(async () => {${SYNC_PRELUDE}\n${body}\n})()`, timeoutMs)
  }

  /**
   * A body that may take longer than one CLI call may block for: started inside the app, its
   * answer parked on the window and polled for. A failure inside is thrown here, with its words.
   */
  async long<T>(what: string, body: string, timeoutMs = 120_000): Promise<T> {
    const key = `__abeleE2e${Math.random().toString(36).slice(2, 10)}`
    this.vault().evalRaw(
      `(() => { window.${key} = null; (async () => {${SYNC_PRELUDE}\n${body}\n})().then(
        (value) => { window.${key} = { ok: true, value: value === undefined ? null : value } },
        (error) => { window.${key} = { ok: false, error: String((error && error.message) || error) } }
      ); return 'started' })()`,
      20_000
    )
    let answer: { ok: boolean; value?: T; error?: string } | null = null
    await waitFor(
      what,
      () =>
        (answer = this.vault().evalAwait<typeof answer>(
          `(() => { const a = window.${key}; if (a) delete window.${key}; return a })()`,
          20_000
        )) !== null,
      timeoutMs
    )
    const done = answer as unknown as { ok: boolean; value?: T; error?: string }
    if (!done.ok) throw new Error(`${what}: ${done.error ?? 'failed'}`)
    return done.value as T
  }

  status(): SyncStatus {
    return this.vault().evalAwait<SyncStatus>(`${SERVICE}.status.value`)
  }

  /**
   * Waits for sync to settle in `state` (idle unless said otherwise). `error` and `offline` end
   * the wait at once, unless they are what is waited for: neither clears itself inside a test.
   */
  async waitState(state = 'idle', timeoutMs = 120_000): Promise<SyncStatus> {
    let last: SyncStatus = { state: 'unknown', pending: 0, lastError: null }
    await waitFor(
      () => `sync to be ${state} (last seen ${JSON.stringify(last)})`,
      () => {
        last = this.status()
        if (last.state !== state && (last.state === 'error' || last.state === 'offline')) {
          throw new Error(`sync went ${last.state}: ${last.lastError ?? 'no reason given'}`)
        }
        return last.state === state
      },
      timeoutMs
    )
    return last
  }

  async waitIdle(timeoutMs?: number): Promise<SyncStatus> {
    return this.waitState('idle', timeoutMs)
  }

  /** A sync the test asked for, rather than one the watcher happened to start. */
  async syncNow(): Promise<SyncStatus> {
    this.vault().evalAwait(`(async () => { await ${SERVICE}.syncNow(); return 'ok' })()`)
    return this.waitIdle()
  }

  /** The status bar item's words, or null while it is hidden. */
  statusBar(): string | null {
    return this.vault().evalAwait<string | null>(
      `(() => { const el = document.querySelector('.abele-sync-status-text'); return el && el.isConnected ? el.textContent.trim() : null })()`
    )
  }

  /** The sync log as it stands. */
  log(): string[] {
    return this.vault().evalAwait<string[]>(`${SERVICE}.log.value`)
  }

  /**
   * Starts keeping every Notice shown from now on, since each one leaves the screen after a few
   * seconds — sooner than a poll from outside might catch it.
   */
  recordNotices(): void {
    this.vault().evalRaw(
      `(() => {
        window.__abeleNotices = window.__abeleNotices || []
        if (!window.__abeleNoticeWatch) {
          window.__abeleNoticeWatch = new MutationObserver((changes) => {
            for (const change of changes)
              for (const node of change.addedNodes)
                if (node.nodeType === 1 && node.classList.contains('notice'))
                  window.__abeleNotices.push(node.textContent.trim())
          })
          window.__abeleNoticeWatch.observe(document.body, { childList: true, subtree: true })
        }
        return 'ok'
      })()`,
      20_000
    )
  }

  /** Every Notice shown since `recordNotices`, and forget them. */
  takeNotices(): string[] {
    return this.vault().evalAwait<string[]>(
      `(() => { const all = window.__abeleNotices || []; window.__abeleNotices = []; return all })()`
    )
  }

  /** Waits for a Notice that says `text`, and hands back the whole of it. */
  async noticeSaying(text: string | RegExp, timeoutMs = 20_000): Promise<string> {
    const seen: string[] = []
    let found = ''
    await waitFor(
      () => `a notice saying ${String(text)} (seen: ${JSON.stringify(seen)})`,
      () => {
        seen.push(...this.takeNotices())
        found =
          seen.find((one) => (typeof text === 'string' ? one.includes(text) : text.test(one))) ?? ''
        if (found !== '') {
          // Another notice may have arrived earlier or in the same poll. Leave it for the
          // next assertion rather than consuming a question nobody has asked yet.
          const unrelated = seen.filter((one) => one !== found)
          if (unrelated.length > 0) {
            this.vault().evalAwait(
              `(() => { window.__abeleNotices.unshift(...${JSON.stringify(unrelated)}); return 'ok' })()`
            )
          }
        }
        return found !== ''
      },
      timeoutMs
    )
    return found
  }

  /** Whether the page says it is in front: see the file's comment. */
  inFront(): void {
    this.setFront('visible', false)
  }

  /** The app leaving the front, as a phone being locked says it. */
  leftFront(): void {
    this.setFront('hidden', true)
  }

  /** The app coming back to the front, with the event a phone sends. */
  backInFront(): void {
    this.setFront('visible', true)
  }

  /** What the browser says again, whatever this suite made it say. */
  frontAsIs(): void {
    this.vault().evalRaw(
      `(() => { delete document.visibilityState; delete document.hidden; return 'ok' })()`,
      20_000
    )
  }

  private setFront(state: 'visible' | 'hidden', announce: boolean): void {
    this.vault().evalRaw(
      `(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${state}' })
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${state === 'hidden'} })
        if (${announce}) document.dispatchEvent(new Event('visibilitychange'))
        return 'ok'
      })()`,
      20_000
    )
  }

  /* -- The vault's files, through Obsidian's own API ----------------------- */

  /** Makes the folders on the way and the file, so the vault's events fire as they would. */
  create(path: string, text: string): void {
    this.createMany([[path, text]])
  }

  createMany(files: [string, string][]): void {
    this.vault().evalAwait(
      `(async () => {
        for (const [path, text] of ${JSON.stringify(files)}) {
          const dir = path.split('/').slice(0, -1)
          for (let i = 1; i <= dir.length; i++) {
            const at = dir.slice(0, i).join('/')
            if (!app.vault.getAbstractFileByPath(at)) await app.vault.createFolder(at).catch(() => undefined)
          }
          const there = app.vault.getAbstractFileByPath(path)
          if (there) await app.vault.modify(there, text)
          else await app.vault.create(path, text)
        }
        return 'ok'
      })()`
    )
  }

  /** Deletes files, or a folder with everything in it. Missing ones are passed over. */
  remove(paths: string[]): void {
    this.vault().evalAwait(
      `(async () => {
        for (const path of ${JSON.stringify(paths)}) {
          const file = app.vault.getAbstractFileByPath(path)
          if (file) await app.vault.delete(file, true)
        }
        return 'ok'
      })()`
    )
  }

  read(path: string): string | null {
    return this.vault().evalAwait<string | null>(
      `(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)})
        return file ? await app.vault.read(file) : null
      })()`
    )
  }

  exists(path: string): boolean {
    return this.vault().evalAwait<boolean>(`app.vault.adapter.exists(${JSON.stringify(path)})`)
  }

  /** The vault's files under a folder, as Obsidian's index has them. */
  filesUnder(folder: string): string[] {
    return this.vault().evalAwait<string[]>(
      `app.vault.getFiles().map((f) => f.path).filter((p) => p.startsWith(${JSON.stringify(`${folder}/`)})).sort()`
    )
  }

  /** The paths the server lists as live, read through this device's own client. */
  serverPaths(): string[] {
    return this.run<string[]>(`
      const client = svc.client()
      if (!client) throw new Error('no client: this device is not connected')
      const paths = []
      let cursor = null
      do {
        const page = await client.manifest(cursor)
        for (const item of page.items) paths.push(item.path)
        cursor = page.next
      } while (cursor)
      return paths.sort()
    `)
  }

  /** The paths in the server's trash. */
  trashPaths(): string[] {
    return this.run<string[]>(`
      const client = svc.client()
      if (!client) throw new Error('no client: this device is not connected')
      return (await client.trash()).map((item) => item.path).sort()
    `)
  }

  /** The shas of every version the server keeps of a path this device has synced. */
  versionShas(path: string): string[] {
    return this.run<string[]>(`
      const entry = await svc.entryFor(${JSON.stringify(path)})
      if (!entry) throw new Error('this device has no entry for ${path.replace(/'/g, '')}')
      const client = svc.client()
      return (await client.versions(entry.fileId)).map((v) => v.sha).filter((sha) => sha)
    `)
  }
}

/**
 * The server lets one address sign in ten times a minute (`/v1/auth/login`), and a daemon's
 * `init` is a sign-in as much as the plugin's is. Called before each; waits while eight have
 * gone in the last minute, which leaves room for a retry the server is not told about.
 */
const signIns: number[] = []
export async function beforeSignIn(): Promise<void> {
  for (;;) {
    const now = Date.now()
    while (signIns.length > 0 && now - signIns[0] > 61_000) signIns.shift()
    if (signIns.length < 8) break
    await delay(61_000 - (now - signIns[0]) + 250)
  }
  signIns.push(Date.now())
}

/** SHA-256 of a text as the server names its blobs: lower-case hex of the UTF-8 bytes. */
export async function shaOf(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Buffer.from(digest).toString('hex')
}

/**
 * The devices of an account, as the account itself sees them: the one list a device that was
 * revoked or disconnected cannot read for itself. Signs in, so it counts against the limit.
 */
export async function accountDevices(
  serverUrl: string,
  email: string,
  password: string
): Promise<{ id: string; name: string; enrolled_by: string | null }[]> {
  await beforeSignIn()
  const login = await globalThis.fetch(`${serverUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!login.ok) throw new Error(`sign-in failed: ${login.status} ${await login.text()}`)
  const { account_token: token } = (await login.json()) as { account_token: string }
  const list = await globalThis.fetch(`${serverUrl}/v1/devices`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!list.ok) throw new Error(`listing devices failed: ${list.status} ${await list.text()}`)
  return (await list.json()) as { id: string; name: string; enrolled_by: string | null }[]
}
