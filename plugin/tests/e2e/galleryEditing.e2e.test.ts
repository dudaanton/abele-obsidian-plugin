/**
 * The gallery while the note around it is being worked on, in the running app.
 *
 * Generate a note and picture, place the cursor above the picture and insert a gallery. Exercise
 * edits above and below it, cursor movement, undo and redo, reading view, split panes, an external
 * file change, tab switch and window resize. After each step, every pane showing the note must
 * show the generated picture loaded at a nonzero size.
 *
 * The note lives in `Gallery editing e2e/` for the length of this file and is deleted after.
 * Pictures go to `/tmp/abele-gallery-editing/` — look at them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Gallery editing e2e'
const NOTE = `${DIR}/Note.md`
const OTHER = `${DIR}/Other.md`
const IMG = `${DIR}/Attachments/sample-image.png`
const SHOTS = '/tmp/abele-gallery-editing'

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
  const panes = () => app.workspace.getLeavesOfType('markdown').filter((l) => l.view.file?.path === ${JSON.stringify(NOTE)})
  const leaf = () => panes()[0]
  const ed = () => leaf().view.editor
  const lineOf = (prefix) => ed().getValue().split('\\n').findIndex((l) => l.startsWith(prefix))
  /** Each pane on the note: whether its gallery shows a loaded picture with a size. */
  const check = () => panes().map((l) => {
    const mode = l.view.getMode()
    // What is on screen in that mode: the editor's lines, or the rendered page. The view keeps
    // the other one around, hidden.
    const root = l.view.containerEl.querySelector(mode === 'preview' ? '.markdown-preview-view' : '.cm-content')
    const g = root.querySelector('.abele-gallery')
    g?.scrollIntoView({ block: 'nearest' })
    const imgs = Array.from(root.querySelectorAll('.abele-gallery img.abele-gallery__image')).map((i) => {
      const b = i.getBoundingClientRect()
      return i.complete && i.naturalWidth > 0 && b.width > 0 && b.height > 0
    })
    return { mode, boxes: root.querySelectorAll('.abele-gallery-widget-container, .abele-gallery-widget-container_rendered').length,
      pictures: imgs.length, ok: imgs.length === 1 && imgs.every(Boolean) }
  })
  const settle = async () => {
    const deadline = Date.now() + 5000
    let r = check()
    while (Date.now() < deadline && !(r.length && r.every((x) => x.ok))) { await wait(100); r = check() }
    return r
  }
  const shoot = async (name) => {
    try {
      require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
      if (img) require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + name + '.png', img.toPNG())
    } catch {}
  }
`

type Pane = { mode: string; boxes: number; pictures: number; ok: boolean }

/** Runs `action` in the app, then reports every pane showing the note. */
const step = (name: string, action: string): Pane[] =>
  evalAsync<Pane[]>(
    `(async () => {
    ${PRELUDE}
    ${action}
    await wait(300)
    const r = await settle()
    await shoot(${JSON.stringify(name)})
    return r
  })()`,
    60_000
  )

const expectShown = (panes: Pane[], count = 1) => {
  expect(panes).toHaveLength(count)
  for (const p of panes) expect(p, JSON.stringify(panes)).toMatchObject({ ok: true, pictures: 1 })
}

describe.skipIf(!available)('the gallery while the note is being edited', () => {
  beforeAll(() => {
    evalAsync(`(async () => {
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (old) await app.vault.delete(old, true)
      await app.vault.createFolder(${JSON.stringify(DIR + '/Attachments')})
      const c = document.createElement('canvas'); c.width = 320; c.height = 200
      const x = c.getContext('2d'); x.fillStyle = '#2a7ab0'; x.fillRect(0, 0, 320, 200)
      const bytes = Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), (ch) => ch.charCodeAt(0))
      await app.vault.createBinary(${JSON.stringify(IMG)}, bytes.buffer)
      await app.vault.create(${JSON.stringify(NOTE)}, '# Note\\n\\nAbove.\\n![[' + ${JSON.stringify(IMG)} + ']]\\n\\nBelow.\\n')
      await app.vault.create(${JSON.stringify(OTHER)}, 'Other')
      const leaf = app.workspace.getLeaf('tab')
      await leaf.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(NOTE)}, mode: 'source', source: false }, active: true })
      return { ok: true }
    })()`)
  })

  afterAll(() => {
    evalAsync(`(async () => {
      for (const l of app.workspace.getLeavesOfType('markdown'))
        if (l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')})) l.detach()
      const f = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (f) await app.vault.delete(f, true)
      return { ok: true }
    })()`)
  })

  it('shows the picture once Insert Abele gallery is run above it', () => {
    expectShown(
      step(
        'insert',
        `ed().setCursor({ line: lineOf('![['), ch: 0 })
         app.commands.executeCommandById('abele:insert-gallery')`
      )
    )
  })

  const steps: Array<[string, string]> = [
    ['cursor away', `ed().setCursor({ line: 0, ch: 0 })`],
    [
      'type above',
      `for (let i = 0; i < 5; i++) { ed().replaceRange('y', { line: 2, ch: 0 }); await wait(40) }`,
    ],
    ['new line above', `ed().replaceRange('\\n', { line: 2, ch: 0 })`],
    ['type below', `ed().replaceRange('z', { line: ed().lineCount() - 1, ch: 0 })`],
    ['cursor on the header', `ed().setCursor({ line: lineOf('::abele'), ch: 3 })`],
    ['cursor off the header', `ed().setCursor({ line: 0, ch: 0 })`],
    ['undo', `ed().undo()`],
    ['redo', `ed().redo()`],
    [
      'reading view',
      `await leaf().setViewState({ type: 'markdown', state: { file: file.path, mode: 'preview' } })`,
    ],
    [
      'Live Preview again',
      `await leaf().setViewState({ type: 'markdown', state: { file: file.path, mode: 'source', source: false } })`,
    ],
    [
      'changed from outside, below',
      `await app.vault.process(file, (t) => t.replace('Below.', 'Below, changed.'))`,
    ],
    [
      'changed from outside, above',
      `await app.vault.process(file, (t) => t.replace('# Note', '# Note, changed'))`,
    ],
    [
      'tab away and back',
      `const o = app.workspace.getLeaf('tab'); await o.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(OTHER)})); await wait(600); app.workspace.setActiveLeaf(leaf(), { focus: true }); await wait(600); o.detach()`,
    ],
    [
      'window resize',
      `const w = require('@electron/remote').getCurrentWindow(); const [a, b] = w.getContentSize(); w.setContentSize(a - 200, b); await wait(600); w.setContentSize(a, b)`,
    ],
  ]
  for (const [name, action] of steps) {
    it(`still shows it after: ${name}`, () => expectShown(step(name, action)))
  }

  it('shows it in both panes when the note is split, and after typing in one', () => {
    expectShown(
      step('split', `const s = app.workspace.createLeafBySplit(leaf()); await s.openFile(file)`),
      2
    )
    expectShown(
      step('type in split', `panes()[1].view.editor.replaceRange('s', { line: 2, ch: 0 })`),
      2
    )
    expectShown(step('close split', `panes()[1].detach()`), 1)
  })
})
