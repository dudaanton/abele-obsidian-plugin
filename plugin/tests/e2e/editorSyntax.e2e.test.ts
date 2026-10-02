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
    // On mobile, Live Preview keeps rendered blocks closed while the editor is unfocused.
    // A real edit focuses it first; a selection-only probe does not establish that condition.
    cm.focus()
    cm.dispatch({ selection: { anchor: position }, scrollIntoView: true })
    for (let i = 0; i < 50; i++) {
      const line = [...cm.contentDOM.querySelectorAll('.cm-line')].find((el) => el.textContent.includes(text))
      if (line) { await wait(100); return line }
      await wait(100)
    }
    return undefined
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

  it('leaves native diff additions and deletions untouched without patch headers', () => {
    const content = '```diff\n-old\n+new\n```\n'
    const result = evalAsync<{ removed: number; added: number; own: number }>(`(async () => {
      ${PRELUDE}
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      try {
        await app.vault.modify(file, ${JSON.stringify(content)})
        await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source', source: true }, active: true })
        const cm = leaf.view.editor.cm
        const removed = await showLine(cm, '-old')
        const added = await showLine(cm, '+new')
        return { removed: removed?.querySelectorAll('.cm-negative').length ?? 0,
          added: added?.querySelectorAll('.cm-positive').length ?? 0,
          own: cm.dom.querySelectorAll('.abele-syntax-token').length }
      } finally { await app.vault.modify(file, ${JSON.stringify(CONTENT)}) }
    })()`)
    expect(result.removed).toBeGreaterThan(0)
    expect(result.added).toBeGreaterThan(0)
    expect(result.own).toBe(0)
  })

  it.each(['quote', 'list'])(
    'ends an unclosed %s before outside prose and a Rust fence',
    (container) => {
      const contained =
        container === 'quote'
          ? '> ```graphql\n> query { sample { id } }'
          : '- ```graphql\n  query { sample { id } }'
      const content = contained + '\nOutside prose\n```rust\nfn sample() {}\n```\n'
      const result = evalAsync<{
        graphql: number
        prose: number
        rust: number
        text: string
      }>(`(async () => {
      ${PRELUDE}
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      try {
        await app.vault.modify(file, ${JSON.stringify(content)})
        await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source', source: true }, active: true })
        const cm = leaf.view.editor.cm
        let query = await showLine(cm, 'query { sample')
        for (let i = 0; i < 50 && !query?.querySelector('.abele-syntax-token.keyword'); i++) {
          await wait(100)
          query = [...cm.contentDOM.querySelectorAll('.cm-line')].find((el) => el.textContent.includes('query { sample'))
        }
        const graphql = query?.querySelectorAll('.abele-syntax-token.keyword').length ?? 0
        const prose = await showLine(cm, 'Outside prose')
        const rust = await showLine(cm, 'fn sample()')
        return { graphql, prose: prose?.querySelectorAll('.abele-syntax-token').length ?? -1,
          rust: rust?.querySelectorAll('.abele-syntax-token').length ?? -1, text: cm.state.doc.toString() }
      } finally { await app.vault.modify(file, ${JSON.stringify(CONTENT)}) }
    })()`)
      expect(result.graphql).toBeGreaterThan(0)
      expect(result.prose).toBe(0)
      expect(result.rust).toBe(0)
      expect(result.text).toBe(content)
    }
  )

  it('keeps a small unclosed quote highlighted before a long outside paragraph', () => {
    const content =
      '> ```graphql\n> query { sample { id } }\n' + 'Outside prose '.repeat(4000) + '\n'
    const result = evalAsync<{ graphql: number; outside: number }>(`(async () => {
      ${PRELUDE}
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      try {
        await app.vault.modify(file, ${JSON.stringify(content)})
        await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source', source: true }, active: true })
        const cm = leaf.view.editor.cm
        let query = await showLine(cm, 'query { sample')
        for (let i = 0; i < 50 && !query?.querySelector('.abele-syntax-token.keyword'); i++) {
          await wait(100)
          query = [...cm.contentDOM.querySelectorAll('.cm-line')].find((el) => el.textContent.includes('query { sample'))
        }
        return { graphql: query?.querySelectorAll('.abele-syntax-token.keyword').length ?? 0,
          outside: [...cm.contentDOM.querySelectorAll('.cm-line')].find((el) => el.textContent.includes('Outside prose'))?.querySelectorAll('.abele-syntax-token').length ?? 0 }
      } finally { await app.vault.modify(file, ${JSON.stringify(CONTENT)}) }
    })()`)
    expect(result.graphql).toBeGreaterThan(0)
    expect(result.outside).toBe(0)
  })

  it('refreshes an open Other switch after a settings update and enables on the first click', () => {
    const result = evalAsync<{
      initial: boolean
      arrived: boolean
      clicked: boolean
      saved: boolean
      fits: boolean
      shot: string | null
    }>(`(async () => {
      ${PRELUDE}
      await leaf.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(NOTE)}, mode: 'source', source: true }, active: true })
      const config = window.__abeleTest.AbeleConfig.getInstance()
      const previous = config.editorSyntaxHighlight
      try {
        config.editorSyntaxHighlight = true
        await config.saveSettings()
        app.setting.open()
        app.setting.openTabById('abele')
        for (let i = 0; i < 50 && !app.setting.activeTab?.containerEl?.querySelector('.abele-tabs__tab'); i++) await wait(100)
        const doc = app.setting.activeTab.containerEl.ownerDocument
        const other = [...doc.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find((el) => el.textContent.trim() === 'Other')
        if (!other) throw new Error('Other settings tab not found')
        other.click()
        for (let i = 0; i < 50 && !doc.querySelector('.abele-settings__other'); i++) await wait(100)
        const row = [...doc.querySelectorAll('.abele-settings__other .setting-item')].find((el) => el.querySelector('.setting-item-name')?.textContent === 'Editor syntax highlighting')
        if (!row) throw new Error('Syntax switch not found')
        row.scrollIntoView({ block: 'center' })
        const checkbox = row.querySelector('.checkbox-container')
        const initial = checkbox.classList.contains('is-enabled')
        config.editorSyntaxHighlight = false
        config.version.value++
        await wait(200)
        const arrived = !checkbox.classList.contains('is-enabled')
        const rect = checkbox.getBoundingClientRect()
        const frame = row.getBoundingClientRect()
        const fits = rect.width > 0 && rect.left >= frame.left && rect.right <= frame.right + 1
        const shot = ${onPhone()} ? await shoot('syntax-setting') : null
        checkbox.click()
        await wait(300)
        return { initial, arrived, clicked: checkbox.classList.contains('is-enabled'),
          saved: (await app.plugins.plugins.abele.loadData()).editorSyntaxHighlight === true, fits, shot }
      } finally {
        app.setting.close()
        config.editorSyntaxHighlight = previous
        await config.saveSettings()
      }
    })()`)
    expect(result.initial).toBe(true)
    expect(result.arrived).toBe(true)
    expect(result.clicked).toBe(true)
    expect(result.saved).toBe(true)
    expect(result.fits).toBe(true)
    if (onPhone()) expect(result.shot).toMatch(/\.png$/)
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
