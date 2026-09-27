/**
 * A repository's lists of pull requests, issues and discussions in the app, against the fake
 * GitHub server:
 *
 * - "All" beside the front page's pull requests opens the list in the same tab;
 * - the state tabs and a filter rewrite the query, which the tab's address carries, and back
 *   returns to the list before;
 * - a row opens its item in the tab;
 * - discussions come from GraphQL, with their categories;
 *
 * and a picture goes to `/tmp/abele-github-lists/` — look at it. The phone's is in
 * `githubPhone.e2e.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import {
  PRELUDE,
  enableGithub,
  evalAsync,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'

const SHOTS = '/tmp/abele-github-lists'
const available = isObsidianRunning() && hasTestApi()

const LISTS = `
  const rowsOf = (root) => [...root.querySelectorAll('.abele-github-list-row .abele-github-list-row__name')]
    .map((r) => r.textContent.trim())
  const listReady = (leaf) => {
    const root = leaf?.view.containerEl
    return !!root && !!root.querySelector('.abele-github-list') &&
      !root.textContent.includes('Loading from GitHub')
  }
  const tabsOf = (root) => [...root.querySelectorAll('.abele-github-list__states .abele-tabs__tab')]
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
    }
    return 'no picture'
  }
`

describe.skipIf(!available)("a repository's lists", () => {
  let gh: FakeGithub

  beforeAll(async () => {
    gh = await startFakeGithub()
    enableGithub(gh.origin)
  }, 60_000)

  afterEach(() => {
    evalRaw(
      `(() => { for (const l of app.workspace.getLeavesOfType('abele-github')) l.detach(); return 'ok' })()`
    )
  })

  afterAll(() => {
    if (!available) return
    try {
      restoreGithub()
    } finally {
      gh?.stop()
    }
  })

  it('"All" on the front page opens the pull requests, filtered by state and author', () => {
    const r = evalAsync<{
      error?: string
      url?: string
      rows?: string[]
      tabs?: string[]
      closedUrl?: string
      closedRows?: string[]
      backUrl?: string
      authorUrl?: string
      authorRows?: string[]
      shot?: string
    }>(`(async () => {
      ${PRELUDE}
      ${LISTS}
      const leaf = await openTab(${JSON.stringify(gh.web)})
      const root = leaf.view.containerEl
      if (!(await until(() => root.querySelector('[data-list="pulls"] .tree-item-self'), 20000)))
        return { error: 'no front page' }
      root.querySelector('[data-list="pulls"] .abele-github-home__all').click()
      if (!(await until(() => leaf.view.model.url.endsWith('/pulls') && listReady(leaf) && rowsOf(root).length, 20000)))
        return { error: 'the list never opened: ' + root.textContent.slice(0, 300) }
      await wait(300)
      const report = {
        url: leaf.view.model.url,
        rows: rowsOf(root),
        tabs: tabsOf(root).map((t) => t.textContent.trim()),
        shot: await shoot('desktop-pulls.png'),
      }
      tabsOf(root)[1].click()
      await until(() => leaf.view.model.url.includes('is%3Aclosed') && listReady(leaf), 20000)
      report.closedUrl = leaf.view.model.url
      report.closedRows = rowsOf(root)
      // Obsidian writes the step into the tab's history once the navigation has settled.
      await until(() => leaf.history.backHistory.length >= 2, 5000)
      await leaf.history.back()
      await until(() => leaf.view.model.url.endsWith('/pulls') && listReady(leaf) && rowsOf(root).length, 20000)
      report.backUrl = leaf.view.model.url
      const author = root.querySelectorAll('.abele-github-list__filter input')[0]
      author.value = 'bob'
      author.dispatchEvent(new Event('change', { bubbles: true }))
      await until(() => leaf.view.model.url.includes('author%3Abob') && listReady(leaf), 20000)
      report.authorUrl = leaf.view.model.url
      report.authorRows = rowsOf(root)
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.url).toBe(`${gh.web}/pulls`)
    expect(r.rows).toEqual(['Rework the widget loader'])
    expect(r.tabs?.[0]).toContain('Open 1')
    expect(r.tabs?.[1]).toContain('Closed 0')
    expect(r.closedUrl).toBe(`${gh.web}/pulls?q=${encodeURIComponent('is:pr is:closed')}`)
    expect(r.closedRows).toEqual([])
    expect(r.backUrl).toBe(`${gh.web}/pulls`)
    expect(r.authorUrl).toBe(`${gh.web}/pulls?q=${encodeURIComponent('is:pr is:open author:bob')}`)
    expect(r.authorRows).toEqual([])
    expect(r.shot).toMatch(/\.png$/)
  })

  it('a row of the issues opens the issue in the tab', () => {
    const r = evalAsync<{ error?: string; rows?: string[]; url?: string }>(`(async () => {
      ${PRELUDE}
      ${LISTS}
      const leaf = await openTab(${JSON.stringify(`${gh.web}/issues`)})
      const root = leaf.view.containerEl
      if (!(await until(() => listReady(leaf) && rowsOf(root).length, 20000))) return { error: 'no list' }
      const rows = rowsOf(root)
      root.querySelector('.abele-github-list-row').click()
      if (!(await until(() => loaded(leaf, 'Loader hangs on an empty list'), 20000))) return { rows, error: 'no issue' }
      return { rows, url: leaf.view.model.url }
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.rows).toEqual(['Loader hangs on an empty list'])
    expect(r.url).toBe(`${gh.web}/issues/7`)
  })

  it('discussions come with their categories', () => {
    const r = evalAsync<{ error?: string; rows?: string[]; categories?: string[] }>(`(async () => {
      ${PRELUDE}
      ${LISTS}
      const leaf = await openTab(${JSON.stringify(`${gh.web}/discussions`)})
      const root = leaf.view.containerEl
      if (!(await until(() => listReady(leaf) && rowsOf(root).length && root.textContent.includes('Category'), 20000)))
        return { error: 'no list: ' + root.textContent.slice(0, 300) }
      const select = [...root.querySelectorAll('.abele-github-list__filter')].find((f) => f.textContent.startsWith('Category'))
      // Obsidian measures a dropdown with a copy of it beside; the options are the real one's.
      const real = select.querySelector('select:not(.is-measuring)')
      return { rows: rowsOf(root), categories: [...real.querySelectorAll('option')].map((o) => o.textContent) }
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.rows).toEqual(['How should paging work?'])
    expect(r.categories).toEqual(['Any category', 'Ideas', 'Q&A'])
  })
})
