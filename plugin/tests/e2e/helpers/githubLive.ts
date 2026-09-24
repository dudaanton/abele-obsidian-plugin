/**
 * What the GitHub e2e files share: the fake GitHub they read from, the settings that point the
 * running plugin at it, and the scripts that open and read GitHub tabs.
 *
 * The settings are changed in memory only, and the token is not stored at all: the keychain has
 * no way to remove a secret, so `getSecret` is wrapped for the run instead. `restoreGithub` puts
 * both back and closes every GitHub tab, so the vault and the plugin's settings file are left
 * as they were. The sidebars are folded for the run, so a click lands in the note, and opened
 * again after it if they were open.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSync } from 'esbuild'
import { evalRaw, runCli } from './obsidianCli'
import { OWNER, REPO } from './fakeGithubRepo'

export interface FakeGithub {
  /** `http://127.0.0.1:<port>`: the Server setting, and the start of every link. */
  origin: string
  /** `<origin>/acme/widgets`. */
  web: string
  /** Every request so far, as `GET /api/v3/…`. */
  requests(): string[]
  stop(): void
}

/** Bundles the server and starts it on a free port, waiting until it listens. */
export async function startFakeGithub(): Promise<FakeGithub> {
  const dir = mkdtempSync(join(tmpdir(), 'abele-fake-github-'))
  const bundle = join(dir, 'server.mjs')
  buildSync({
    entryPoints: [join(__dirname, 'fakeGithubServer.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'silent',
  })
  const child: ChildProcess = spawn(process.execPath, [bundle, '0'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the fake GitHub did not start')), 15_000)
    let out = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      const m = /listening (\d+)/.exec(out)
      if (m) {
        clearTimeout(timer)
        resolve(Number(m[1]))
      }
    })
    child.on('exit', (code) => reject(new Error(`the fake GitHub exited with ${code}`)))
  })
  // Read whenever the worker is not blocked on an `eval`; the server writes without waiting.
  const lines: string[] = []
  child.stdout!.on('data', (chunk: Buffer) => lines.push(...chunk.toString().split('\n')))
  const origin = `http://127.0.0.1:${port}`
  return {
    origin,
    web: `${origin}/${OWNER}/${REPO}`,
    requests: () => lines.filter((l) => /^(GET|POST) /.test(l)),
    stop: () => {
      child.kill()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** The id the token is looked up under while the tests run; never stored. */
const KEY_ID = 'abele-e2e-github'

/**
 * Turns the integration on against the fake server, in memory, keeping what was there.
 *
 * @param foldSidebars off on a phone, whose sidebars are drawers that are shut already
 */
export function enableGithub(origin: string, foldSidebars = true): void {
  evalRaw(
    `(() => {
      const config = window.__abeleTest.AbeleConfig.getInstance()
      if (!window.__abeleGithubE2E) {
        window.__abeleGithubE2E = {
          github: JSON.stringify(config.github ?? null),
          getSecret: app.secretStorage.getSecret,
          left: ${foldSidebars} ? app.workspace.leftSplit.collapsed : true,
          right: ${foldSidebars} ? app.workspace.rightSplit.collapsed : true,
        }
      }
      // The notes and the tabs get the window: a wide sidebar left the main area 16 px wide,
      // and a click aimed at a link landed in the sidebar over it.
      if (${foldSidebars}) {
        app.workspace.leftSplit.collapse()
        app.workspace.rightSplit.collapse()
      }
      const real = window.__abeleGithubE2E.getSecret
      config.github = {
        ...(config.github ?? {}),
        enabled: true,
        openLinks: true,
        server: ${JSON.stringify(origin)},
        keyId: ${JSON.stringify(KEY_ID)},
        searchLimitMb: 100,
      }
      app.secretStorage.getSecret = function (id) {
        return id === ${JSON.stringify(KEY_ID)} ? 'e2e-token' : real.call(this, id)
      }
      return 'ok'
    })()`,
    30_000
  )
}

/** Closes every GitHub tab and puts the settings and the keychain back as they were. */
export function restoreGithub(): void {
  evalRaw(
    `(() => {
      for (const leaf of app.workspace.getLeavesOfType('abele-github')) leaf.detach()
      const saved = window.__abeleGithubE2E
      if (!saved) return 'nothing'
      const config = window.__abeleTest.AbeleConfig.getInstance()
      const github = JSON.parse(saved.github)
      if (github) config.github = github
      else delete config.github
      app.secretStorage.getSecret = saved.getSecret
      if (!saved.left) app.workspace.leftSplit.expand()
      if (!saved.right) app.workspace.rightSplit.expand()
      delete window.__abeleGithubE2E
      return 'ok'
    })()`,
    30_000
  )
}

/** Runs an async script in the app and parses what it resolves to. */
export const evalAsync = <T>(script: string, timeoutMs = 60_000): T => {
  const raw = evalRaw(script, timeoutMs)
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`Not JSON from the app: ${raw.slice(0, 400)}`)
  }
}

/**
 * Helpers every probe script starts with: waiting for a condition rather than for a time, the
 * GitHub tabs and what they show, and whether an element is inside its tab's visible area.
 */
export const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      try { const v = fn(); if (v) return v } catch {}
      await wait(100)
    }
    return null
  }
  const githubLeaves = () => app.workspace.getLeavesOfType('abele-github')
  const tabs = () => githubLeaves().map((l) => ({
    url: l.view.model.url,
    title: l.view.containerEl.querySelector('.abele-github-header__title')?.textContent?.trim() ?? '',
  }))
  const scroller = (el) => el.closest('.view-content')
  /** Where an element sits in its tab's visible area: 0 at the top, 1 at the bottom. */
  const placeInView = (el) => {
    const box = scroller(el).getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return { top: r.top - box.top, bottom: r.bottom - box.top, height: box.height,
      inView: r.top >= box.top - 1 && r.bottom <= box.bottom + 1 }
  }
  const loaded = (leaf, text) => {
    const title = leaf?.view.containerEl.querySelector('.abele-github-header__title')
    return !!title && title.textContent.includes(text) &&
      !leaf.view.containerEl.textContent.includes('Loading from GitHub')
  }
  const openTab = async (url, pane = 'tab') => {
    // Once the last tab has closed, the leaf Obsidian puts in its place has never been active,
    // and a new tab finds no group to go in ("No tab group found"): that leaf is used instead.
    let leaf
    try { leaf = app.workspace.getLeaf(pane) } catch { leaf = app.workspace.getLeaf(false) }
    await leaf.setViewState({ type: 'abele-github', state: { url }, active: true })
    return leaf
  }
`

/**
 * A click the way the person makes one: through the page's input pipeline at a point on screen,
 * so every handler Obsidian and the plugin have on the way sees it — capture listeners, CodeMirror,
 * Obsidian's own link opening. `modifiers` is CDP's bit mask: Alt 1, Ctrl 2, Meta 4, Shift 8.
 */
export function realClick(x: number, y: number, modifiers = 0): void {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    const params = {
      type,
      x,
      y,
      modifiers,
      button: type === 'mouseMoved' ? 'none' : 'left',
      clickCount: 1,
    }
    runCli(
      ['dev:cdp', 'method=Input.dispatchMouseEvent', `params=${JSON.stringify(params)}`],
      30_000
    )
  }
}

export const META = 4
export const ALT = 1

const cdp = (method: string, params: object): void => {
  runCli(['dev:cdp', `method=${method}`, `params=${JSON.stringify(params)}`], 30_000)
}

/**
 * A mouse drag from one point to another, the way a hand selects text: pressed, moved in a few
 * steps with the button held, released.
 */
export function realDrag(from: { x: number; y: number }, to: { x: number; y: number }): void {
  cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from, button: 'none' })
  cdp('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...from,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  for (const t of [0.25, 0.5, 0.75, 1]) {
    const x = Math.round(from.x + (to.x - from.x) * t)
    const y = Math.round(from.y + (to.y - from.y) * t)
    cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
  }
  cdp('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...to,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
}

/**
 * Mod+C as the app menu runs it: the key reaches the page's handlers, and the browser's own copy
 * command follows — the menu's accelerator is outside the page, so CDP names the command.
 */
export function realCopy(): void {
  const key = { key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: META }
  cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...key, commands: ['copy'] })
  cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

/** Where to click an element: its centre, or `selector`'s first match's, in the main window. */
export function centreOf(selectorScript: string): { x: number; y: number } | null {
  const raw = evalRaw(
    `(() => {
      const el = (${selectorScript})
      if (!el) return 'null'
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return JSON.stringify({ x: Math.round(r.left + Math.min(r.width / 2, 20)), y: Math.round(r.top + r.height / 2) })
    })()`,
    30_000
  )
  const parsed = JSON.parse(raw.replace(/^'(.*)'$/s, '$1')) as { x: number; y: number } | null
  return parsed
}
