/**
 * From a line of code to the folders around it, in the app, against the fake GitHub server:
 *
 * - a file's breadcrumbs open its folder in the same tab — the folder's entries, then its README
 *   rendered — and an entry of the folder opens in turn; back returns to the folder;
 * - a folder of a pull request's diff header opens at the pull request's head commit, and the
 *   file tree panel beside it marks that folder, filters by name and opens a file at the same
 *   commit, staying open beside the content;
 * - a folder link whose branch holds a slash;
 *
 * and a picture of the panel on a desktop goes to `/tmp/abele-github-tree/` — look at it. The
 * phone's drawer is in `githubPhone.e2e.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import {
  PRELUDE,
  enableGithub,
  evalAsync,
  restoreGithub,
  realDrag,
  centreOf,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { HEAD_SHA } from './helpers/fakeGithubRepo'
import { shotDir } from './helpers/shots'

const SHOTS = shotDir('abele-github-tree')
const available = isObsidianRunning() && hasTestApi()

/** Rows of the folder listing and of the panel, by their paths. */
const TREE = `
  const folderRows = (root) => [...root.querySelectorAll('.abele-github-folder .tree-item-self')]
    .map((r) => r.getAttribute('data-path'))
  const panelRow = (root, path) =>
    root.querySelector('.abele-github-tree .tree-item-self[data-path="' + path + '"]')
  const panelRows = (root) => [...root.querySelectorAll('.abele-github-tree .tree-item-self')]
    .map((r) => r.getAttribute('data-path'))
  const headerIcon = (root, name) => [...root.querySelectorAll('.abele-github-header__actions .abele-obsidian-icon')]
    .find((i) => i.querySelector('svg.lucide-' + name) || i.querySelector('[data-icon="' + name + '"]'))
  const shoot = async (file) => {
    require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const capture = require('@electron/remote').getCurrentWebContents().capturePage()
        const img = await Promise.race([capture, wait(8000).then(() => null)])
        if (img) {
          require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + file, img.toPNG())
          return ${JSON.stringify(SHOTS)} + '/' + file
        }
      } catch (e) {
        await wait(500)
      }
      // A capture after a reload can hang until the window draws a new frame: nudge its size.
      const w = require('@electron/remote').getCurrentWindow()
      const [width, height] = w.getContentSize()
      w.setContentSize(width + 2, height + 2)
      await wait(300)
      w.setContentSize(width, height)
      await wait(300)
    }
    return 'no picture'
  }
`

/** The device's remembered panel choice, which a click on the tree icon writes. */
const PANEL_KEY = 'abele-github-tree-panel'
const WIDTH_KEY = 'abele-github-tree-width'

describe.skipIf(!available)('folders of a repository in a GitHub tab', () => {
  let gh: FakeGithub
  let panelChoice = 'null'
  let panelWidth = 'null'

  beforeAll(async () => {
    gh = await startFakeGithub()
    enableGithub(gh.origin)
    panelChoice = evalRaw(
      `JSON.stringify(app.loadLocalStorage(${JSON.stringify(PANEL_KEY)}) ?? null)`
    )
    panelWidth = evalRaw(
      `JSON.stringify(app.loadLocalStorage(${JSON.stringify(WIDTH_KEY)}) ?? null)`
    )
  }, 60_000)

  // A test that returned early left its tab open, and the next one counted it as its own.
  afterEach(() => {
    evalRaw(
      `(() => { for (const l of app.workspace.getLeavesOfType('abele-github')) l.detach(); return 'ok' })()`
    )
  })

  afterAll(() => {
    if (!available) return
    try {
      restoreGithub()
      // Put the person's own choice back: the run's clicks are not theirs.
      evalRaw(
        `app.saveLocalStorage(${JSON.stringify(PANEL_KEY)}, ${panelChoice.replace(/^=> /, '')});
         app.saveLocalStorage(${JSON.stringify(WIDTH_KEY)}, ${panelWidth.replace(/^=> /, '')})`
      )
    } finally {
      gh?.stop()
    }
  })

  it('a breadcrumb opens the folder, whose entry opens in turn, and back returns', () => {
    const r = evalAsync<{
      error?: string
      crumbs?: string[]
      folderUrl?: string
      rows?: string[]
      readme?: string
      fileUrl?: string
      backUrl?: string
      tabs?: number
      shot?: string
    }>(`(async () => {
      ${PRELUDE}
      ${TREE}
      const leaf = await openTab(${JSON.stringify(`${gh.web}/blob/main/src/app.ts`)})
      const root = leaf.view.containerEl
      if (!(await until(() => loaded(leaf, 'src/app.ts'), 20000))) return { error: 'no file' }
      const report = { crumbs: [...root.querySelectorAll('.abele-github-crumbs a')].map((a) => a.textContent) }
      const src = [...root.querySelectorAll('.abele-github-crumbs a')].find((a) => a.textContent === 'src')
      src.click()
      const listed = await until(() => leaf.view.model.url.endsWith('/tree/main/src') &&
        folderRows(root).length && root.querySelector('.abele-github-folder__readme h1'), 20000)
      if (!listed) return { ...report, error: 'the folder never listed' }
      report.folderUrl = leaf.view.model.url
      report.rows = folderRows(root)
      report.readme = root.querySelector('.abele-github-folder__readme h1').textContent
      await wait(500)
      report.shot = await shoot('desktop-folder.png')
      root.querySelector('.abele-github-folder .tree-item-self[data-path="src/loader.ts"]').click()
      if (!(await until(() => loaded(leaf, 'src/loader.ts'), 20000))) return { ...report, error: 'the entry never opened' }
      report.fileUrl = leaf.view.model.url
      await leaf.history.back()
      await until(() => leaf.view.model.url.includes('/tree/') && folderRows(root).length, 15000)
      report.backUrl = leaf.view.model.url
      report.tabs = githubLeaves().length
      leaf.detach()
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.crumbs).toEqual(['widgets', 'src'])
    expect(r.folderUrl).toBe(`${gh.web}/tree/main/src`)
    expect(r.rows).toEqual([
      'src/util',
      'src/app.ts',
      'src/loader.ts',
      'src/long.ts',
      'src/README.md',
    ])
    expect(r.readme).toBe('Source')
    expect(r.shot).toMatch(/\.png$/)
    expect(r.fileUrl).toBe(`${gh.web}/blob/main/src/loader.ts`)
    expect(r.backUrl).toBe(`${gh.web}/tree/main/src`)
    // All of it in the one tab.
    expect(r.tabs).toBe(1)
  })

  it.each([false, true])('marks and filters the head tree with remembered=%s', (open) => {
    const r = evalAsync<{
      error?: string
      folderUrl?: string
      active?: string[]
      filtered?: string[]
      fileUrl?: string
      folderPage?: string
      stillOpen?: boolean
      activeAfter?: string[]
      beside?: { panelRight: number; mainLeft: number; panelWidth: number }
      shot?: string
    }>(`(async () => {
      ${PRELUDE}
      ${TREE}
      app.saveLocalStorage(${JSON.stringify(PANEL_KEY)}, ${open})
      const leaf = await openTab(${JSON.stringify(`${gh.web}/pull/42/files`)})
      const root = leaf.view.containerEl
      const dir = await until(() => [...root.querySelectorAll('.abele-github-file[data-path="src/util/format.ts"] .abele-github-file__folder-link, .abele-github-file[data-path="src/app.ts"] .abele-github-file__folder-link')]
        .find((a) => a.textContent === 'src'), 20000)
      if (!dir) return { error: 'no folder link in the diff header' }
      dir.click()
      if (!(await until(() => leaf.view.model.url.includes('/tree/') && folderRows(root).length, 20000)))
        return { error: 'the folder never listed' }
      const report = { folderUrl: leaf.view.model.url }
      const icon = headerIcon(root, 'folder-tree')
      if (!icon) return { ...report, error: 'no tree icon' }
      if (!root.querySelector('.abele-github-tree')) icon.click()
      if (!(await until(() => root.querySelector('.abele-github-tree__filter input') &&
        panelRow(root, 'src')?.classList.contains('is-active'), 20000)))
        return { ...report, error: 'the panel never marked the folder' }
      report.active = [...root.querySelectorAll('.abele-github-tree .tree-item-self.is-active')].map((r) => r.getAttribute('data-path'))
      const input = root.querySelector('.abele-github-tree__filter input')
      input.value = 'format'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await until(() => panelRows(root).length === 3, 5000)
      report.filtered = panelRows(root)
      panelRow(root, 'src/util/format.ts').click()
      if (!(await until(() => loaded(leaf, 'src/util/format.ts'), 20000))) return { ...report, error: 'the file never opened' }
      report.fileUrl = leaf.view.model.url
      input.value = ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await until(() => panelRow(root, 'src/util'), 5000)
      // Mod-click on a folder: its page, in this tab; the file comes back after.
      panelRow(root, 'src/util').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true, ctrlKey: false }))
      await until(() => leaf.view.model.url.endsWith('/src/util') && folderRows(root).length, 15000)
      report.folderPage = leaf.view.model.url
      await leaf.history.back()
      if (!(await until(() => loaded(leaf, 'src/util/format.ts'), 15000))) return { ...report, error: 'back never returned' }
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await until(() => panelRow(root, 'src/util/format.ts')?.classList.contains('is-active'), 10000)
      report.stillOpen = !!root.querySelector('.abele-github-tree')
      report.activeAfter = [...root.querySelectorAll('.abele-github-tree .tree-item-self.is-active')].map((r) => r.getAttribute('data-path'))
      const panel = root.querySelector('.abele-github-layout__panel').getBoundingClientRect()
      const main = root.querySelector('.abele-github-layout__main').getBoundingClientRect()
      report.beside = { panelRight: Math.round(panel.right), mainLeft: Math.round(main.left), panelWidth: Math.round(panel.width) }
      await wait(500)
      report.shot = await shoot('desktop-panel.png')
      leaf.view.model.tree = false
      leaf.detach()
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.folderUrl).toBe(`${gh.web}/tree/${HEAD_SHA}/src`)
    expect(r.active).toEqual(['src'])
    expect(r.filtered).toEqual(['src', 'src/util', 'src/util/format.ts'])
    expect(r.fileUrl).toBe(`${gh.web}/blob/${HEAD_SHA}/src/util/format.ts`)
    expect(r.folderPage).toBe(`${gh.web}/tree/${HEAD_SHA}/src/util`)
    expect(r.stillOpen).toBe(true)
    expect(r.activeAfter).toEqual(['src/util/format.ts'])
    // Beside the content, not over it.
    expect(r.beside!.mainLeft).toBeGreaterThanOrEqual(r.beside!.panelRight - 1)
    expect(r.beside!.panelWidth).toBeGreaterThan(150)
    expect(r.shot).toMatch(/\.png$/)
  })

  it('drags the divider and remembers its width after closing and reopening the tab', async () => {
    const ready = evalAsync<{ error?: string; width?: number }>(`(async () => {
      ${PRELUDE}
      app.saveLocalStorage(${JSON.stringify(PANEL_KEY)}, true)
      app.saveLocalStorage(${JSON.stringify(WIDTH_KEY)}, null)
      const leaf = await openTab(${JSON.stringify(`${gh.web}/blob/main/src/app.ts`)})
      const root = leaf.view.containerEl
      if (!(await until(() => loaded(leaf, 'src/app.ts') && root.querySelector('.abele-github-tree'), 20000)))
        return { error: 'no file tree' }
      const layout = root.querySelector('.abele-github-layout')
      if (layout.getBoundingClientRect().width <= 640) return { error: 'desktop split is too narrow' }
      return { width: root.querySelector('.abele-github-layout__panel').getBoundingClientRect().width }
    })()`)
    expect(ready.error).toBeUndefined()
    const handle = centreOf(
      `app.workspace.getLeavesOfType('abele-github')[0]?.view.containerEl.querySelector('.abele-github-layout__resize')`
    )
    expect(handle, 'the file tree has a draggable divider').not.toBeNull()
    await realDrag(handle!, { x: handle!.x - 50, y: handle!.y })
    const result = evalAsync<{ width: number; stored: number; reopened: number }>(`(async () => {
      ${PRELUDE}
      const leaf = githubLeaves()[0]
      const width = leaf.view.containerEl.querySelector('.abele-github-layout__panel').getBoundingClientRect().width
      const stored = app.loadLocalStorage(${JSON.stringify(WIDTH_KEY)})
      leaf.detach()
      const next = await openTab(${JSON.stringify(`${gh.web}/pull/42/files`)})
      await until(() => loaded(next, 'Rework the widget loader') && next.view.containerEl.querySelector('.abele-github-tree'), 20000)
      const reopened = next.view.containerEl.querySelector('.abele-github-layout__panel').getBoundingClientRect().width
      return { width, stored, reopened }
    })()`)
    expect(result.width).toBeCloseTo(ready.width! - 50, 0)
    expect(result.stored).toBeCloseTo(result.width, 0)
    expect(result.reopened).toBeCloseTo(result.width, 0)
  })

  it('keeps the split within its limits and double-click restores the default width', () => {
    const r = evalAsync<{
      error?: string
      min?: number
      max?: number
      widthMin?: number
      widthMax?: number
      reset?: number
      expectedReset?: number
      stored?: unknown
      focus?: boolean
    }>(`(async () => {
      ${PRELUDE}
      app.saveLocalStorage(${JSON.stringify(PANEL_KEY)}, true)
      const leaf = await openTab(${JSON.stringify(`${gh.web}/blob/main/src/app.ts`)})
      const root = leaf.view.containerEl
      if (!(await until(() => loaded(leaf, 'src/app.ts') && root.querySelector('.abele-github-layout__resize')?.tabIndex === 0, 20000)))
        return { error: 'no desktop divider' }
      const handle = root.querySelector('.abele-github-layout__resize')
      const panel = root.querySelector('.abele-github-layout__panel')
      const layout = root.querySelector('.abele-github-layout')
      const measure = () => panel.getBoundingClientRect().width
      const key = async (key) => {
        handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
      handle.focus()
      const report = { focus: document.activeElement === handle, min: Number(handle.getAttribute('aria-valuemin')), max: Number(handle.getAttribute('aria-valuemax')) }
      await key('Home')
      await key('ArrowLeft')
      report.widthMin = measure()
      await key('End')
      await key('ArrowRight')
      report.widthMax = measure()
      handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
      await new Promise(resolve => requestAnimationFrame(resolve))
      report.reset = measure()
      report.expectedReset = Math.min(parseFloat(getComputedStyle(layout).fontSize) * 18, layout.getBoundingClientRect().width * 0.4)
      report.stored = app.loadLocalStorage(${JSON.stringify(WIDTH_KEY)})
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.focus).toBe(true)
    expect(r.widthMin).toBeCloseTo(r.min!, 0)
    expect(r.widthMax).toBeCloseTo(r.max!, 0)
    expect(r.reset).toBeCloseTo(r.expectedReset!, 0)
    expect(r.stored).toBeNull()
  })

  it('opens a folder whose branch holds a slash', () => {
    const r = evalAsync<{ error?: string; ref?: string; rows?: string[] }>(`(async () => {
      ${PRELUDE}
      ${TREE}
      const leaf = await openTab(${JSON.stringify(`${gh.web}/tree/feature/paging/src/util`)})
      const root = leaf.view.containerEl
      if (!(await until(() => folderRows(root).length, 20000))) return { error: 'the folder never listed' }
      const report = {
        ref: root.querySelector('.abele-github-crumbs__ref')?.textContent,
        rows: folderRows(root),
      }
      leaf.detach()
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.ref).toBe('feature/paging')
    expect(r.rows).toEqual(['src/util/format.ts'])
  })
})
