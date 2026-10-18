/**
 * The buttons over a drawing in a note, pressed by a real finger on a real phone.
 *
 * The desktop file (`drawingEmbed.e2e.test.ts`) sends touches through the DevTools protocol under
 * `emulateMobile`, which is Chromium deciding what a lifted finger means. iOS WebKit decides
 * differently: it makes no click out of a touch whose events were cancelled, and the box over
 * the drawing cancels every touch while its part is being changed. So here the phone's own
 * screen is tapped: the first tap shows the buttons and does nothing else, a tap on a button
 * presses it — into changing the part, and back out of it with "Leave the part as it was" — and
 * the note's text is the same at the end.
 *
 * Pictures go to `abele-phone/drawing-embed-phone-*.png` — look at them. Writes a folder with a
 * drawing and a note for the run and removes it. Real phone only: `npm run test:e2e:phone`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { WAIT_PRELUDE } from './helpers/wait'
import { emptyDrawingSvg } from '../../src/drawing/drawingFile'

targets('phone')

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele drawing embed phone e2e'
const SHOTS = shotDir('abele-phone')
const NOTE = `${DIR}/Sample note.md`
const TEXT = 'Top line\n\n![[Sample drawing.svg]]\n'

const PRELUDE = `
  ${WAIT_PRELUDE}
  const host = window.__e2eHost
  const shoot = (name) => host ? host.shot(${JSON.stringify(SHOTS)} + '/drawing-embed-phone-' + name + '.png') : null
  /** A finger on the middle of an element, once it has stopped moving. */
  const tap = async (el) => {
    let r = el.getBoundingClientRect()
    for (let i = 0; i < 20; i++) { await wait(100); const n = el.getBoundingClientRect(); if (n.top === r.top && n.left === r.left) break; r = n }
    await host.tap(r.left + r.width / 2, r.top + r.height / 2)
    await wait(400)
  }
  const leaf = () => app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === ${JSON.stringify(NOTE)})
  const box = () => leaf()?.view.containerEl.querySelector('.markdown-source-view .abele-drawing-embed')
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String(e && e.message ? e.message + ' ' + (e.stack || '') : e) } }
    })()`,
    120_000
  )

describe.skipIf(!available)('a drawing in a note, under a finger on a phone', () => {
  beforeAll(() => {
    const r = run<{ error?: string }>(`
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (old) await app.vault.delete(old, true)
      await app.vault.createFolder(${JSON.stringify(DIR)})
      await app.vault.create(${JSON.stringify(`${DIR}/Sample drawing.svg`)}, ${JSON.stringify(emptyDrawingSvg())})
      await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(TEXT)})
      const l = app.workspace.getLeaf('tab')
      await l.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(NOTE)}, mode: 'source', source: false }, active: true })
      const b = await until(() => { const b = box(); return b && b.clientWidth > 0 && b.querySelector('img')?.complete && b }, 10000)
      if (!b) throw new Error('the drawing did not show in the note')
      l.view.editor.setCursor({ line: 0, ch: 0 })
      document.activeElement?.blur?.()
      return {}
    `)
    if (r.error) throw new Error(r.error)
  }, 60_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const l of app.workspace.getLeavesOfType('markdown'))
          if (l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')})) l.detach()
        await new Promise((r) => setTimeout(r, 1000))
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
  }, 60_000)

  it('shows its buttons at a first tap, changes the part at a tap on one and leaves it at another', () => {
    const r = run<{
      error?: string
      hidden?: string
      shown?: boolean
      focused?: boolean
      adjusting?: boolean
      whole?: boolean
      left?: boolean
      buttons?: string[]
      text?: string
    }>(`
      // The editor may have drawn the embed again since the setup: wait for the one on screen now.
      const b = await until(() => { const b = box(); return b && b.clientWidth > 0 && b.querySelector('.abele-drawing-embed__adjust') && b }, 10000)
      if (!b) throw new Error('the drawing with its buttons is not in the note')
      const actions = b.querySelector('.abele-drawing-embed__actions')
      await until(() => getComputedStyle(actions).opacity === '0')
      const hidden = getComputedStyle(actions).opacity
      // The first tap lands on the picture: it shows the buttons and reaches nothing else.
      await tap(b.querySelector('img'))
      const shown = b.classList.contains('abele-drawing-embed_shown')
      const focused = !!leaf().view.containerEl.querySelector('.cm-content')?.contains(document.activeElement)
      await shoot('shown')
      await tap(b.querySelector('.abele-drawing-embed__adjust'))
      const adjusting = !!(await until(() => b.classList.contains('abele-drawing-embed_adjusting') && b.querySelector('.abele-drawing-embed__cancel'), 4000))
      const whole = !!b.querySelector('.abele-drawing-embed__whole')
      await shoot('adjusting')
      await tap(b.querySelector('.abele-drawing-embed__cancel'))
      const left = !!(await until(() => !b.classList.contains('abele-drawing-embed_adjusting') && b.querySelector('.abele-drawing-embed__adjust'), 4000))
      const buttons = [...actions.children].map((el) => el.className.match(/abele-drawing-embed__(\\w+)/)?.[1])
      await wait(500)
      return { hidden, shown, focused, adjusting, whole, left, buttons, text: leaf().view.editor.getValue() }
    `)
    expect(r.error).toBeUndefined()
    expect(r.hidden).toBe('0')
    expect(r.shown).toBe(true)
    // The tap that shows the buttons brings no keyboard up.
    expect(r.focused).toBe(false)
    expect(r.adjusting).toBe(true)
    expect(r.whole).toBe(true)
    expect(r.left).toBe(true)
    expect(r.buttons).toEqual(['adjust', 'go'])
    expect(r.text).toBe(TEXT)
  })
})
