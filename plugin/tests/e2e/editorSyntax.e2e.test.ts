import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()
const NOTE = 'sample-editor-syntax.md'
const SHOTS = shotDir('abele-editor-syntax')
const CONTENT = [
  'Sample code',
  '',
  '```graphql',
  'query { sample { id } }',
  '```',
  '',
  '```rust',
  'fn sample() { let value = "sample"; }',
  '```',
  '',
  '```go',
  'package main',
  'func sample() {}',
  '```',
  '',
  '```js',
  'const value = 1;',
  '```',
  '',
  '```mermaid',
  'graph LR; A-->B',
  '```',
  '',
  '> ```graphql',
  '> query { quoted { id } }',
  '> ```',
  '',
].join('\n')

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === ${JSON.stringify(NOTE)}) ?? app.workspace.getLeaf(false)
  if (leaf.view.file?.path !== ${JSON.stringify(NOTE)}) await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))
  const showLine = async (cm, text) => {
    const position = cm.state.doc.toString().indexOf(text)
    cm.dispatch({ selection: { anchor: position }, scrollIntoView: true })
    await wait(200)
    return [...cm.contentDOM.querySelectorAll('.cm-line')].find((el) => el.textContent.includes(text))
  }
  const shoot = async (name) => {
    const path = ${JSON.stringify(SHOTS)} + '/' + name + '.png'
    if (window.__e2eHost) return await window.__e2eHost.shot(path)
    require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    const image = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (image) require('fs').writeFileSync(path, image.toPNG())
    return image ? path : null
  }
`

// The same assertions run on the desktop, in phone emulation and on the real phone tier.
describe.skipIf(!available)('editor syntax highlighting', () => {
  let setting: boolean | null
  let previous: unknown
  beforeAll(() => {
    previous = evalJson('app.workspace.activeLeaf?.getViewState() ?? null')
    setting = evalJson('window.__abeleTest.AbeleConfig.getInstance().editorSyntaxHighlight ?? null')
    evalAsync(`(async () => {
      const config = window.__abeleTest.AbeleConfig.getInstance()
      config.editorSyntaxHighlight = true
      await config.saveSettings()
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      if (old) await app.vault.delete(old)
      const f = await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(CONTENT)})
      await app.workspace.getLeaf(false).openFile(f)
      return { ok: true }
    })()`)
  })
  afterAll(async () => {
    if (!onPhone()) await reloadApp('emulateDesktop')
    evalAsync(`(async () => {
      const config = window.__abeleTest.AbeleConfig.getInstance()
      config.editorSyntaxHighlight = ${JSON.stringify(setting ?? true)}
      await config.saveSettings()
      const saved = ${JSON.stringify(previous)}
      if (saved) await app.workspace.getLeaf(false).setViewState(saved)
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      if (file) await app.vault.delete(file)
      return { ok: true }
    })()`)
  })

  const checkEditor = (source: boolean) => {
    const result = evalAsync<{
      tokens: string[]
      native: number
      special: number
      quoted: string[]
      text: string
      colour: boolean
      supported: number[]
      shot: string | null
    }>(`(async () => {
      ${PRELUDE}
      await leaf.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(NOTE)}, mode: 'source', source: ${source} }, active: true })
      const editor = leaf.view.editor.cm
      let graphql = await showLine(editor, 'query { sample')
      for (let i = 0; i < 100 && !graphql?.querySelector('.abele-syntax-token'); i++) {
        await wait(100)
        graphql = [...editor.contentDOM.querySelectorAll('.cm-line')].find((el) => el.textContent.includes('query { sample'))
      }
      const token = graphql?.querySelector('.abele-syntax-token.token.keyword')
      const tokens = [...graphql?.querySelectorAll('.abele-syntax-token') ?? []].map((el) => el.textContent)
      const colour = !!token && getComputedStyle(token).color !== getComputedStyle(graphql).color
      const shot = await shoot(${JSON.stringify(source ? 'source' : 'live-preview')})
      const supported = []
      for (const text of ['fn sample()', 'func sample()']) {
        const line = await showLine(editor, text)
        supported.push(line?.querySelectorAll('.cm-keyword, .token.keyword').length ?? 0)
      }
      const native = await showLine(editor, 'const value')
      const nativeCount = native?.querySelectorAll('.abele-syntax-token').length ?? -1
      const special = await showLine(editor, 'graph LR')
      const specialCount = special?.querySelectorAll('.abele-syntax-token').length ?? -1
      const quoted = await showLine(editor, 'query { quoted')
      return {
        tokens, colour, supported, shot,
        native: nativeCount, special: specialCount,
        quoted: [...quoted?.querySelectorAll('.abele-syntax-token') ?? []].map((el) => el.textContent),
        text: editor.state.doc.toString(),
      }
    })()`)
    expect(result.tokens).toContain('query')
    expect(result.native).toBe(0)
    expect(result.special).toBe(0)
    expect(result.quoted).toContain('query')
    expect(result.supported.every((count) => count > 0)).toBe(true)
    expect(result.text).toBe(CONTENT)
    expect(result.colour).toBe(true)
    expect(result.shot).toMatch(/\.png$/)
  }

  it('adds tokens in Live Preview, leaving native and special blocks alone', () =>
    checkEditor(false))
  it('adds tokens in Source mode too', () => checkEditor(true))

  it('updates tokens after typing and undo, and switches off in an open editor', () => {
    const result = evalAsync<{
      edited: boolean
      undone: boolean
      off: number
      on: number
    }>(`(async () => {
      ${PRELUDE}
      const cm = leaf.view.editor.cm
      await showLine(cm, 'query { sample')
      const position = cm.state.doc.toString().indexOf('query { sample')
      const editor = leaf.view.editor
      editor.replaceRange('mutation', editor.offsetToPos(position), editor.offsetToPos(position + 5))
      await wait(200)
      const edited = [...cm.dom.querySelectorAll('.abele-syntax-token.keyword')].some((el) => el.textContent === 'mutation')
      editor.undo()
      await wait(200)
      const undone = cm.state.doc.toString() === ${JSON.stringify(CONTENT)} && [...cm.dom.querySelectorAll('.abele-syntax-token.keyword')].some((el) => el.textContent === 'query')
      const config = window.__abeleTest.AbeleConfig.getInstance()
      config.editorSyntaxHighlight = false
      await config.saveSettings()
      await wait(100)
      const off = cm.dom.querySelectorAll('.abele-syntax-token').length
      config.editorSyntaxHighlight = true
      await config.saveSettings()
      await wait(100)
      return { edited, undone, off, on: cm.dom.querySelectorAll('.abele-syntax-token').length }
    })()`)
    expect(result.edited).toBe(true)
    expect(result.undone).toBe(true)
    expect(result.off).toBe(0)
    expect(result.on).toBeGreaterThan(0)
  })

  it('keeps native reading-view tokens', () => {
    const result = evalAsync<{ tokens: number }>(`(async () => {
      ${PRELUDE}
      await leaf.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(NOTE)}, mode: 'preview' }, active: true })
      const root = leaf.view.containerEl.querySelector('.markdown-preview-view')
      for (let i = 0; i < 100 && !root.querySelector('code.language-graphql .token'); i++) await wait(100)
      return { tokens: root.querySelectorAll('code.language-graphql .token').length }
    })()`)
    expect(result.tokens).toBeGreaterThan(0)
  })

  it.skipIf(onPhone())('highlights in phone emulation', async () => {
    await reloadApp('emulateMobile')
    checkEditor(false)
  })

  it('bounds work in a huge visible block and keeps editing responsive', () => {
    const result = evalAsync<{
      spans: number
      edited: boolean
      milliseconds: number
    }>(`(async () => {
      ${PRELUDE}
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      const large = ${JSON.stringify('```graphql\n')} + ${JSON.stringify('query { sample { id } }\n')}.repeat(5000) + ${JSON.stringify('```\n')}
      try {
        await app.vault.modify(file, large)
        await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source', source: false }, active: true })
        await wait(500)
        const cm = leaf.view.editor.cm
        cm.dispatch({ selection: { anchor: Math.floor(large.length / 2) }, scrollIntoView: true })
        await wait(500)
        const started = performance.now()
        const position = cm.state.selection.main.head
        cm.dispatch({ changes: { from: position, insert: 'x' } })
        const milliseconds = performance.now() - started
        return { spans: cm.dom.querySelectorAll('.abele-syntax-token').length,
          edited: cm.state.doc.sliceString(position, position + 1) === 'x', milliseconds }
      } finally { await app.vault.modify(file, ${JSON.stringify(CONTENT)}) }
    })()`)
    expect(result.spans).toBe(0)
    expect(result.edited).toBe(true)
    expect(result.milliseconds).toBeLessThan(1500)
  })
})
