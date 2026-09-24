/**
 * What a GitHub tab does once it is open, in the app, against the fake GitHub server.
 *
 * - A link to a line of a diff, to lines of a file and to a comment scrolls the tab so the target
 *   is on screen — happy-dom lays nothing out, so only the app can say where a line ends up.
 * - Lines selected by their numbers are copied as a link, written into the note last worked in as
 *   a link, and as a card holding the code, which the note then draws.
 * - A markdown file opens rendered, switches to its code, and opens as code from `?plain=1` or a
 *   link to its lines.
 * - A changed file of a pull request opens whole: a deleted one at the base, at the line selected
 *   in the diff, and from its path, which is a link.
 *
 * The clipboard is the machine's own: what it held is put back. See `helpers/githubLive.ts` for
 * the settings and the server.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import {
  PRELUDE,
  centreOf,
  enableGithub,
  evalAsync,
  realClick,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { BASE_SHA, HEAD_SHA, LATE_COMMENT, diffHash } from './helpers/fakeGithubRepo'

const NOTE = 'Abele GitHub insert probe.md'
const available = isObsidianRunning() && hasTestApi()

/**
 * Opens a URL in a new GitHub tab and waits for `title`; the tab is `leaf` in what follows. Goes
 * after `PRELUDE`, which every script starts with.
 */
const opening = (url: string, title: string, pane = 'tab') => `
  const leaf = await openTab(${JSON.stringify(url)}, ${JSON.stringify(pane)})
  const root = leaf.view.containerEl
  const ready = await until(() => loaded(leaf, ${JSON.stringify(title)}), 20000)
  if (!ready) return { error: 'the tab never showed ' + ${JSON.stringify(title)} }
`

/** Clicks the line number `n` in the first gutter matching `gutter` inside `scope`. */
const CLICK_NUMBER = `
  const clickNumber = async (scope, gutter, n) => {
    const cell = [...scope.querySelectorAll(gutter + ' .cm-gutterElement')]
      .find((e) => e.textContent.trim() === String(n))
    if (!cell) return false
    cell.scrollIntoView({ block: 'center' })
    await wait(200)
    const r = cell.getBoundingClientRect()
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
    return !!(await until(() => scope.querySelector('.abele-github-selection'), 5000))
  }
  const press = (scope, text) => {
    const b = [...scope.querySelectorAll('.abele-github-selection button')].find((x) => x.textContent.trim() === text)
    b?.click()
    return !!b
  }
`

describe.skipIf(!available)('a GitHub tab', () => {
  let gh: FakeGithub

  beforeAll(async () => {
    gh = await startFakeGithub()
    enableGithub(gh.origin)
    evalAsync(
      `(async () => { ${PRELUDE} for (const l of githubLeaves()) l.detach(); return {} })()`
    )
  }, 60_000)

  afterAll(() => {
    if (!available) return
    try {
      evalAsync(`(async () => {
        for (const l of app.workspace.getLeavesOfType('markdown'))
          if (l.view.file?.path === ${JSON.stringify(NOTE)}) l.detach()
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
        if (file) await app.vault.delete(file)
        return {}
      })()`)
      restoreGithub()
    } finally {
      gh?.stop()
    }
  }, 60_000)

  describe('scrolls to what a link names', () => {
    const place = (url: string, title: string, target: string) =>
      evalAsync<{ error?: string; inView?: boolean; top?: number; height?: number }>(`(async () => {
        ${PRELUDE}
        ${opening(url, title)}
        const el = await until(() => root.querySelector(${JSON.stringify(target)}), 15000)
        if (!el) return { error: 'nothing marked' }
        // The tab keeps the target pinned while what is above it settles.
        await wait(2500)
        const at = placeInView(el)
        leaf.detach()
        return at
      })()`)

    it('a line deep in a pull request’s diff', () => {
      const r = place(
        `${gh.web}/pull/42/files#diff-${diffHash('src/long.ts')}R300`,
        'Rework the widget loader',
        '.abele-github-code__line_target'
      )
      expect(r.error).toBeUndefined()
      expect(r.inView).toBe(true)
      // Near the top, with a few lines above it for context.
      expect(r.top!).toBeLessThan(r.height! / 2)
    })

    it('lines of a long file', () => {
      const r = place(
        `${gh.web}/blob/main/src/long.ts#L350-L352`,
        'src/long.ts',
        '.abele-github-code__line_target'
      )
      expect(r.error).toBeUndefined()
      expect(r.inView).toBe(true)
    })

    it('a comment late in the conversation', () => {
      const r = place(
        `${gh.web}/pull/42#issuecomment-${LATE_COMMENT}`,
        'Rework the widget loader',
        `[data-anchor="issuecomment-${LATE_COMMENT}"]`
      )
      expect(r.error).toBeUndefined()
      expect(r.inView).toBe(true)
    })
  })

  it('selected lines are copied, inserted as a link, and inserted with their code as a card', () => {
    const r = evalAsync<{
      error?: string
      copied?: string
      link?: boolean
      card?: boolean
      cardCode?: string
    }>(`(async () => {
      ${PRELUDE}
      ${CLICK_NUMBER}
      const clipboard = require('electron').clipboard
      const kept = clipboard.readText()
      const report = {}
      try {
        const stale = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
        if (stale) await app.vault.delete(stale)
        const file = await app.vault.create(${JSON.stringify(NOTE)}, '# Inserted\\n\\n')
        const note = app.workspace.getLeaf('tab')
        await note.openFile(file, { state: { mode: 'source' } })
        app.workspace.setActiveLeaf(note, { focus: true })
        note.view.editor.setCursor({ line: 2, ch: 0 })
        await wait(300)

        ${opening(`${gh.web}/blob/main/src/app.ts`, 'src/app.ts')}
        await until(() => root.querySelector('.cm-lineNumbers'), 10000)
        if (!(await clickNumber(root, '.cm-lineNumbers', 5))) return { error: 'no selection bar' }

        press(root, 'Copy link')
        report.copied = await until(() => { const t = clipboard.readText(); return t !== kept && t.includes('src/app.ts') ? t : null }, 10000)

        press(root, 'Insert into note')
        report.link = !!(await until(() => note.view.editor.getValue().includes('src/app.ts:5]('), 10000))

        press(root, 'Insert with code')
        await until(() => note.view.editor.getValue().includes('abele-github'), 10000)
        leaf.detach()
        await note.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(NOTE)}, mode: 'preview' } })
        const card = await until(() => note.view.containerEl.querySelector('.markdown-reading-view .abele-github-snippet .cm-content'), 10000)
        report.card = !!card
        report.cardCode = card ? card.textContent : ''
      } catch (e) {
        report.error = String(e && e.message || e)
      } finally {
        clipboard.writeText(kept)
      }
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.copied).toMatch(
      new RegExp(
        `^\\[acme/widgets@1a2b3c4 · src/app\\.ts:5\\]\\(https?://127\\.0\\.0\\.1(:\\d+)?/acme/widgets/blob/${HEAD_SHA}/src/app\\.ts#L5\\)$`
      )
    )
    expect(r.link).toBe(true)
    expect(r.card).toBe(true)
    expect(r.cardCode).toContain('const widgets = loadWidgets(count)')
  })

  describe('a markdown file', () => {
    it('opens rendered, and switches to its code', () => {
      const r = evalAsync<{ error?: string; rendered?: boolean; heading?: string; code?: boolean }>(
        `(async () => {
          ${PRELUDE}
          ${opening(`${gh.web}/blob/main/README.md`, 'README.md')}
          const md = await until(() => root.querySelector('.abele-github-md h2'), 10000)
          const report = { rendered: !!md && !root.querySelector('.abele-github-blob .cm-editor'), heading: md?.textContent }
          const tab = [...root.querySelectorAll('.abele-github-blob__modes .abele-tabs__tab')].find((t) => t.textContent.includes('Code'))
          tab.click()
          report.code = !!(await until(() => root.querySelector('.abele-github-blob .cm-editor') && !root.querySelector('.abele-github-md'), 10000))
          leaf.detach()
          return report
        })()`
      )
      expect(r).toEqual({ rendered: true, heading: 'Install', code: true })
    })

    it('opens as code from ?plain=1, and from a link to its lines', () => {
      const r = evalAsync<{ plain?: boolean; lines?: string; error?: string }>(`(async () => {
        ${PRELUDE}
        ${opening(`${gh.web}/blob/main/README.md?plain=1`, 'README.md')}
        const report = {}
        report.plain = !!(await until(() => root.querySelector('.abele-github-blob .cm-editor'), 10000)) && !root.querySelector('.abele-github-md')
        leaf.detach()
        const next = await openTab(${JSON.stringify(`${gh.web}/blob/main/README.md#L10`)})
        const marked = await until(() => next.view.containerEl.querySelector('.abele-github-code__line_target'), 15000)
        report.lines = marked ? marked.textContent : ''
        next.detach()
        return report
      })()`)
      expect(r).toEqual({ plain: true, lines: 'npm install acme-widgets' })
    })
  })

  describe('a changed file of a pull request', () => {
    it('opens whole: a deleted one at the base, then at the line selected in the diff', () => {
      const r = evalAsync<{
        error?: string
        deleted?: string
        deletedText?: boolean
        back?: string
        selected?: string
        marked?: string
      }>(`(async () => {
        ${PRELUDE}
        ${CLICK_NUMBER}
        ${opening(`${gh.web}/pull/42/files`, 'Rework the widget loader')}
        const file = (path) => root.querySelector('.abele-github-file[data-path="' + path + '"]')
        await until(() => file('src/old.ts'), 15000)
        const report = {}
        file('src/old.ts').querySelector('.abele-github-file__open').click()
        await until(() => leaf.view.model.url.includes('/blob/') && loaded(leaf, 'src/old.ts'), 15000)
        report.deleted = leaf.view.model.url
        report.deletedText = root.textContent.includes('Kept for the old dashboard')

        root.closest('.workspace-leaf-content').querySelector('.view-header-nav-buttons button').click()
        await until(() => file('src/app.ts')?.querySelector('.cm-editor'), 15000)
        report.back = leaf.view.model.url
        if (!(await clickNumber(file('src/app.ts'), '.abele-github-code__gutter_new', 5)))
          return { ...report, error: 'no selection in the diff' }
        file('src/app.ts').querySelector('.abele-github-file__open').click()
        const marked = await until(() => leaf.view.model.url.includes('/blob/') && root.querySelector('.abele-github-code__line_target'), 15000)
        report.selected = leaf.view.model.url
        report.marked = marked ? marked.textContent : ''
        leaf.detach()
        return report
      })()`)
      expect(r.error).toBeUndefined()
      expect(r.deleted).toMatch(new RegExp(`/acme/widgets/blob/${BASE_SHA}/src/old\\.ts$`))
      expect(r.deletedText).toBe(true)
      expect(r.back).toBe(`${gh.web}/pull/42/files`)
      expect(r.selected).toMatch(new RegExp(`/acme/widgets/blob/${HEAD_SHA}/src/app\\.ts#L5$`))
      expect(r.marked).toBe('  const widgets = loadWidgets(count)')
    })

    it('opens from its path, a link: a markdown file rendered', () => {
      const setup = evalAsync<{ error?: string }>(`(async () => {
        ${PRELUDE}
        ${opening(`${gh.web}/pull/42/files`, 'Rework the widget loader')}
        await until(() => root.querySelector('.abele-github-file[data-path="README.md"] a.abele-github-file__path-link'), 15000)
        return {}
      })()`)
      expect(setup.error).toBeUndefined()
      const at = centreOf(
        `app.workspace.getLeavesOfType('abele-github')[0].view.containerEl.querySelector('.abele-github-file[data-path="README.md"] a.abele-github-file__path-link')`
      )
      realClick(at!.x, at!.y)
      const r = evalAsync<{ url: string; rendered: boolean; tabs: number }>(`(async () => {
        ${PRELUDE}
        const leaf = githubLeaves()[0]
        const md = await until(() => leaf.view.containerEl.querySelector('.abele-github-md h2'), 15000)
        const report = { url: leaf.view.model.url, rendered: !!md, tabs: githubLeaves().length }
        for (const l of githubLeaves()) l.detach()
        return report
      })()`)
      expect(r.url).toMatch(new RegExp(`/acme/widgets/blob/${HEAD_SHA}/README\\.md$`))
      expect(r.rendered).toBe(true)
      expect(r.tabs).toBe(1)
    })
  })
})
