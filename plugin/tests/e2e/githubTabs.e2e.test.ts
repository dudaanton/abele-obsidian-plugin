/**
 * What a GitHub tab does once it is open, in the app, against the fake GitHub server.
 *
 * - A link to a line of a diff, to lines of a file and to a comment scrolls the tab so the target
 *   is on screen — happy-dom lays nothing out, so only the app can say where a line ends up.
 * - Lines selected by their numbers are copied as a link, written into the note last worked in as
 *   a link, and as a card holding the code, which the note then draws.
 * - A comparison opens on its files at the line a link names, lists its commits and swaps its sides.
 * - A markdown file opens rendered — a link to its lines too, with the block holding them marked —
 *   switches to its code at the same lines, and opens as code from `?plain=1` alone or when the
 *   setting says Code.
 * - The same link followed again, and a link to other lines of the same file, leave those lines
 *   drawn and on screen, in the code and in the rendered file.
 * - A changed file of a pull request opens whole: a deleted one at the base, at the line selected
 *   in the diff, and from its path, which is a link.
 * - Text is selected by a mouse drag — in a comment, a file's code and a diff — and Mod+C copies
 *   just the text: Obsidian makes its whole interface unselectable, so only the app can say.
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
  realCopy,
  realDrag,
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

    /**
     * The tab a link is followed in again — the same lines, then others of the same file — has
     * those lines drawn and on screen, not an empty stretch of the editor that a scroll fills in.
     */
    const again = (
      url: string,
      first: string,
      title: string,
      target: string,
      content: string,
      texts: [string, string]
    ) =>
      evalAsync<{ error?: string; steps?: { inView?: boolean; text?: string; drawn?: number }[] }>(
        `(async () => {
        ${PRELUDE}
        ${opening(first, title)}
        const look = async (text) => {
          const el = await until(() => [...root.querySelectorAll(${JSON.stringify(target)})]
            .find((e) => e.textContent.includes(text)), 15000)
          await wait(2500)
          if (!el || !el.isConnected) return { error: 'nothing marked' }
          const box = scroller(el).getBoundingClientRect()
          // What is drawn inside the visible area: a blank editor draws nothing there.
          const drawn = [...root.querySelectorAll(${JSON.stringify(content)})].filter((l) => {
            const r = l.getBoundingClientRect()
            return r.height > 0 && r.bottom > box.top && r.top < box.bottom
          }).length
          return { inView: placeInView(el).inView, text: el.textContent.trim().slice(0, 60), drawn }
        }
        const steps = [await look(${JSON.stringify(texts[0])})]
        for (const [next, text] of [[${JSON.stringify(first)}, ${JSON.stringify(texts[0])}], [${JSON.stringify(url)}, ${JSON.stringify(texts[1])}]]) {
          await leaf.setViewState({ type: 'abele-github', state: { url: next }, active: true })
          await wait(100)
          steps.push(await look(text))
        }
        leaf.detach()
        return { steps }
      })()`,
        120_000
      )

    it('lines of a long file, the same link again and then other lines', () => {
      const r = again(
        `${gh.web}/blob/main/src/long.ts#L120-L121`,
        `${gh.web}/blob/main/src/long.ts#L350-L352`,
        'src/long.ts',
        '.abele-github-code__line_target',
        '.abele-github-blob .cm-line',
        ['setting350', 'setting120']
      )
      expect(r.error).toBeUndefined()
      for (const step of r.steps!) {
        expect(step.inView).toBe(true)
        expect(step.drawn).toBeGreaterThan(10)
      }
      expect(r.steps![0].text).toContain('setting350')
      expect(r.steps![1].text).toContain('setting350')
      expect(r.steps![2].text).toContain('setting120')
    })

    it('lines of a markdown file, rendered, the same link again and then other lines', () => {
      const r = again(
        `${gh.web}/blob/main/README.md?plain=1#L3`,
        `${gh.web}/blob/main/README.md#L10`,
        'README.md',
        '.abele-github-md__block_marked',
        '.abele-github-md__block',
        ['npm install acme-widgets', 'Widgets loads']
      )
      expect(r.error).toBeUndefined()
      for (const step of r.steps!) {
        expect(step.inView).toBe(true)
        expect(step.drawn).toBeGreaterThan(0)
      }
      expect(r.steps![0].text).toContain('npm install acme-widgets')
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
    // The server's own origin, scheme and port included: the link opens outside Obsidian too.
    expect(r.copied).toBe(
      `[acme/widgets@1a2b3c4 · src/app.ts:5](${gh.web}/blob/${HEAD_SHA}/src/app.ts#L5)`
    )
    expect(r.link).toBe(true)
    expect(r.card).toBe(true)
    expect(r.cardCode).toContain('const widgets = loadWidgets(count)')
  })

  describe('a comparison', () => {
    const URL_ = () => `${gh.web}/compare/${BASE_SHA}...main`

    it('opens on its files at the line a link names, and says how far ahead head is', () => {
      const r = evalAsync<{
        error?: string
        inView?: boolean
        badge?: string
        meta?: string
        tabs?: string[]
        files?: number
      }>(`(async () => {
        ${PRELUDE}
        ${opening(`${URL_()}#diff-${diffHash('src/long.ts')}R300`, '...main')}
        const el = await until(() => root.querySelector('.abele-github-code__line_target'), 15000)
        if (!el) return { error: 'nothing marked' }
        await wait(2500)
        const at = placeInView(el)
        const out = {
          inView: at.inView,
          badge: root.querySelector('.abele-github-header .abele-badge')?.textContent.trim(),
          meta: root.querySelector('.abele-github-header__meta')?.textContent,
          tabs: [...root.querySelectorAll('.abele-tabs__label')].map((t) => t.textContent.trim()),
          files: root.querySelectorAll('.abele-github-file').length,
        }
        leaf.detach()
        return out
      })()`)
      expect(r.error).toBeUndefined()
      expect(r.inView).toBe(true)
      expect(r.badge).toBe('ahead')
      expect(r.meta).toContain('2 commits ahead')
      expect(r.tabs).toEqual(['Files (5)', 'Commits (2)'])
      expect(r.files).toBe(5)
    })

    it('lists its commits, and swaps its sides in the same tab', () => {
      const r = evalAsync<{ error?: string; commits?: string[]; url?: string; title?: string }>(
        `(async () => {
        ${PRELUDE}
        ${opening(URL_(), '...main')}
        const tab = [...root.querySelectorAll('.abele-tabs__tab')].find((t) => t.textContent.includes('Commits'))
        tab.click()
        await until(() => root.querySelector('.abele-github-commits'), 5000)
        const commits = [...root.querySelectorAll('.abele-github-commits .abele-card__title')].map((t) => t.textContent.trim())
        const swap = [...root.querySelectorAll('.abele-github-header__actions .abele-obsidian-icon')]
          .find((i) => (i.getAttribute('aria-label') ?? '').startsWith('Swap'))
        if (!swap) return { error: 'no swap button', commits }
        swap.click()
        await until(() => loaded(leaf, 'main...${BASE_SHA.slice(0, 7)}'), 15000)
        const out = {
          commits,
          url: leaf.view.getState().url,
          title: root.querySelector('.abele-github-header__title')?.textContent.trim(),
        }
        leaf.detach()
        return out
      })()`
      )
      expect(r.error).toBeUndefined()
      expect(r.commits).toEqual(['Add the loader', 'Rework the widget loader'])
      expect(r.url).toBe(`${gh.web}/compare/main...${BASE_SHA}`)
      expect(r.title).toBe(`main...${BASE_SHA.slice(0, 7)}`)
    })
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

    it('opens as code from ?plain=1', () => {
      const r = evalAsync<{ plain?: boolean; error?: string }>(`(async () => {
        ${PRELUDE}
        ${opening(`${gh.web}/blob/main/README.md?plain=1`, 'README.md')}
        const report = {}
        report.plain = !!(await until(() => root.querySelector('.abele-github-blob .cm-editor'), 10000)) && !root.querySelector('.abele-github-md')
        leaf.detach()
        return report
      })()`)
      expect(r).toEqual({ plain: true })
    })

    it('opens a link to its lines rendered, the block holding them marked; Code shows the same lines', () => {
      const r = evalAsync<{
        error?: string
        block?: string
        inView?: boolean
        line?: string
        lineInView?: boolean
      }>(`(async () => {
        ${PRELUDE}
        ${opening(`${gh.web}/blob/main/README.md#L10`, 'README.md')}
        const block = await until(() => root.querySelector('.abele-github-md__block_marked'), 15000)
        if (!block) return { error: 'no marked block' }
        await wait(2500)
        const report = { block: block.textContent.trim(), inView: placeInView(block).inView }
        const tab = [...root.querySelectorAll('.abele-github-blob__modes .abele-tabs__tab')].find((t) => t.textContent.includes('Code'))
        tab.click()
        const line = await until(() => root.querySelector('.abele-github-code__line_target'), 15000)
        await wait(2500)
        report.line = line?.textContent
        report.lineInView = line ? placeInView(line).inView : false
        leaf.detach()
        return report
      })()`)
      expect(r.error).toBeUndefined()
      expect(r.block).toContain('npm install acme-widgets')
      expect(r.inView).toBe(true)
      expect(r.line).toBe('npm install acme-widgets')
      expect(r.lineInView).toBe(true)
    })

    it('opens a link to its lines as code when that is the setting', () => {
      const r = evalAsync<{ line?: string; md?: boolean }>(`(async () => {
        ${PRELUDE}
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.github = { ...config.github, markdownView: 'code' }
        try {
          ${opening(`${gh.web}/blob/main/README.md#L10`, 'README.md')}
          const line = await until(() => root.querySelector('.abele-github-code__line_target'), 15000)
          const report = { line: line?.textContent, md: !!root.querySelector('.abele-github-md') }
          leaf.detach()
          return report
        } finally {
          config.github = { ...config.github, markdownView: 'preview' }
        }
      })()`)
      expect(r).toEqual({ line: 'npm install acme-widgets', md: false })
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
      expect(r.deleted).toBe(`${gh.web}/blob/${BASE_SHA}/src/old.ts`)
      expect(r.deletedText).toBe(true)
      expect(r.back).toBe(`${gh.web}/pull/42/files`)
      expect(r.selected).toBe(`${gh.web}/blob/${HEAD_SHA}/src/app.ts#L5`)
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

  describe('people', () => {
    it('are shown by name with their picture, kept as data, the login a click away', async () => {
      const queries = () => gh.requests().filter((l) => l.startsWith('POST /api/graphql')).length
      const before = queries()
      const r = evalAsync<{
        error?: string
        meta?: string
        authors?: string[]
        pictures?: string[]
        tooltip?: string
        swapped?: string
        requests?: number
      }>(`(async () => {
        ${PRELUDE}
        await window.__abeleTest.githubUsers().clear()
        ${opening(`${gh.web}/pull/42`, 'Rework the widget loader')}
        const named = await until(() => {
          const a = root.querySelector('.abele-github-comment__author img')
          return a && a.src.startsWith('data:image/png') &&
            root.querySelector('.abele-github-header__meta').textContent.includes('Alice Example')
        }, 15000)
        if (!named) return { error: 'the names and pictures never came' }
        const authors = [...root.querySelectorAll('.abele-github-comment__author')]
        const report = {
          meta: root.querySelector('.abele-github-header__meta').textContent.replace(/\\s+/g, ' ').trim(),
          authors: [...new Set(authors.map((a) => a.textContent.trim()))],
          pictures: [...new Set(authors.map((a) => (a.querySelector('img')?.src ?? '').slice(0, 15)))],
          tooltip: authors[1].getAttribute('aria-label'),
        }
        authors[1].click()
        await wait(100)
        report.swapped = authors[1].textContent.trim()
        leaf.detach()
        return report
      })()`)
      expect(r.error).toBeUndefined()
      expect(r.meta).toContain('Alice Example opened')
      // bob, carol and dave comment in turn; carol's profile has no name.
      expect(r.authors).toEqual(expect.arrayContaining(['Bob Example', 'carol', 'Dave Example']))
      expect(r.pictures).toEqual(['data:image/png;'])
      expect(r.tooltip).toMatch(/ · (bob|dave)$/)
      expect(r.swapped).toMatch(/^(bob|dave)$/)
      // Everyone on the conversation was asked about in one query. The server's log is read only
      // while the worker is not blocked on an eval, so it is given a moment to arrive.
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(queries() - before).toBe(1)
    })
  })

  describe('text can be selected and copied', () => {
    it('what the tab shows selects; its controls and line numbers do not', () => {
      const r = evalAsync<{
        error?: string
        text?: Record<string, string>
        none?: Record<string, string>
      }>(
        `(async () => {
          ${PRELUDE}
          const style = (root, selectors) => Object.fromEntries(selectors.map((s) => {
            const el = root.querySelector(s)
            return [s, el ? getComputedStyle(el).userSelect : 'missing']
          }))
          ${opening(`${gh.web}/pull/42`, 'Rework the widget loader')}
          await until(() => root.querySelector('.abele-github-comment__body p'), 15000)
          const text = style(root, [
            '.abele-github-header__title',
            '.abele-github-header__repo',
            '.abele-github-header__meta',
            '.abele-github-comment__author',
            '.abele-github-comment__body p',
          ])
          const none = style(root, [
            '.abele-github-header__actions .abele-obsidian-icon',
            '.abele-github__tabs .abele-tabs__tab',
          ])
          await leaf.setViewState({ type: 'abele-github', state: { url: ${JSON.stringify(`${gh.web}/pull/42/files`)} }, active: true })
          const froot = leaf.view.containerEl
          await until(() => froot.querySelector('.abele-github-file .cm-content .cm-line'), 15000)
          await wait(1000)
          Object.assign(text, style(froot, [
            '.abele-github-file .cm-content',
            '.abele-github-file .cm-line',
            '.abele-github-file__path',
          ]))
          Object.assign(none, style(froot, [
            '.abele-github-file .cm-gutters',
            '.abele-github-file .cm-gutterElement',
            '.abele-github-file__head > .abele-obsidian-icon',
            '.abele-github-file__stats',
          ]))
          leaf.detach()
          return { text, none }
        })()`
      )
      expect(r.error).toBeUndefined()
      for (const [s, v] of Object.entries(r.text!)) expect(`${s}: ${v}`).toBe(`${s}: text`)
      for (const [s, v] of Object.entries(r.none!)) expect(`${s}: ${v}`).toBe(`${s}: none`)
    })

    /**
     * Opens `url`, runs `points` — which returns where the drag starts and ends and the text it
     * should select — drags there with the mouse, presses Mod+C and reads what was selected and
     * what reached the clipboard. The clipboard is put back afterwards.
     */
    const dragAndCopy = (url: string, title: string, points: string) => {
      const setup = evalAsync<{
        error?: string
        from?: { x: number; y: number }
        to?: { x: number; y: number }
        expected?: string
      }>(`(async () => {
        ${PRELUDE}
        const clipboard = require('electron').clipboard
        window.__abeleSelectE2E = { kept: clipboard.readText() }
        clipboard.writeText('')
        const lineText = (line) => line.textContent
        /** The viewport box of character \`i\` of the text in \`el\`. */
        const charBox = (el, i) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
          const nodes = []
          while (walker.nextNode()) nodes.push(walker.currentNode)
          const total = nodes.reduce((n, t) => n + t.length, 0)
          let at = i < 0 ? total + i : i
          for (const t of nodes) {
            if (at < t.length) {
              const r = document.createRange()
              r.setStart(t, at)
              r.setEnd(t, at + 1)
              return r.getClientRects()[0] ?? r.getBoundingClientRect()
            }
            at -= t.length
          }
          return null
        }
        /** Brings \`el\` to the middle of the tab and waits until it stays there: diffs drawn above move it. */
        const settle = async (el) => {
          let last = null
          for (let i = 0, same = 0; i < 60 && same < 5; i++) {
            el.scrollIntoView({ block: 'center' })
            await wait(200)
            const top = Math.round(el.getBoundingClientRect().top)
            same = top === last ? same + 1 : 0
            last = top
          }
        }
        const middle = (box, side) => ({ x: Math.round(side === 'start' ? box.left + 1 : box.right - 1),
          y: Math.round(box.top + box.height / 2) })
        ${opening(url, title)}
        ${points}
      })()`)
      if (setup.error) return { error: setup.error }
      realDrag(setup.from!, setup.to!)
      realCopy()
      const read = evalAsync<{ selected: string; copied: string }>(`(async () => {
        ${PRELUDE}
        const clipboard = require('electron').clipboard
        const selected = String(window.getSelection())
        const copied = (await until(() => clipboard.readText(), 3000)) ?? ''
        clipboard.writeText(window.__abeleSelectE2E?.kept ?? '')
        delete window.__abeleSelectE2E
        window.getSelection().removeAllRanges()
        for (const l of githubLeaves()) l.detach()
        return { selected, copied }
      })()`)
      return { ...read, expected: setup.expected! }
    }

    const squash = (s: string) => s.replace(/\\s+/g, ' ').trim()

    it('a paragraph of a comment, dragged over, is selected and copied', () => {
      const r = dragAndCopy(
        `${gh.web}/pull/42`,
        'Rework the widget loader',
        `const p = await until(() => [...root.querySelectorAll('.abele-github-comment__body p')]
            .find((p) => p.textContent.startsWith('A longer thought')), 15000)
          if (!p) return { error: 'no comment paragraph' }
          await settle(p)
          return { from: middle(charBox(p, 0), 'start'), to: middle(charBox(p, -1), 'end'),
            expected: p.textContent }`
      )
      expect(r.error).toBeUndefined()
      expect(squash(r.selected!)).toBe(squash(r.expected!))
      expect(squash(r.copied!)).toBe(squash(r.expected!))
    })

    it('lines of a file’s code are selected and copied without their numbers', () => {
      const r = dragAndCopy(
        `${gh.web}/blob/main/src/app.ts`,
        'src/app.ts',
        `const lines = await until(() => {
            const l = [...root.querySelectorAll('.abele-github-blob .cm-content .cm-line')]
            return l.length >= 6 ? l : null
          }, 15000)
          if (!lines) return { error: 'no code' }
          await settle(lines[3])
          return { from: middle(charBox(lines[3], 0), 'start'), to: middle(charBox(lines[5], -1), 'end'),
            expected: lines.slice(3, 6).map(lineText).join('\\n') }`
      )
      expect(r.error).toBeUndefined()
      expect(r.expected).toBe(
        'export function startApp(count: number): string {\n' +
          '  const widgets = loadWidgets(count)\n' +
          '  return formatValue(widgets.length)'
      )
      expect(r.selected).toBe(r.expected)
      expect(r.copied).toBe(r.expected)
    })

    it('lines of a diff are copied as their text: no line numbers, no plus or minus', () => {
      const r = dragAndCopy(
        `${gh.web}/pull/42/files`,
        'Rework the widget loader',
        `const lines = await until(() => {
            const l = [...(root.querySelector('.abele-github-file[data-path="src/app.ts"]')
              ?.querySelectorAll('.cm-content .cm-line') ?? [])]
            return l.length >= 8 ? l : null
          }, 15000)
          if (!lines) return { error: 'no diff' }
          const first = lines.findIndex((l) => l.textContent.startsWith('export function startApp'))
          const last = lines.findIndex((l) => l.textContent === '  return formatValue(widgets.length)')
          if (first < 0 || last < first) return { error: 'the diff is not the one expected' }
          await settle(lines[first])
          return { from: middle(charBox(lines[first], 0), 'start'), to: middle(charBox(lines[last], -1), 'end'),
            expected: lines.slice(first, last + 1).map(lineText).join('\\n') }`
      )
      expect(r.error).toBeUndefined()
      expect(r.expected).toBe(
        'export function startApp(count: number): string {\n' +
          '  return formatValue(count)\n' +
          '  const widgets = loadWidgets(count)\n' +
          '  return formatValue(widgets.length)'
      )
      expect(r.selected).toBe(r.expected)
      expect(r.copied).toBe(r.expected)
    })
  })
})
