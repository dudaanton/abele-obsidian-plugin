/**
 * A pull request's tab on a phone: `app.emulateMobile(true)` in a 390×844 window, the
 * conversation and the changed files each asked whether anything reaches past the right edge of
 * the screen, and whether the tab scrolls sideways.
 *
 * `emulateMobile` reloads the app, and the window's size only reaches the page after another
 * reload, so the settings the file needs are put in place after both. A picture of each screen
 * goes to `/tmp/abele-phone/github-pull-*.png` — look at them before a release.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson } from './helpers/obsidianCli'
import {
  PRELUDE,
  enableGithub,
  evalAsync,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'

const PHONE = { width: 390, height: 844 }
const SHOTS = '/tmp/abele-phone'
const available = isObsidianRunning() && hasTestApi()

interface Screen {
  error?: string
  phone?: boolean
  over?: string[]
  sideways?: number
  shot?: string
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

/** Reloads the page and waits for the plugin to be back. */
const reload = async (how: string): Promise<void> => {
  evalRaw(`(() => { setTimeout(() => { ${how} }, 50); return 'ok' })()`, 30_000)
  await pause(4000)
  const deadline = Date.now() + 60_000
  while (!hasTestApi() && Date.now() < deadline) await pause(1000)
}

/** Opens the pull request on `section` and measures what reaches past the screen's edge. */
const measure = (web: string, section: 'conversation' | 'files') =>
  evalAsync<Screen>(`(async () => {
    ${PRELUDE}
    const report = { phone: document.body.classList.contains('is-phone') }
    try {
      // A phone's workspace may have no tab left to open another beside: the leaf in front then.
      const url = ${JSON.stringify(`${web}/pull/42${section === 'files' ? '/files' : ''}`)}
      const leaf = githubLeaves()[0] ?? app.workspace.getLeaf(false)
      await leaf.setViewState({ type: 'abele-github', state: { url }, active: true })
      await app.workspace.revealLeaf(leaf)
      const root = leaf.view.containerEl
      const ready = await until(() => loaded(leaf, 'Rework the widget loader') &&
        (${JSON.stringify(section)} === 'conversation'
          ? root.querySelectorAll('.abele-github-comment').length > 5
          : root.querySelectorAll('.abele-github-file .cm-editor').length === 5), 20000)
      if (!ready) return { ...report, error: 'the pull request never showed' }
      await wait(800)

      const content = leaf.view.contentEl
      const edge = Math.min(content.getBoundingClientRect().right, window.innerWidth)
      const name = (el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.')
      const over = []
      const clipped = (el) => {
        for (let p = el.parentElement; p && p !== content; p = p.parentElement)
          if (getComputedStyle(p).overflowX !== 'visible') return true
        return false
      }
      for (const el of content.querySelectorAll('*')) {
        const s = getComputedStyle(el)
        if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'absolute') continue
        if (el.classList.contains('is-measuring')) continue
        // What a box that clips or scrolls sideways holds is its own: a long code line, or the
        // strip of section tabs, which on a phone scrolls sideways by design.
        if (clipped(el)) continue
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.right > edge + 1) over.push(name(el) + ' +' + Math.round(r.right - edge))
      }
      report.over = over.slice(0, 12)
      report.sideways = content.scrollWidth - content.clientWidth

      require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      const shot = ${JSON.stringify(SHOTS)} + '/github-pull-' + ${JSON.stringify(section)} + '.png'
      // The first picture after a reload can hang or fail; the measurements stand without it.
      for (let attempt = 0; attempt < 3 && !report.shot?.endsWith('.png'); attempt++) {
        try {
          const capture = require('@electron/remote').getCurrentWebContents().capturePage()
          const img = await Promise.race([capture, wait(8000).then(() => null)])
          if (img) {
            require('fs').writeFileSync(shot, img.toPNG())
            report.shot = shot
          }
        } catch (e) {
          report.shot = 'no picture: ' + String((e && e.message) || e)
          await wait(500)
        }
      }
    } catch (e) {
      report.error = String((e && e.message) || e)
    }
    return report
  })()`)

describe.skipIf(!available)('a pull request on a phone', () => {
  let gh: FakeGithub
  let size: [number, number] = [0, 0]
  const screens: Record<string, Screen> = {}

  beforeAll(async () => {
    gh = await startFakeGithub()
    size = windowSize()
    await reload('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    await reload('window.location.reload()')
    enableGithub(gh.origin, false)
    screens.conversation = measure(gh.web, 'conversation')
    screens.files = measure(gh.web, 'files')
    console.info(`\n  ${JSON.stringify(screens)}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    try {
      restoreGithub()
    } finally {
      gh?.stop()
    }
    // The window first: leaving emulation reloads the app at whatever size the window is.
    if (size[0]) await setWindowSize(size[0], size[1])
    await reload('app.emulateMobile(false)')
  }, 180_000)

  it.each(['conversation', 'files'])('%s: shown in the phone layout', (section) => {
    expect(screens[section]?.error).toBeUndefined()
    expect(screens[section]?.phone).toBe(true)
  })

  it.each(['conversation', 'files'])(
    '%s: nothing reaches past the edge of the screen',
    (section) => {
      expect(screens[section]?.over ?? ['no report']).toEqual([])
      expect(screens[section]?.sideways).toBe(0)
    }
  )
})
