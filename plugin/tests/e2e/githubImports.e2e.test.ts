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

import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('github-imports')
const clickImport = (web: string, line: string, name: string) => `(async () => {
  ${PRELUDE}
  for (const n of document.querySelectorAll('.notice')) n.remove()
  const leaf = await openTab(${JSON.stringify(`${web}/blob/main/src/app.ts`)})
  const root = leaf.view.containerEl
  try {
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
  const marked = await until(() => leaf.view.model.url !== before && loaded(leaf, 'src/util/format.ts'), 20000)
  const report = {
    opened: leaf.view.model.url,
    marked: root.querySelector('.abele-github-code__line_target')?.textContent ?? '',
    notice: said() ?? '',
    settled: !!marked,
  }
  const shot = ${JSON.stringify(SHOTS + '/import-target.png')}
  if (window.__e2eHost) report.shot = await window.__e2eHost.shot(shot)
  else {
    const image = await require("@electron/remote").getCurrentWebContents().capturePage()
    require("fs").writeFileSync(shot, image.toPNG())
    report.shot = shot
  }
  return report
  } finally { leaf.detach() }
})()`

describe.skipIf(!available)('relative imports in a GitHub tab', () => {
  let gh: FakeGithub
  beforeAll(async () => {
    gh = await startFakeGithub()
    enableGithub(gh.origin)
  }, 60_000)
  afterAll(async () => {
    try {
      restoreGithub()
    } finally {
      await gh?.stop()
    }
  }, 60_000)
  it('opens the imported module at the same revision', () => {
    const result = evalAsync<{ error?: string; opened: string; settled: boolean; shot: string }>(
      clickImport(gh.web, 'import { formatValue }', './util/format')
    )
    expect(result.error).toBeUndefined()
    expect(result.settled).toBe(true)
    expect(result.opened).toBe(`${gh.web}/blob/${HEAD_SHA}/src/util/format.ts`)
    expect(result.shot).toMatch(/import-target\.png$/)
  })
})
