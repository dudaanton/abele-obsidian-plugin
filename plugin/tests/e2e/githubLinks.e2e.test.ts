/**
 * A GitHub link clicked in a note, in the app, against a fake GitHub Enterprise server.
 *
 * The clicks are real ones — sent through the page's input pipeline with CDP — because what is
 * under test is who gets the click: the plugin's capture listener, or Obsidian's own handler that
 * would send the link to the browser. A dispatched DOM event would skip half of that.
 *
 * Covered: Reading view and Live Preview, the tab a plain click reuses, a Mod-click's new tab, the
 * tab's back arrow, and the links in a note's properties — in the Properties panel and in the note
 * — with Alt taking one to the browser (`window.open` stubbed, so no browser actually opens).
 *
 * The integration is switched on in memory against the fake server and put back after; the note
 * the file writes is deleted. See `helpers/githubLive.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import {
  ALT,
  META,
  PRELUDE,
  centreOf,
  enableGithub,
  evalAsync,
  realClick,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'

const NOTE = 'Abele GitHub links probe.md'
const available = isObsidianRunning() && hasTestApi()

interface Tab {
  url: string
  title: string
}

describe.skipIf(!available)('GitHub links in a note', () => {
  let gh: FakeGithub
  let PR = ''
  let ISSUE = ''
  let DISCUSSION = ''

  /** The GitHub tabs once `title` shows in one of them, or whatever there is after 20 s. */
  const tabsOnce = (title: string) =>
    evalAsync<{ tabs: Tab[]; active: string }>(`(async () => {
      ${PRELUDE}
      await until(() => githubLeaves().some((l) => loaded(l, ${JSON.stringify(title)})), 20000)
      await wait(300)
      return { tabs: tabs(), active: app.workspace.activeLeaf?.view.getViewType() ?? '' }
    })()`)

  /** Brings the probe note forward in the mode asked for, and waits for its links. */
  const showNote = (mode: 'preview' | 'live') =>
    evalAsync<{ ok: boolean }>(`(async () => {
      ${PRELUDE}
      const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === ${JSON.stringify(NOTE)})
      await leaf.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(NOTE)},
        mode: ${JSON.stringify(mode === 'preview' ? 'preview' : 'source')}, source: false } })
      app.workspace.setActiveLeaf(leaf, { focus: true })
      if (${JSON.stringify(mode)} === 'live') {
        const editor = leaf.view.editor
        editor.setCursor({ line: editor.lineCount() - 1, ch: 0 })
      }
      const ok = await until(() => ${
        mode === 'preview'
          ? `leaf.view.previewMode.containerEl.querySelector('a.external-link')`
          : `[...leaf.view.containerEl.querySelectorAll('.cm-underline')].some((e) => e.textContent === 'the discussion')`
      }, 10000)
      await wait(300)
      return { ok: !!ok }
    })()`)

  const noteLeaf = `app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === ${JSON.stringify(NOTE)})`

  beforeAll(async () => {
    gh = await startFakeGithub()
    PR = `${gh.web}/pull/42`
    ISSUE = `${gh.web}/issues/7`
    DISCUSSION = `${gh.web}/discussions/3`
    enableGithub(gh.origin)
    const text = [
      '---',
      `pr: ${PR}`,
      'refs:',
      `  - ${ISSUE}`,
      '---',
      '# GitHub links',
      '',
      `- [the pull request](${PR})`,
      `- [the issue](${ISSUE})`,
      `- [the discussion](${DISCUSSION})`,
      '',
      'The end.',
      '',
    ].join('\n')
    evalAsync(`(async () => {
      ${PRELUDE}
      for (const l of githubLeaves()) l.detach()
      const stale = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      if (stale) await app.vault.delete(stale)
      const file = await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(text)})
      await app.workspace.getLeaf('tab').openFile(file)
      return {}
    })()`)
  }, 60_000)

  afterAll(() => {
    if (!available) return
    try {
      evalAsync(`(async () => {
        ${PRELUDE}
        for (const l of app.workspace.getLeavesOfType('file-properties')) if (l.__abeleE2E) l.detach()
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

  it('Reading view: a plain click opens the pull request in a tab', () => {
    expect(showNote('preview').ok).toBe(true)
    const at = centreOf(`${noteLeaf}.view.previewMode.containerEl.querySelector('a[href="${PR}"]')`)
    expect(at).not.toBeNull()
    realClick(at!.x, at!.y)

    const { tabs, active } = tabsOnce('Rework the widget loader')
    expect(tabs).toEqual([{ url: PR, title: expect.stringContaining('Rework the widget loader') }])
    expect(active).toBe('abele-github')
  })

  it('a second plain click follows the link in the same GitHub tab', () => {
    showNote('preview')
    const at = centreOf(
      `${noteLeaf}.view.previewMode.containerEl.querySelector('a[href="${ISSUE}"]')`
    )
    realClick(at!.x, at!.y)

    const { tabs } = tabsOnce('Loader hangs on an empty list')
    expect(tabs.map((t) => t.url)).toEqual([ISSUE])
  })

  it('the tab’s back arrow returns to the pull request', () => {
    const { tabs } = evalAsync<{ tabs: Tab[] }>(`(async () => {
      ${PRELUDE}
      const leaf = githubLeaves()[0]
      app.workspace.setActiveLeaf(leaf, { focus: true })
      const back = leaf.view.containerEl.querySelector('.view-header-nav-buttons button')
      back.click()
      await until(() => loaded(githubLeaves()[0], 'Rework the widget loader'), 15000)
      return { tabs: tabs() }
    })()`)
    expect(tabs.map((t) => t.url)).toEqual([PR])
  })

  it('a Mod-click opens a new tab, and the one already open stays as it was', () => {
    showNote('preview')
    const at = centreOf(
      `${noteLeaf}.view.previewMode.containerEl.querySelector('a[href="${ISSUE}"]')`
    )
    realClick(at!.x, at!.y, META)

    const { tabs } = tabsOnce('Loader hangs on an empty list')
    expect(tabs.map((t) => t.url).sort()).toEqual([ISSUE, PR].sort())
  })

  it('Live Preview: a plain click on the link text opens it in the GitHub tab used last', () => {
    expect(showNote('live').ok).toBe(true)
    const at = centreOf(
      `[...${noteLeaf}.view.containerEl.querySelectorAll('.cm-underline')].find((e) => e.textContent === 'the discussion')`
    )
    expect(at).not.toBeNull()
    realClick(at!.x, at!.y)

    const { tabs } = tabsOnce('How should paging work?')
    // Two tabs still: the discussion replaced what the last used one showed.
    expect(tabs).toHaveLength(2)
    expect(tabs.map((t) => t.url)).toContain(DISCUSSION)
  })

  describe('a link in the properties', () => {
    it('opens from the Properties panel on a plain click', () => {
      const shown = evalAsync<{ ok: boolean }>(`(async () => {
        ${PRELUDE}
        for (const l of githubLeaves()) l.detach()
        const note = ${noteLeaf}
        // The Properties view beside the note rather than in the sidebar: a folded sidebar opens
        // with a transition, which a window behind others never finishes painting.
        const panel = app.workspace.createLeafBySplit(note, 'vertical')
        panel.__abeleE2E = true
        await panel.setViewState({ type: 'file-properties', active: false })
        app.workspace.setActiveLeaf(note, { focus: true })
        const ok = await until(() => panel.view.containerEl.querySelector('.metadata-link-inner'), 10000)
        await wait(300)
        return { ok: !!ok }
      })()`)
      expect(shown.ok).toBe(true)
      const at = centreOf(
        `app.workspace.getLeavesOfType('file-properties').find((l) => l.__abeleE2E).view.containerEl.querySelector('.metadata-link-inner')`
      )
      realClick(at!.x, at!.y)

      const { tabs } = tabsOnce('Rework the widget loader')
      expect(tabs.map((t) => t.url)).toEqual([PR])
    })

    it('opens a list property’s address in a new tab on a Mod-click', () => {
      evalAsync(`(async () => {
        ${PRELUDE}
        // The tab the first click opened went in front of the panel, in the panel's own group.
        app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('file-properties').find((l) => l.__abeleE2E))
        app.workspace.setActiveLeaf(${noteLeaf}, { focus: true })
        await until(() => app.workspace.getLeavesOfType('file-properties').find((l) => l.__abeleE2E).view.containerEl.querySelector('.multi-select-pill-content'), 10000)
        await wait(300)
        return {}
      })()`)
      const at = centreOf(
        `app.workspace.getLeavesOfType('file-properties').find((l) => l.__abeleE2E).view.containerEl.querySelector('.multi-select-pill-content')`
      )
      realClick(at!.x, at!.y, META)

      const { tabs } = tabsOnce('Loader hangs on an empty list')
      expect(tabs.map((t) => t.url).sort()).toEqual([ISSUE, PR].sort())
    })

    it('opens from the properties shown in the note, and Alt leaves it to the browser', () => {
      const setup = evalAsync<{ ok: boolean; before: string }>(`(async () => {
        ${PRELUDE}
        for (const l of githubLeaves()) l.detach()
        for (const l of app.workspace.getLeavesOfType('file-properties')) if (l.__abeleE2E) l.detach()
        const before = app.vault.getConfig('propertiesInDocument')
        window.__abeleGithubE2E.propertiesInDocument = before
        app.vault.setConfig('propertiesInDocument', 'visible')
        const note = ${noteLeaf}
        await note.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(NOTE)}, mode: 'preview' } })
        app.workspace.setActiveLeaf(note, { focus: true })
        const ok = await until(() => note.view.containerEl.querySelector('.markdown-reading-view .metadata-link-inner'), 10000)
        const shown = ok && ok.getBoundingClientRect().height > 0
        return { ok: !!shown, before }
      })()`)
      try {
        expect(setup.ok).toBe(true)
        const link = `${noteLeaf}.view.containerEl.querySelector('.markdown-reading-view .metadata-link-inner')`

        // Alt first, with the browser stubbed: it must be Obsidian that opens it, and no tab.
        evalAsync(`(async () => {
          window.__abeleGithubE2E.opened = []
          window.__abeleGithubE2E.open = window.open
          window.open = (url) => { window.__abeleGithubE2E.opened.push(String(url)); return null }
          return {}
        })()`)
        const at = centreOf(link)
        realClick(at!.x, at!.y, ALT)
        const alt = evalAsync<{ opened: string[]; tabs: number }>(`(async () => {
          ${PRELUDE}
          await until(() => window.__abeleGithubE2E.opened.length, 3000)
          window.open = window.__abeleGithubE2E.open
          return { opened: window.__abeleGithubE2E.opened, tabs: githubLeaves().length }
        })()`)
        expect(alt).toEqual({ opened: [PR], tabs: 0 })

        const again = centreOf(link)
        realClick(again!.x, again!.y)
        const { tabs } = tabsOnce('Rework the widget loader')
        expect(tabs.map((t) => t.url)).toEqual([PR])
      } finally {
        evalAsync(`(async () => {
          if (window.__abeleGithubE2E.open) window.open = window.__abeleGithubE2E.open
          app.vault.setConfig('propertiesInDocument', ${JSON.stringify(setup.before)})
          return {}
        })()`)
      }
    })
  })
})
