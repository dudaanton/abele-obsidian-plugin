/**
 * A pull request's tab on a phone: `app.emulateMobile(true)` in a 390×844 window, the
 * conversation and the changed files each asked whether anything reaches past the right edge of
 * the screen, and whether the tab scrolls sideways.
 *
 * `emulateMobile` reloads the app, and the window's size only reaches the page after another
 * reload, so the settings the file needs are put in place after both. A picture of each screen
 * goes to `/tmp/abele-phone/github-pull-*.png` — look at them before a release.
 *
 * Text stays selectable on a phone, and a finger held on a name in the code opens the code menu
 * while one held anywhere else does not. The phone's own long-press selection cannot be made
 * on the desktop: the Mac's Chromium turns no touch into a long-press gesture, so what is checked
 * there is that nothing stands in its way — the text is selectable, and the menu keeps to names.
 * On a real phone (`npm run test:e2e:phone`) the press is a finger's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import {
  PRELUDE as GITHUB_PRELUDE,
  enableGithub,
  evalAsync,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { BASE_SHA, HEAD_SHA } from './helpers/fakeGithubRepo'
import { openBasePicker } from './helpers/githubBasePicker'
import { onPhone, targets } from './helpers/target'
import { longPress as fingerHeld } from './helpers/phone'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const PHONE = { width: 390, height: 844 }
const SHOTS = shotDir('abele-phone')
const available = isObsidianRunning() && hasTestApi()

interface Screen {
  error?: string
  phone?: boolean
  over?: string[]
  sideways?: number
  shot?: string
}

// Gesture holds and screenshot retry backoff below are deliberate durations.
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const PRELUDE = `
  ${GITHUB_PRELUDE}
  // Sample the geometry, not whether the overflow assertions will pass. The next
  // measurement must see the same mounted layout, including CodeMirror's own reflow.
  const settledLayout = async (root) => {
    let previous
    if (!(await until(() => {
      if (!root?.isConnected || !root.getBoundingClientRect().height) return false
      const boxes = JSON.stringify([innerWidth, innerHeight, visualViewport?.height,
        ...[root, ...root.querySelectorAll('*')].map(el => {
          const r = el.getBoundingClientRect()
          return [r.x, r.y, r.width, r.height, el.scrollWidth, el.scrollHeight]
        })])
      const stable = boxes === previous
      previous = boxes
      return stable
    }))) throw Error('The mounted layout did not settle')
  }
`

const cdp = (method: string, params: object): void => {
  runCli(['dev:cdp', `method=${method}`, `params=${JSON.stringify(params)}`], 30_000)
}

/**
 * A finger held at a point for `ms`, through the page's touch input; `during` runs while it is
 * still down. The Mac's Chromium makes a tap of the lift — with a mousedown that closes any menu —
 * where a phone would take the press as a long one and send nothing, so what the press opened is
 * read before the finger lifts.
 */
const longPress = async <T>(
  at: { x: number; y: number },
  during: () => T,
  ms = 900
): Promise<T> => {
  // A real finger: the menu a long press opens stays after the lift, as it does for a person.
  if (onPhone()) {
    fingerHeld(at.x, at.y)
    await pause(300)
    return during()
  }
  cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  try {
    cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
    await pause(ms)
    return during()
  } finally {
    cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    cdp('Emulation.setTouchEmulationEnabled', { enabled: false })
  }
}

/** A phone's window is its screen: measured, never set. */
const windowSize = (): [number, number] =>
  onPhone()
    ? evalJson<[number, number]>(`[innerWidth, innerHeight]`)
    : evalJson<[number, number]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)

const setWindowSize = async (width: number, height: number): Promise<void> => {
  if (onPhone()) return
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  const sized = evalAsync<boolean>(`(async () => {
    ${PRELUDE}
    return !!(await until(() => innerWidth === ${width} && innerHeight === ${height}))
  })()`)
  if (!sized) throw new Error('The window did not reach its requested size')
}

/** Reloads the page and waits for the plugin to be back. */
const reload = async (how: string): Promise<void> => {
  await reloadApp(how)
}

/** Opens the pull request on `section` and measures what reaches past the screen's edge. */
const measure = (
  web: string,
  section: 'conversation' | 'files' | 'compare' | 'markdown' | 'home' | 'list'
) =>
  evalAsync<Screen>(`(async () => {
    ${PRELUDE}
    const report = { phone: document.body.classList.contains('is-phone') }
    try {
      // A phone's workspace may have no tab left to open another beside: the leaf in front then.
      const url = ${JSON.stringify(
        section === 'compare'
          ? `${web}/compare/${BASE_SHA}...main`
          : section === 'home'
            ? web
            : section === 'list'
              ? `${web}/pulls`
              : section === 'markdown'
                ? `${web}/blob/main/README.md#L10`
                : `${web}/pull/42${section === 'files' ? '/files' : ''}`
      )}
      const title = ${JSON.stringify(
        section === 'compare'
          ? '...main'
          : section === 'home'
            ? 'widgets'
            : section === 'list'
              ? 'Pull requests'
              : section === 'markdown'
                ? 'README.md'
                : 'Rework the widget loader'
      )}
      const leaf = githubLeaves()[0] ?? app.workspace.getLeaf(false)
      await leaf.setViewState({ type: 'abele-github', state: { url }, active: true })
      await app.workspace.revealLeaf(leaf)
      const root = leaf.view.containerEl
      const ready = await until(() => loaded(leaf, title) &&
        (${JSON.stringify(section)} === 'conversation'
          ? root.querySelectorAll('.abele-github-comment').length > 5
          : ${JSON.stringify(section)} === 'markdown'
            ? root.querySelector('.abele-github-md__block_marked')
            : ${JSON.stringify(section)} === 'list'
            ? root.querySelector('.abele-github-list-row')
            : ${JSON.stringify(section)} === 'home'
            ? root.querySelector('[data-list="pulls"] .tree-item-self') &&
              root.querySelector('.abele-github-folder__readme h1') &&
              root.querySelector('.abele-github-home__lang-part')
            : root.querySelectorAll('.abele-github-file .cm-editor').length === 5), 20000)
      if (!ready) return { ...report, error: 'the pull request never showed' }
      await settledLayout(root)

      // The part of the tab that scrolls: the content beside the file tree panel.
      const content = leaf.view.contentEl.querySelector('.abele-github-layout__main') ?? leaf.view.contentEl
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

      // On a real phone the harness's host takes the picture (see helpers/phone.ts).
      if (!window.__e2eHost) require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      const shot = ${JSON.stringify(SHOTS)} + (['compare', 'markdown', 'home', 'list'].includes(${JSON.stringify(section)}) ? '/github-' + ${JSON.stringify(section)} + '.png' : '/github-pull-' + ${JSON.stringify(section)} + '.png')
      // The first picture after a reload can hang or fail; the measurements stand without it.
      if (window.__e2eHost) report.shot = await window.__e2eHost.shot(shot)
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

/**
 * The "Open GitHub link or item" picker with `text` typed, once GitHub has answered: what reaches
 * past the screen's edge, and a picture.
 */
const measurePicker = (
  text: string,
  label: string,
  command = 'abele:open-github-link',
  cls = '.abele-github-open'
) =>
  evalAsync<Screen & { rows?: number }>(`(async () => {
    ${PRELUDE}
    const report = { phone: document.body.classList.contains('is-phone') }
    const picker = () => document.querySelector(${JSON.stringify(cls)})
    try {
      const config = window.__abeleTest.AbeleConfig.getInstance()
      config.github = { ...config.github, defaultRepo: 'acme/widgets' }
      app.commands.executeCommandById(${JSON.stringify(command)})
      const input = await until(() => picker()?.querySelector('input'), 5000)
      if (!input) return { ...report, error: 'no picker' }
      input.value = ${JSON.stringify(text)}
      input.dispatchEvent(new Event('input', { bubbles: true }))
      // The empty link picker offers instructions, not rows. The repository picker
      // instead fills in once the account's lists arrive. A pending placeholder is
      // itself a suggestion, so rows alone do not mean GitHub has answered.
      const emptyLink = ${JSON.stringify(!text && cls === '.abele-github-open')}
      if (!(await until(() => emptyLink
        ? picker().textContent.includes('Type a number, words of a title')
        : !picker().textContent.includes('Asking GitHub') && picker().querySelectorAll('.suggestion-item').length > 0, 10000)))
        throw Error('The picker did not show its suggestions or empty instructions')
      input.blur()
      if (!(await until(() => document.activeElement !== input &&
        (visualViewport?.height ?? innerHeight) >= innerHeight - 1)))
        throw Error('The picker keyboard did not close')
      await settledLayout(picker())
      const root = picker()
      report.rows = root.querySelectorAll('.suggestion-item').length
      const edge = window.innerWidth
      const name = (el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.')
      report.over = [...root.querySelectorAll('*')]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > edge + 1 })
        .map((el) => name(el) + ' +' + Math.round(el.getBoundingClientRect().right - edge))
        .slice(0, 12)
      report.sideways = root.scrollWidth - root.clientWidth
      // On a real phone the harness's host takes the picture (see helpers/phone.ts).
      if (!window.__e2eHost) require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      const shot = ${JSON.stringify(SHOTS)} + '/github-open-' + ${JSON.stringify(label)} + '.png'
      if (window.__e2eHost) report.shot = await window.__e2eHost.shot(shot)
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
    } finally {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      await until(() => !picker(), 3000)
    }
    return report
  })()`)

const measurePinned = (web: string) =>
  evalAsync<Screen>(`(async () => {
  ${PRELUDE}
  try {
    ${openBasePicker(web)}
    prompt.querySelector('.suggestion-item').click()
    await leaf.setViewState({ type: 'abele-github', state: { url: ${JSON.stringify(web + '/blob/' + HEAD_SHA + '/src/long.ts#L399')} }, active: true })
    if (!(await until(() => [...root.querySelectorAll('.abele-github-code__line_target')].some(l => l.textContent.includes('setting399')), 20000))) throw Error('Pinned target context did not show')
    await settledLayout(root)
    const content = root.querySelector('.abele-github-layout__main'), edge = Math.min(content.getBoundingClientRect().right, innerWidth)
    const over = [...content.querySelectorAll('.abele-github-base > *, .abele-github-pinned > *, .abele-github-file__head > *')].filter(el => el.getBoundingClientRect().right > edge + 1).map(el => el.className)
    const report = { phone: document.body.classList.contains('is-phone'), over, sideways: content.scrollWidth - content.clientWidth }
    const shot = ${JSON.stringify(SHOTS + '/github-pinned.png')}
    if (window.__e2eHost) report.shot = await window.__e2eHost.shot(shot)
    else { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); const image = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(shot, image.toPNG()); report.shot = shot }
    ;[...root.querySelectorAll('button')].find(b => b.textContent === 'Unpin').click()
    await until(() => root.querySelector('.abele-github-blob'), 20000)
    return report
  } catch (error) { return { error: String(error.message || error) } }
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
    screens.compare = measure(gh.web, 'compare')
    screens.markdown = measure(gh.web, 'markdown')
    screens.home = measure(gh.web, 'home')
    screens.list = measure(gh.web, 'list')
    screens.pinned = measurePinned(gh.web)
    // Last: the tests below work in the pull request's files.
    screens.files = measure(gh.web, 'files')
    screens.picker = measurePicker('loader', 'suggestions')
    screens.pickerEmpty = measurePicker('', 'empty')
    screens.repoPicker = measurePicker(
      '',
      'repositories',
      'abele:open-github-repository',
      '.abele-github-repos'
    )
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

  it.each(['conversation', 'files', 'compare', 'markdown', 'home', 'list', 'pinned'])(
    '%s: shown in the phone layout',
    (section) => {
      expect(screens[section]?.error).toBeUndefined()
      expect(screens[section]?.phone).toBe(true)
    }
  )

  it.each(['picker', 'pickerEmpty', 'repoPicker'])('%s: the picker fits the screen', (s) => {
    expect(screens[s]?.error).toBeUndefined()
    expect(screens[s]?.phone).toBe(true)
    expect(screens[s]?.over ?? ['no report']).toEqual([])
    expect(screens[s]?.sideways).toBe(0)
  })

  it('the picker offers what GitHub has on a phone too', () => {
    expect((screens.picker as { rows?: number } | undefined)?.rows).toBe(3)
  })

  it.each(['conversation', 'files', 'compare', 'markdown', 'home', 'list', 'pinned'])(
    '%s: nothing reaches past the edge of the screen',
    (section) => {
      expect(screens[section]?.over ?? ['no report']).toEqual([])
      expect(screens[section]?.sideways).toBe(0)
    }
  )

  it('text is selectable, and a long press opens the code menu on a name only', async () => {
    const prepared = evalAsync<{
      error?: string
      select?: Record<string, string>
      name?: { x: number; y: number }
      brace?: { x: number; y: number }
      hit?: string
      nav?: boolean
      hitsLine?: boolean
    }>(`(async () => {
      ${PRELUDE}
      const leaf = githubLeaves()[0]
      const root = leaf.view.containerEl
      const line = await until(() => [...(root.querySelector('.abele-github-file[data-path="src/app.ts"]')
        ?.querySelectorAll('.cm-content .cm-line') ?? [])].find((l) => l.textContent.startsWith('export function startApp')), 15000)
      if (!line) return { error: 'no diff line' }
      line.scrollIntoView({ block: 'center' })
      if (!(await until(() => line.isConnected && placeInView(line).inView)))
        throw Error('The code line did not scroll into view')
      await settledLayout(line)
      const box = (from, to) => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        let at = 0
        while (walker.nextNode()) {
          const t = walker.currentNode
          if (from < at + t.length) {
            const r = document.createRange()
            r.setStart(t, from - at)
            r.setEnd(t, Math.min(t.length, to - at))
            const b = r.getBoundingClientRect()
            return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
          }
          at += t.length
        }
        return null
      }
      const content = line.textContent
      const point = box(content.indexOf('startApp') + 2, content.indexOf('startApp') + 3)
      const style = (el) => el ? getComputedStyle(el).webkitUserSelect : 'missing'
      return {
        hit:point ? document.elementFromPoint(point.x,point.y)?.outerHTML.slice(0,300) : 'no point',
        nav:!!line.closest('.abele-code-nav'),
        hitsLine:!!point && line.contains(document.elementFromPoint(point.x,point.y)),
        select: {
          line: style(line),
          gutter: style(root.querySelector('.abele-github-file .cm-gutterElement')),
          title: style(root.querySelector('.abele-github-header__title')),
        },
        name: box(content.indexOf('startApp') + 2, content.indexOf('startApp') + 3),
        brace: box(content.length - 1, content.length),
      }
    })()`)
    expect(prepared.error).toBeUndefined()
    expect(prepared.hitsLine, JSON.stringify(prepared)).toBe(true)
    expect(prepared.select).toEqual({ line: 'text', gutter: 'none', title: 'text' })

    const menuAfter = (at: { x: number; y: number }) =>
      longPress(at, () =>
        evalAsync<{ items: string[] }>(`(async () => {
          const menu = document.querySelector('.menu')
          const items = menu ? [...menu.querySelectorAll('.menu-item-title')].map((t) => t.textContent) : []
          // The lift's mousedown closes it; this is for when it does not.
          if (menu) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          return { items }
        })()`)
      )
    expect((await menuAfter(prepared.name!)).items).toEqual([
      'Go to definition of startApp',
      'Find references to startApp',
      'Copy startApp',
    ])
    expect((await menuAfter(prepared.brace!)).items).toEqual([])
  })

  it('the file tree is a drawer over the code, which keeps its width, and goes once a file is picked', () => {
    const r = evalAsync<{
      error?: string
      startsClosed?: boolean
      position?: string
      dividerHidden?: boolean
      panel?: { left: number; right: number }
      screen?: number
      main?: { before: number; after: number; sideways: number }
      over?: string[]
      shot?: string
      opened?: string
      closedAfter?: boolean
    }>(`(async () => {
      ${PRELUDE}
      const url = ${JSON.stringify(`${gh.web}/blob/main/src/util/format.ts`)}
      const leaf = githubLeaves()[0] ?? app.workspace.getLeaf(false)
      await leaf.setViewState({ type: 'abele-github', state: { url }, active: true })
      await app.workspace.revealLeaf(leaf)
      const root = leaf.view.containerEl
      if (!(await until(() => loaded(leaf, 'src/util/format.ts') && root.querySelector('.cm-line'), 20000)))
        return { error: 'the file never showed' }
      const main = root.querySelector('.abele-github-layout__main')
      const report = { startsClosed: !root.querySelector('.abele-github-tree'), screen: window.innerWidth }
      const before = main.getBoundingClientRect().width
      // The file with its breadcrumbs, before the drawer covers it.
      try {
        if (window.__e2eHost) await window.__e2eHost.shot(${JSON.stringify(SHOTS)} + '/github-tree-file.png')
        else {
          const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
          require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
          if (img) require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/github-tree-file.png', img.toPNG())
        }
      } catch (e) {}
      const icon = [...root.querySelectorAll('.abele-github-header__actions .abele-obsidian-icon')]
        .find((i) => i.querySelector('svg.lucide-folder-tree'))
      if (!icon) return { ...report, error: 'no tree icon' }
      icon.click()
      const row = (path) => root.querySelector('.abele-github-tree .tree-item-self[data-path="' + path + '"]')
      if (!(await until(() => row('src/util/format.ts')?.classList.contains('is-active'), 20000)))
        return { ...report, error: 'the panel never marked the file' }
      const panel = root.querySelector('.abele-github-layout__panel')
      await settledLayout(panel)
      const p = panel.getBoundingClientRect()
      report.position = getComputedStyle(panel).position
      const divider = panel.querySelector('.abele-github-layout__resize')
      report.dividerHidden = !!divider && getComputedStyle(divider).display === 'none' && divider.tabIndex === -1
      report.panel = { left: Math.round(p.left), right: Math.round(p.right) }
      report.main = { before: Math.round(before), after: Math.round(main.getBoundingClientRect().width),
        sideways: main.scrollWidth - main.clientWidth }
      const edge = window.innerWidth
      report.over = [...panel.querySelectorAll('*')]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > edge + 1 })
        .map((el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.')).slice(0, 8)
      const shot = ${JSON.stringify(SHOTS)} + '/github-tree-drawer.png'
      if (window.__e2eHost) report.shot = await window.__e2eHost.shot(shot)
      else require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      for (let attempt = 0; attempt < 3 && !report.shot; attempt++) {
        try {
          const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
          if (img) { require('fs').writeFileSync(shot, img.toPNG()); report.shot = shot }
        } catch (e) { await wait(500) }
      }
      row('src/app.ts').click()
      await until(() => loaded(leaf, 'src/app.ts'), 20000)
      report.opened = leaf.view.model.url
      report.closedAfter = !root.querySelector('.abele-github-tree')
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.startsClosed).toBe(true)
    expect(r.position).toBe('absolute')
    expect(r.dividerHidden).toBe(true)
    expect(r.panel!.left).toBeGreaterThanOrEqual(0)
    expect(r.panel!.right).toBeLessThanOrEqual(r.screen!)
    // The code keeps its whole width: the drawer lies over it.
    expect(r.main!.after).toBe(r.main!.before)
    expect(r.main!.sideways).toBe(0)
    expect(r.over).toEqual([])
    expect(r.shot).toMatch(/\.png$/)
    expect(r.opened).toMatch(/\/blob\/main\/src\/app\.ts$/)
    expect(r.closedAfter).toBe(true)
  })

  it('a link to lines followed again, then to other lines, leaves them drawn on screen', () => {
    const r = evalAsync<{ error?: string; steps?: { inView?: boolean; drawn?: number }[] }>(
      `(async () => {
      ${PRELUDE}
      const leaf = githubLeaves()[0] ?? app.workspace.getLeaf(false)
      const root = leaf.view.containerEl
      const look = async (text) => {
        const result = await until(() => {
          // CodeMirror can replace a line while bringing it into its drawn viewport.
          const el = [...root.querySelectorAll('.abele-github-code__line_target, .abele-github-md__block_marked')]
            .find((e) => e.textContent.includes(text))
          if (!el?.isConnected || !placeInView(el).inView) return false
          const box = scroller(el).getBoundingClientRect()
          const drawn = [...root.querySelectorAll('.abele-github-blob .cm-line, .abele-github-md__block')].filter((l) => {
            const b = l.getBoundingClientRect()
            return b.height > 0 && b.bottom > box.top && b.top < box.bottom
          }).length
          return drawn > 0 && { inView: placeInView(el).inView, drawn }
        }, 15000)
        if (!result) throw Error('The marked lines did not draw on screen')
        return result
      }
      const steps = []
      for (const [url, text] of [
        ['/blob/main/src/long.ts#L350-L352', 'setting350'],
        ['/blob/main/src/long.ts#L350-L352', 'setting350'],
        ['/blob/main/src/long.ts#L120', 'setting120'],
        ['/blob/main/README.md#L10', 'npm install acme-widgets'],
        ['/blob/main/README.md#L10', 'npm install acme-widgets'],
      ]) {
        await leaf.setViewState({ type: 'abele-github', state: { url: ${JSON.stringify(gh.web)} + url }, active: true })
        steps.push(await look(text))
      }
      return { steps }
    })()`,
      150_000
    )
    expect(r.error).toBeUndefined()
    for (const step of r.steps!) {
      expect(step.inView).toBe(true)
      expect(step.drawn).toBeGreaterThan(0)
    }
  })
})
