import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withNativeInput } from './helpers/nativeInput'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { codeGuideClickTarget, withCodeGuideSettings } from './helpers/codeGuideProbe'

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
  const settle = async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await wait(100)
  }
  const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === ${JSON.stringify(NOTE)}) ?? app.workspace.getLeaf(false)
  if (leaf.view.file?.path !== ${JSON.stringify(NOTE)}) await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))
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
  let readingFacts: unknown = null
  beforeAll(() => {
    previous = evalJson('app.workspace.getLayout()')
    created = evalAsync<boolean>(`(async () => {
      if (app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})) throw new Error('Sample note already exists')
      const file = await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(CONTENT)})
      await app.workspace.getLeaf('tab').openFile(file)
      return true
    })()`)
  })
  afterAll(async () => {
    if (!onPhone()) await reloadApp('app.emulateMobile(false)')
    evalAsync(`(async () => {
      for (const leaf of app.workspace.getLeavesOfType('markdown')) if (${created} && leaf.view.file?.path === ${JSON.stringify(NOTE)}) leaf.detach()
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      if (${created} && file) await app.vault.delete(file)
      if (${JSON.stringify(previous ?? null)}) await app.workspace.changeLayout(${JSON.stringify(previous ?? null)})
      return true
    })()`)
  })

  const check = async (mode: 'preview' | 'source', source: boolean, label: string) =>
    withNativeInput(async () => {
      const result = evalAsync<{
        text: string
        selected: string
        depths: string[]
        off: boolean
        caret: boolean
        wraps: number
        painted: boolean
        nativeInput: { down: boolean; up: boolean; click: boolean } | null
        shot: string
        finalInside: boolean
        finalOutside: boolean
        hanging: boolean
        height: number[]
        width: number
        snapshot: unknown
      }>(`(async () => {
      const withSettings = ${withCodeGuideSettings.toString()}
      return withSettings(app.vault, async () => {
      ${PRELUDE}
      await leaf.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(NOTE)}, mode: ${JSON.stringify(mode)}, source: ${source} }, active: true })
      await wait(1000)
      let text, selected, depths, caret = true, wraps = 0, painted = false, nativeInput = null
      let finalInside = true, finalOutside = true, hanging = true, height = []
      let snapshot = null, clickDiagnostic = null, initialCheck = null
      const gateSnapshot = (doc) => {
        const raw = app.vault.getConfig('showIndentGuide')
        return {
          at: Date.now(), rawConfig: raw === undefined ? '[undefined]' : raw, rawConfigType: typeof raw,
          bodyGuideClass: doc.body.classList.contains('show-indentation-guide'),
          editorDocumentIsHarnessDocument: doc === document,
          editorWindowIsHarnessWindow: doc.defaultView === window,
          mobile: doc.body.classList.contains('is-mobile'),
          registrations: Object.values(app.plugins.plugins).filter((p) => typeof p.codeIndentGuideDiagnostics === 'function').map((p) => p.codeIndentGuideDiagnostics(doc)),
        }
      }
      const readingSnapshot = () => [...leaf.view.containerEl.querySelectorAll('pre > code')].map((code) => ({
        gate: gateSnapshot(code.ownerDocument),
        rows: code.querySelectorAll('.abele-code-line').length,
        painted: [...code.querySelectorAll('.abele-code-line[style*="--abele-guide-depth"]')].map((row) => code.ownerDocument.defaultView.getComputedStyle(row, '::before').backgroundImage !== 'none'),
      }))
      const unwrappedHeight = (code) => {
        const pre = code.parentElement
        const preStyle = pre.style.whiteSpace, codeStyle = code.style.whiteSpace
        pre.style.whiteSpace = code.style.whiteSpace = 'pre'
        const height = pre.getBoundingClientRect().height
        pre.style.whiteSpace = preStyle; code.style.whiteSpace = codeStyle
        return height
      }
      const editorSnapshot = () => {
        const cm = leaf.view.editor.cm
        const from = cm.state.doc.toString().indexOf('    print(')
        const line = [...cm.contentDOM.querySelectorAll('.cm-line')].find((el) => el.textContent.includes('print('))
        const guide = line && getComputedStyle(line, '::before')
        const instance = cm.plugins.find((p) => p.value && typeof p.value.guideDiagnostics === 'function')?.value
        const first = cm.coordsAtPos(from + 4)
        let wrapped = null
        for (let p = from + 5; first && p < cm.state.doc.lineAt(from).to; p++) {
          const box = cm.coordsAtPos(p)
          if (box && box.top > first.top + 2) { wrapped = box; break }
        }
        const painted = !!line?.classList.contains('abele-code-guides') && guide?.content !== 'none' && guide?.backgroundImage !== 'none' && parseFloat(guide?.width) > 0 && parseFloat(getComputedStyle(line).textIndent) < 0
        return {
          painted,
          hanging: !!first && !!wrapped && Math.abs(first.left - wrapped.left) <= 1,
          inside: cm.hasFocus && cm.state.selection.main.empty && cm.state.selection.main.head >= from && cm.state.selection.main.head <= cm.state.doc.lineAt(from).to,
          depths: [...cm.contentDOM.querySelectorAll('.abele-code-guides')].map((r) => r.style.getPropertyValue('--abele-guide-depth')),
          lineClasses: line?.className,
          lineStyle: line?.getAttribute('style'),
          guideWidth: guide?.width,
          firstX: first?.left,
          wrappedX: wrapped?.left,
          enabled: app.vault.getConfig('showIndentGuide'),
          tabSize: app.vault.getConfig('tabSize'),
          pluginPresent: cm.plugins.some((p) => p.value && typeof p.value.settle === 'function' && 'nativeDoc' in p.value),
          gate: gateSnapshot(cm.dom.ownerDocument),
          viewPlugin: instance ? instance.guideDiagnostics() : null,
          readingNow: readingSnapshot(),
          readingBaseline: ${JSON.stringify(readingFacts)},
          clickDiagnostic,
        }
      }
      if (${JSON.stringify(mode)} === 'preview') {
        const code = leaf.view.containerEl.querySelector('pre > code')
        if (!code) throw new Error('Code block missing')
        text = code.textContent
        const range = document.createRange()
        range.selectNodeContents(code)
        const selection = window.getSelection()
        selection.removeAllRanges(); selection.addRange(range)
        const clipboardData = new DataTransfer()
        const copy = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData })
        document.dispatchEvent(copy)
        if (!copy.defaultPrevented) throw new Error('Code copy handler did not preserve source')
        selected = clipboardData.getData('text/plain')
        selection.removeAllRanges()
        depths = [...code.querySelectorAll('.abele-code-line')].map((r) => r.style.getPropertyValue('--abele-guide-depth') || '0')
        painted = [...code.querySelectorAll('[style*="--abele-guide-depth"]')].every((r) => getComputedStyle(r, '::before').backgroundImage !== 'none')
        // Hold wrapping constant to isolate added terminal-line height from the
        // extra visual rows that a hanging indent can require on a narrow screen.
        height.push(unwrappedHeight(code))
        initialCheck = readingSnapshot()
      } else {
        const cm = leaf.view.editor.cm
        const from = cm.state.doc.toString().indexOf('    print(')
        cm.focus()
        cm.dispatch({ selection: { anchor: from + 4 }, scrollIntoView: true })
        await wait(500)
        text = cm.state.doc.toString()
        const rows = [...cm.contentDOM.querySelectorAll('.abele-code-guides')]
        depths = rows.map((r) => r.style.getPropertyValue('--abele-guide-depth'))
        painted = rows.length > 0 && rows.every((r) => {
          const line = getComputedStyle(r), guide = getComputedStyle(r, '::before')
          return guide.content !== 'none' && guide.backgroundImage !== 'none' && parseFloat(guide.width) > 0 && parseFloat(line.textIndent) < 0
        })
        initialCheck = editorSnapshot()
        // Keep at least two wrapped rows on screen, including when a mobile keyboard
        // has shortened the viewport. Only on-screen coordinates can model a click.
        const first = cm.coordsAtPos(from + 8)
        const scroll = cm.scrollDOM.getBoundingClientRect()
        if (first) cm.scrollDOM.scrollTop += first.top - scroll.top - 40
        await wait(150)
        const visualRows = new Set()
        const initial = cm.coordsAtPos(from + 8)
        const viewport = cm.scrollDOM.getBoundingClientRect()
        for (let pos = from + 4; pos < cm.state.doc.lineAt(from).to; pos += 9) {
          const box = cm.coordsAtPos(pos)
          if (!box) { caret = false; break }
          if (box.top < Math.max(0, viewport.top) || box.bottom > Math.min(innerHeight, viewport.bottom)) continue
          visualRows.add(Math.round(box.top))
          const back = cm.posAtCoords({ x: box.left, y: (box.top + box.bottom) / 2 })
          if (back === null || Math.abs(back - pos) > 1) { caret = false; break }
        }
        wraps = visualRows.size
        cm.dispatch({ selection: { anchor: from + 8 } })
        const down = cm.moveVertically(cm.state.selection.main, true)
        cm.dispatch({ selection: cm.state.selection.constructor.create([down]) })
        const downBox = cm.coordsAtPos(cm.state.selection.main.head)
        caret = caret && down.head > from + 8 && cm.state.doc.lineAt(down.head).from === from && downBox.top > initial.top + 2
        const up = cm.moveVertically(cm.state.selection.main, false)
        cm.dispatch({ selection: cm.state.selection.constructor.create([up]) })
        caret = caret && Math.abs(cm.state.selection.main.head - (from + 8)) <= 1
        if (${!onPhone()}) {
          // Exercise Electron's actual key and mouse input, not just the coordinate API.
          const contents = require('@electron/remote').getCurrentWebContents()
          const key = async (keyCode) => {
            contents.sendInputEvent({ type: 'keyDown', keyCode })
            contents.sendInputEvent({ type: 'keyUp', keyCode })
            await wait(100)
          }
          cm.dispatch({ selection: { anchor: from + 8 } })
          cm.focus()
          await key('Down')
          const downHead = cm.state.selection.main.head
          const nativeDown = downHead > from + 8 && cm.state.doc.lineAt(downHead).from === from && cm.coordsAtPos(downHead).top > initial.top + 2
          await key('Up')
          const nativeUp = Math.abs(cm.state.selection.main.head - (from + 8)) <= 1
          await settle()
          const pickTarget = ${codeGuideClickTarget.toString()}
          const target = pickTarget(cm, from)
          if (!target) throw new Error('No wrapped row available for a native click')
          const point = { x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 }
          const expectedBox = cm.coordsAtPos(target.pos)
          const predictedPosition = cm.posAtCoords(point)
          contents.sendInputEvent({ type: 'mouseDown', ...point })
          contents.sendInputEvent({ type: 'mouseUp', ...point })
          await wait(100)
          clickDiagnostic = {
            expectedPosition: target.pos, actualPosition: cm.state.selection.main.head,
            delta: cm.state.selection.main.head - target.pos,
            point, predictedPosition, expectedBox,
            editorDocumentIsHarnessDocument: cm.dom.ownerDocument === document,
            editorDocumentFocused: cm.dom.ownerDocument.hasFocus(),
          }
          nativeInput = { down: nativeDown, up: nativeUp, click: Math.abs(cm.state.selection.main.head - target.pos) <= 1 }
        }
        cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } })
        selected = cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to)
        if (!${source}) {
          cm.dispatch({ selection: { anchor: 0 } })
          await settle()
          const native = editorSnapshot()
          const rendered = [...leaf.view.containerEl.querySelectorAll('pre > code .abele-code-line[style*="--abele-guide-depth"]')]
          finalOutside = native.painted || rendered.some((row) => getComputedStyle(row, '::before').backgroundImage !== 'none')
          await shoot(${JSON.stringify(label + '-outside')})
        }
        cm.focus()
        cm.dispatch({ selection: { anchor: from + 4 } })
        await settle()
        const final = editorSnapshot()
        depths = final.depths
        finalInside = final.inside && final.painted
        hanging = final.hanging
      }
      await settle()
      if (${JSON.stringify(mode)} === 'preview') snapshot = { readingNow: readingSnapshot(), readingBaseline: ${JSON.stringify(readingFacts)} }
      if (${JSON.stringify(mode)} === 'source') {
        const final = editorSnapshot()
        snapshot = { ...final, initialCheck }
        finalInside = finalInside && final.inside && final.painted
        hanging = hanging && final.hanging
      }
      const shot = await shoot(${JSON.stringify(label)})
      if (${JSON.stringify(mode)} === 'source') {
        const final = editorSnapshot()
        snapshot = { ...final, initialCheck }
        finalInside = finalInside && final.inside && final.painted
        hanging = hanging && final.hanging
      }
      app.vault.setConfig('showIndentGuide', false)
      await wait(1000)
      const off = ${JSON.stringify(mode)} === 'preview'
        ? !leaf.view.containerEl.querySelector('.abele-code-line')
        : !leaf.view.editor.cm.contentDOM.querySelector('.abele-code-guides')
      if (${JSON.stringify(mode)} === 'preview') height.push(unwrappedHeight(leaf.view.containerEl.querySelector('pre > code')))
      await shoot(${JSON.stringify(label + '-off')})
      return { text, selected, depths, off, caret, wraps, painted, nativeInput, shot, finalInside, finalOutside, hanging, height, width: innerWidth, snapshot }
      })
    })()`)
      console.log('Code guide diagnostics', JSON.stringify(result.snapshot))
      if (mode === 'preview') readingFacts = result.snapshot
      expect(result.text).toBe(mode === 'preview' ? CODE : CONTENT)
      expect(result.selected).toBe(result.text)
      expect(result.depths, JSON.stringify(result.snapshot)).toEqual(
        mode === 'preview' ? ['0', '1', '1', '2', '1', '0'] : ['1', '1', '2', '1']
      )
      expect(result.off).toBe(true)
      expect(result.caret).toBe(true)
      expect(result.painted, JSON.stringify(result.snapshot)).toBe(true)
      expect(result.finalInside, JSON.stringify(result.snapshot)).toBe(true)
      expect(result.finalOutside).toBe(true)
      expect(result.hanging, JSON.stringify(result.snapshot)).toBe(true)
      if (mode === 'preview')
        expect(Math.abs(result.height[0] - result.height[1])).toBeLessThanOrEqual(0.5)
      if (label.startsWith('phone-')) expect(result.width).toBe(390)
      if (mode === 'source') {
        expect(result.wraps).toBeGreaterThanOrEqual(2)
        if (!onPhone())
          expect(result.nativeInput, JSON.stringify(result.snapshot)).toEqual({
            down: true,
            up: true,
            click: true,
          })
      }
      expect(result.shot).toBeTruthy()
    })

  it('reading mode preserves selectable code and follows the guide setting', () =>
    check('preview', false, 'desktop-reading'))
  it('Live Preview preserves caret coordinates across wrapped lines', () =>
    check('source', false, 'desktop-live'))
  it('source mode uses the same guides', () => check('source', true, 'desktop-source'))
  it.skipIf(onPhone())('captures narrow reading and editor states', async () => {
    await withEmulatedPhone(async () => {
      await check('preview', false, 'phone-reading')
      await check('source', false, 'phone-live')
    })
  })
})
