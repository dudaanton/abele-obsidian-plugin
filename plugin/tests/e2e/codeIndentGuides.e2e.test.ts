import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const NOTE = 'sample-code-guides.md'
const CODE = [
  'function sample() {',
  '  if (ready) {',
  '',
  `    print("${'sample value '.repeat(30)}")`,
  '  }',
  '}',
  '',
].join('\n')
const CONTENT = 'Sample code\n\n```js\n' + CODE + '```\n\nInline `sample` stays inline.\n'
const SHOTS = shotDir('abele-code-indent-guides')
const PRELUDE = `
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === ${JSON.stringify(NOTE)})
  if (!leaf) throw new Error('Sample note is not open')
  const shoot = async (name) => {
    const path = ${JSON.stringify(SHOTS)} + '/' + name + '.png'
    if (window.__e2eHost) return await window.__e2eHost.shot(path)
    require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(path, image.toPNG())
    return path
  }
`

describe.skipIf(!available)('code indentation guides', () => {
  let previous: unknown
  let created = false
  let config: { enabled: unknown; tabSize: unknown }
  beforeAll(() => {
    previous = evalJson('app.workspace.getLayout()')
    config = evalJson(
      '({ enabled: app.vault.getConfig("showIndentGuide"), tabSize: app.vault.getConfig("tabSize") })'
    )
    created = evalAsync<boolean>(`(async () => {
      app.vault.setConfig('showIndentGuide', true)
      app.vault.setConfig('tabSize', 4)
      if (app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})) throw new Error('Sample note already exists')
      const file = await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(CONTENT)})
      await app.workspace.getLeaf('tab').openFile(file)
      return true
    })()`)
  })
  afterAll(async () => {
    if (!onPhone()) await reloadApp('app.emulateMobile(false)')
    evalAsync(`(async () => {
      app.vault.setConfig('showIndentGuide', ${JSON.stringify(config?.enabled ?? true)})
      app.vault.setConfig('tabSize', ${JSON.stringify(config?.tabSize ?? 4)})
      for (const leaf of app.workspace.getLeavesOfType('markdown')) if (${created} && leaf.view.file?.path === ${JSON.stringify(NOTE)}) leaf.detach()
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      if (${created} && file) await app.vault.delete(file)
      if (${JSON.stringify(previous ?? null)}) await app.workspace.changeLayout(${JSON.stringify(previous ?? null)})
      return true
    })()`)
  })

  const check = (mode: 'preview' | 'source', source: boolean, label: string) => {
    const result = evalAsync<{
      text: string
      selected: string
      depths: string[]
      off: boolean
      caret: boolean
      shot: string
    }>(`(async () => {
      ${PRELUDE}
      app.vault.setConfig('showIndentGuide', true)
      await leaf.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(NOTE)}, mode: ${JSON.stringify(mode)}, source: ${source} }, active: true })
      await wait(1000)
      let text, selected, depths, caret = true
      if (${JSON.stringify(mode)} === 'preview') {
        const code = leaf.view.containerEl.querySelector('pre > code')
        if (!code) throw new Error('Code block missing')
        text = code.textContent
        const range = document.createRange()
        range.selectNodeContents(code)
        const selection = window.getSelection()
        selection.removeAllRanges(); selection.addRange(range)
        selected = selection.toString()
        selection.removeAllRanges()
        depths = [...code.querySelectorAll('.abele-code-line')].map((r) => r.style.getPropertyValue('--abele-guide-depth') || '0')
      } else {
        const cm = leaf.view.editor.cm
        const from = cm.state.doc.toString().indexOf('    print(')
        cm.focus()
        cm.dispatch({ selection: { anchor: from + 4 }, scrollIntoView: true })
        await wait(500)
        text = cm.state.doc.toString()
        // Round-trip coordinates on every visual wrap: the caret must still address the
        // original character, including after CodeMirror's native vertical movement.
        for (let pos = from + 4; pos < cm.state.doc.lineAt(from).to; pos += 9) {
          const box = cm.coordsAtPos(pos)
          if (!box) { caret = false; break }
          const back = cm.posAtCoords({ x: box.left, y: (box.top + box.bottom) / 2 })
          if (back === null || Math.abs(back - pos) > 1) { caret = false; break }
        }
        const down = cm.moveVertically(cm.state.selection.main, true)
        const up = cm.moveVertically(down, false)
        caret = caret && Math.abs(up.head - cm.state.selection.main.head) <= 1
        cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } })
        selected = cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to)
        depths = [...cm.contentDOM.querySelectorAll('.abele-code-guides')].map((r) => r.style.getPropertyValue('--abele-guide-depth'))
        cm.dispatch({ selection: { anchor: from + 4 } })
      }
      const shot = await shoot(${JSON.stringify(label)})
      app.vault.setConfig('showIndentGuide', false)
      await wait(1000)
      const off = ${JSON.stringify(mode)} === 'preview'
        ? !leaf.view.containerEl.querySelector('.abele-code-line')
        : !leaf.view.editor.cm.contentDOM.querySelector('.abele-code-guides')
      await shoot(${JSON.stringify(label + '-off')})
      return { text, selected, depths, off, caret, shot }
    })()`)
    expect(result.text).toBe(mode === 'preview' ? CODE : CONTENT)
    expect(result.selected).toBe(result.text)
    expect(result.depths).toEqual(
      mode === 'preview' ? ['0', '1', '1', '2', '1', '0'] : ['1', '1', '2', '1']
    )
    expect(result.off).toBe(true)
    expect(result.caret).toBe(true)
    expect(result.shot).toBeTruthy()
  }

  it('reading mode preserves selectable code and follows the guide setting', () =>
    check('preview', false, 'desktop-reading'))
  it('Live Preview preserves caret coordinates across wrapped lines', () =>
    check('source', false, 'desktop-live'))
  it('source mode uses the same guides', () => check('source', true, 'desktop-source'))
  it.skipIf(onPhone())('captures narrow reading and editor states', async () => {
    await reloadApp('app.emulateMobile(true)')
    try {
      check('preview', false, 'phone-reading')
      check('source', false, 'phone-live')
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  })
})
