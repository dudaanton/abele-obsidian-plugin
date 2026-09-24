/**
 * Searching in a GitHub tab, in the app, against the fake GitHub server: find in the tab, code
 * search across the whole repository, and go to definition.
 *
 * The whole-repository search and go to definition download the fake repository's archive and
 * unpack it in the app, so this is also the check that an archive shaped as GitHub's reads.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import {
  PRELUDE,
  enableGithub,
  evalAsync,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { HEAD_SHA } from './helpers/fakeGithubRepo'

const available = isObsidianRunning() && hasTestApi()

/** Presses the header icon drawn with `icon`, and types into the field `input` once it shows. */
const TOOLS = `
  const headerIcon = (root, icon) =>
    [...root.querySelectorAll('.abele-github-header__actions .abele-obsidian-icon')]
      .find((i) => i.querySelector('svg.lucide-' + icon))
  const type = (input, text) => {
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const key = (el, k, shiftKey = false) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }))
`

describe.skipIf(!available)('searching a GitHub tab', () => {
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
      restoreGithub()
    } finally {
      gh?.stop()
    }
  }, 60_000)

  it('finds in every diff of a pull request, and steps through the matches', () => {
    const r = evalAsync<{ error?: string; first?: string; second?: string; back?: string }>(
      `(async () => {
        ${PRELUDE}
        ${TOOLS}
        const leaf = await openTab(${JSON.stringify(`${gh.web}/pull/42/files`)})
        const root = leaf.view.containerEl
        await until(() => root.querySelectorAll('.abele-github-file .cm-editor').length === 5, 20000)
        headerIcon(root, 'search').click()
        const input = await until(() => root.querySelector('.abele-github-find input'), 5000)
        if (!input) return { error: 'no find bar' }
        type(input, 'reworked')
        const count = () => root.querySelector('.abele-github-find__count').textContent.trim()
        const report = {}
        report.first = await until(() => /of/.test(count()) && count(), 10000)
        key(input, 'Enter')
        report.second = await until(() => count() !== report.first && count(), 5000)
        key(input, 'Enter', true)
        report.back = await until(() => count() !== report.second && count(), 5000)
        leaf.detach()
        return report
      })()`
    )
    expect(r).toEqual({ first: '1 of 40', second: '2 of 40', back: '1 of 40' })
  })

  it('searches the whole repository, and a result opens its file at the line', () => {
    const r = evalAsync<{
      error?: string
      summary?: string
      files?: string[]
      opened?: string
      marked?: string
      tabs?: number
    }>(`(async () => {
      ${PRELUDE}
      ${TOOLS}
      const leaf = await openTab(${JSON.stringify(`${gh.web}/blob/main/src/app.ts`)})
      const root = leaf.view.containerEl
      if (!(await until(() => loaded(leaf, 'src/app.ts'), 20000))) return { error: 'no file' }
      headerIcon(root, 'file-search').click()
      const input = await until(() => root.querySelector('.abele-github-search__query input, input.abele-github-search__query'), 5000)
      if (!input) return { error: 'no search panel' }
      type(input, 'formatValue')
      key(input, 'Enter')
      const summary = await until(() => {
        const s = root.querySelector('.abele-github-search__summary')?.textContent.trim()
        return s && /line/.test(s) ? s : null
      }, 20000)
      const report = { summary, files: [...root.querySelectorAll('.abele-github-search__path > span:first-child')].map((e) => e.textContent) }
      const inFormat = [...root.querySelectorAll('.abele-github-search__file')]
        .find((f) => f.textContent.includes('src/util/format.ts'))
      inFormat.querySelector('.abele-github-search__line').click()
      const marked = await until(() => leaf.view.model.url.includes('format.ts') && root.querySelector('.abele-github-code__line_target'), 15000)
      report.opened = leaf.view.model.url
      report.marked = marked ? marked.textContent : ''
      report.tabs = githubLeaves().length
      leaf.detach()
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.summary).toBe('3 lines in 2 files')
    expect(r.files?.sort()).toEqual(['src/app.ts', 'src/util/format.ts'])
    expect(r.opened).toMatch(new RegExp(`/acme/widgets/blob/${HEAD_SHA}/src/util/format\\.ts#L1$`))
    expect(r.marked).toBe('export function formatValue(value: number): string {')
    // The result opened in the tab it was found from.
    expect(r.tabs).toBe(1)
  })

  it('goes to the definition of a name on a Mod-click', () => {
    const r = evalAsync<{ error?: string; opened?: string; marked?: string }>(`(async () => {
      ${PRELUDE}
      const leaf = await openTab(${JSON.stringify(`${gh.web}/blob/main/src/app.ts`)})
      const root = leaf.view.containerEl
      if (!(await until(() => loaded(leaf, 'src/app.ts') && root.querySelector('.cm-line'), 20000))) return { error: 'no file' }
      const line = [...root.querySelectorAll('.cm-line')].find((l) => l.textContent.includes('return formatValue('))
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      let node = null
      while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('formatValue')) { node = walker.currentNode; break }
      if (!node) return { error: 'no name to click' }
      const range = document.createRange()
      const at = node.nodeValue.indexOf('formatValue')
      range.setStart(node, at + 2)
      range.setEnd(node, at + 3)
      const r = range.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const target = document.elementFromPoint(x, y) || node.parentElement
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, metaKey: true, ctrlKey: false, clientX: x, clientY: y }))
      const marked = await until(() => leaf.view.model.url.includes('format.ts') && root.querySelector('.abele-github-code__line_target'), 20000)
      const report = { opened: leaf.view.model.url, marked: marked ? marked.textContent : '' }
      leaf.detach()
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.opened).toMatch(new RegExp(`/acme/widgets/blob/${HEAD_SHA}/src/util/format\\.ts#L1$`))
    expect(r.marked).toBe('export function formatValue(value: number): string {')
  })
})
