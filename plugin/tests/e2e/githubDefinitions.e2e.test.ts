/**
 * Go to definition in a GitHub tab whose repository cannot be downloaded, in the app, against
 * the fake GitHub server refusing the archive: a name declared in the file shown still opens at
 * its line, without the archive being asked for, and a name declared elsewhere is looked for in
 * the file shown and said to be missing there, with the reason, rather than failing outright.
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

/** Opens `src/app.ts` and Mod-clicks `name` on the first line holding `line`. */
const modClick = (web: string, line: string, name: string) => `(async () => {
  ${PRELUDE}
  for (const n of document.querySelectorAll('.notice')) n.remove()
  const leaf = await openTab(${JSON.stringify(`${web}/blob/main/src/app.ts`)})
  const root = leaf.view.containerEl
  if (!(await until(() => loaded(leaf, 'src/app.ts') && root.querySelector('.cm-line'), 20000))) return { error: 'no file' }
  const row = [...root.querySelectorAll('.cm-line')].find((l) => l.textContent.includes(${JSON.stringify(line)}))
  if (!row) return { error: 'no line' }
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  let node = null
  while (walker.nextNode()) if (walker.currentNode.nodeValue.includes(${JSON.stringify(name)})) { node = walker.currentNode; break }
  if (!node) return { error: 'no name to click' }
  const range = document.createRange()
  const at = node.nodeValue.indexOf(${JSON.stringify(name)})
  range.setStart(node, at + 1)
  range.setEnd(node, at + 2)
  const r = range.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  const hit = document.elementFromPoint(x, y)
  const target = hit && row.contains(hit) ? hit : node.parentElement
  const before = leaf.view.model.url
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, metaKey: true, ctrlKey: false, clientX: x, clientY: y }))
  const said = () => [...document.querySelectorAll('.notice')].map((n) => n.textContent).find((t) => /definition|look up/i.test(t))
  const marked = await until(() => (leaf.view.model.url !== before && root.querySelector('.abele-github-code__line_target')) || said(), 20000)
  const report = {
    opened: leaf.view.model.url,
    marked: root.querySelector('.abele-github-code__line_target')?.textContent ?? '',
    notice: said() ?? '',
    settled: !!marked,
  }
  leaf.detach()
  return report
})()`

describe.skipIf(!available)('go to definition when the repository cannot be downloaded', () => {
  let gh: FakeGithub

  beforeAll(async () => {
    gh = await startFakeGithub({ mode: 'no-archive' })
    enableGithub(gh.origin)
    evalAsync(
      `(async () => { ${PRELUDE} for (const l of githubLeaves()) l.detach(); return {} })()`
    )
  }, 60_000)

  afterAll(async () => {
    if (!available) return
    try {
      restoreGithub()
    } finally {
      await gh?.stop()
    }
  }, 60_000)

  it('opens a name declared in the same file, without asking for the archive', async () => {
    const from = (await gh.drainRequests()).length
    const r = evalAsync<{ error?: string; opened?: string; marked?: string; notice?: string }>(
      modClick(gh.web, 'formatValue(widgets.length)', 'widgets')
    )
    expect(r.error).toBeUndefined()
    expect(r.notice).toBe('')
    expect(r.opened).toMatch(new RegExp(`/acme/widgets/blob/${HEAD_SHA}/src/app\\.ts#L5$`))
    expect(r.marked).toBe('  const widgets = loadWidgets(count)')
    const asked = (await gh.drainRequests()).slice(from)
    expect(asked.filter((line) => /\/tarball\//.test(line))).toEqual([])
  })

  it('says a name declared elsewhere is not in the file shown, and why it looked only there', () => {
    const r = evalAsync<{ error?: string; opened?: string; notice?: string; settled?: boolean }>(
      modClick(gh.web, 'return formatValue(', 'formatValue')
    )
    expect(r.error).toBeUndefined()
    expect(r.settled).toBe(true)
    expect(r.opened).toBe(`${gh.web}/blob/main/src/app.ts`)
    expect(r.notice).toMatch(/No definition of formatValue found in the files open in this tab/)
    expect(r.notice).toMatch(/could not be downloaded/)
  })
})
