/**
 * The mermaid viewer in the running app: a note holding a flowchart far wider than any note,
 * shown in reading view, in Live Preview and on a phone.
 *
 * The note is written at the vault's root for the length of this file and deleted after it, so
 * the fixture vault ends with nothing but `ScaleTest/` in it. Obsidian asks each vault whether
 * diagrams may be shown at all; the answer is set to yes here and put back as it was.
 *
 * Pictures go to `/tmp/abele-mermaid/` — look at them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const NOTE = 'Mermaid viewer e2e.md'
const SHOTS = '/tmp/abele-mermaid'
const PHONE = { width: 390, height: 844 }

/** Forty boxes in one row, with a branch under every fifth: far wider than any note. */
const FLOWCHART = [
  'graph LR',
  ...Array.from(
    { length: 40 },
    (_, i) => `  N${i}[Step number ${i}] --> N${i + 1}[Step number ${i + 1}]`
  ),
  ...Array.from({ length: 8 }, (_, i) => `  N${i * 5} --> B${i}{{Branch ${i}}}`),
].join('\n')

const CONTENT = `# Mermaid viewer\n\nA diagram wider than the note.\n\n\`\`\`mermaid\n${FLOWCHART}\n\`\`\`\n\nAfter the diagram.\n`

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 20000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      try { const v = fn(); if (v) return v } catch {}
      await wait(100)
    }
    return null
  }
  const leafOf = () => app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === ${JSON.stringify(NOTE)})
  /** The viewer's canvas once a drawing is in it and fitted, which is when it has a transform. */
  const drawn = (root) => {
    const c = root.querySelector('.abele-mermaid__canvas')
    return c && c.querySelector('svg') && c.style.transform ? c : null
  }
  const scaleOf = (canvas) => Number(/scale\\(([\\d.]+)\\)/.exec(canvas.style.transform)?.[1])
  const shoot = async (name) => {
    require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    const path = ${JSON.stringify(SHOTS)} + '/' + name + '.png'
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
        if (img) { require('fs').writeFileSync(path, img.toPNG()); return path }
      } catch (e) { await wait(500) }
    }
    return 'no picture'
  }
  const openNote = async (mode) => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
    let leaf = leafOf()
    if (!leaf) { leaf = app.workspace.getLeaf(false); await leaf.openFile(file) }
    await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode, source: false }, active: true })
    app.workspace.revealLeaf(leaf)
    return leaf
  }
`

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

const reload = async (how: string): Promise<void> => {
  await reloadApp(how)
}

describe.skipIf(!available)('the mermaid viewer', () => {
  let trust = 'null'

  beforeAll(async () => {
    trust = evalRaw(`JSON.stringify(app.loadLocalStorage('mermaid-vault-trust'))`)
      .replace(/^=>\s*/, '')
      .trim()
    evalAsync(`(async () => {
      app.saveLocalStorage('mermaid-vault-trust', true)
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      if (old) await app.vault.delete(old)
      await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(CONTENT)})
      return { ok: true }
    })()`)
  })

  afterAll(async () => {
    evalAsync(`(async () => {
      for (const l of app.workspace.getLeavesOfType('markdown'))
        if (l.view.file?.path === ${JSON.stringify(NOTE)}) l.detach()
      const f = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      if (f) await app.vault.delete(f)
      app.saveLocalStorage('mermaid-vault-trust', ${trust === 'true' ? 'true' : 'null'})
      return { ok: true }
    })()`)
  })

  it('draws the diagram in reading view at the width of the note, instead of Obsidian', () => {
    const r = evalAsync<{
      error?: string
      obsidians?: number
      frame?: { width: number; height: number }
      sizer?: number
      drawn?: { left: number; right: number }
      frameBox?: { left: number; right: number }
      sideways?: number
      shot?: string
    }>(
      `(async () => {
      ${PRELUDE}
      const leaf = await openNote('preview')
      const root = leaf.view.containerEl.querySelector('.markdown-preview-view')
      const canvas = await until(() => drawn(root))
      if (!canvas) return { error: 'no diagram drawn' }
      const svg = canvas.querySelector('svg')
      await wait(500)
      const frame = root.querySelector('.abele-mermaid__frame')
      const f = frame.getBoundingClientRect()
      const s = svg.getBoundingClientRect()
      return {
        obsidians: root.querySelectorAll('.mermaid, code.language-mermaid').length,
        frame: { width: Math.round(f.width), height: Math.round(f.height) },
        sizer: Math.round(root.querySelector('.markdown-preview-sizer').getBoundingClientRect().width),
        drawn: { left: Math.round(s.left), right: Math.round(s.right) },
        frameBox: { left: Math.round(f.left), right: Math.round(f.right) },
        sideways: root.scrollWidth - root.clientWidth,
        shot: await shoot('desktop-reading'),
      }
    })()`,
      90_000
    )
    expect(r.error).toBeUndefined()
    expect(r.obsidians).toBe(0)
    expect(r.frame!.width).toBeLessThanOrEqual(r.sizer!)
    // Fitted: the whole drawing is inside the frame.
    expect(r.drawn!.left).toBeGreaterThanOrEqual(r.frameBox!.left - 1)
    expect(r.drawn!.right).toBeLessThanOrEqual(r.frameBox!.right + 1)
    expect(r.frame!.height).toBeGreaterThanOrEqual(176)
    expect(r.frame!.height).toBeLessThanOrEqual(640)
    expect(r.sideways).toBe(0)
  })

  it('zooms with its buttons and fits the diagram again', () => {
    const r = evalAsync<{ error?: string; fit?: number; zoomed?: number; back?: number }>(
      `(async () => {
      ${PRELUDE}
      const leaf = await openNote('preview')
      // The note's editor is in the same pane, hidden, with a viewer of its own.
      const root = leaf.view.containerEl.querySelector('.markdown-preview-view')
      const canvas = await until(() => drawn(root))
      if (!canvas) return { error: 'no viewer' }
      const fit = scaleOf(canvas)
      root.querySelector('.abele-mermaid__zoom-in').click()
      root.querySelector('.abele-mermaid__zoom-in').click()
      const zoomed = scaleOf(canvas)
      root.querySelector('.abele-mermaid__reset').click()
      return { fit, zoomed, back: scaleOf(canvas) }
    })()`
    )
    expect(r.error).toBeUndefined()
    expect(r.zoomed).toBeCloseTo(r.fit! * 1.5625, 3)
    expect(r.back).toBeCloseTo(r.fit!, 5)
  })

  it('opens full screen, larger than in the note, and closes with Escape', () => {
    const r = evalAsync<{
      error?: string
      inNote?: number
      full?: { width: number; height: number; scale: number }
      shot?: string
      closed?: boolean
    }>(
      `(async () => {
      ${PRELUDE}
      const leaf = await openNote('preview')
      // The note's editor is in the same pane, hidden, with a viewer of its own.
      const root = leaf.view.containerEl.querySelector('.markdown-preview-view')
      const canvas = await until(() => drawn(root))
      if (!canvas) return { error: 'no viewer' }
      const inNote = scaleOf(canvas)
      root.querySelector('.abele-mermaid__fullscreen').click()
      const modal = await until(() => document.querySelector('.modal.abele-modal_full'))
      if (!modal) return { error: 'no dialog' }
      const svg = await until(() => drawn(modal))
      if (!svg) return { error: 'nothing drawn full screen' }
      await wait(600)
      const frame = modal.querySelector('.abele-mermaid__frame').getBoundingClientRect()
      const full = { width: Math.round(frame.width), height: Math.round(frame.height),
        scale: scaleOf(modal.querySelector('.abele-mermaid__canvas')) }
      const shot = await shoot('desktop-fullscreen')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      const closed = !!(await until(() => !document.querySelector('.modal.abele-modal_full'), 5000))
      return { inNote, full, shot, closed }
    })()`,
      90_000
    )
    expect(r.error).toBeUndefined()
    expect(r.full!.height).toBeGreaterThan(300)
    expect(r.full!.scale).toBeGreaterThan(r.inNote!)
    expect(r.closed).toBe(true)
  })

  it('draws the diagram in Live Preview in place of Obsidian widget, and shows source to edit', () => {
    const r = evalAsync<{
      error?: string
      obsidians?: number
      ours?: number
      editing?: number
      shot?: string
    }>(
      `(async () => {
      ${PRELUDE}
      const leaf = await openNote('source')
      const view = leaf.view
      view.editor.setCursor({ line: 0, ch: 0 })
      const root = view.containerEl.querySelector('.cm-content')
      const svg = await until(() => root.querySelector('.abele-mermaid__canvas svg'))
      if (!svg) return { error: 'no diagram in Live Preview' }
      await wait(500)
      const obsidians = root.querySelectorAll('.cm-preview-code-block.cm-lang-mermaid, .mermaid').length
      const ours = root.querySelectorAll('.abele-mermaid').length
      const shot = await shoot('desktop-live-preview')
      root.querySelector('.abele-mermaid__controls_top [aria-label="Edit the diagram\\'s source"]')?.click()
      await wait(400)
      const editing = root.querySelectorAll('.abele-mermaid').length
      view.editor.setCursor({ line: 0, ch: 0 })
      return { obsidians, ours, editing, shot }
    })()`,
      90_000
    )
    expect(r.error).toBeUndefined()
    expect(r.obsidians).toBe(0)
    expect(r.ours).toBe(1)
    expect(r.editing).toBe(0)
  })

  describe('on a phone', () => {
    let size: [number, number] = [0, 0]
    let phone: {
      full?: {
        error?: string
        dialog?: { left: number; right: number; top: number; bottom: number }
        frame?: { left: number; right: number; height: number }
        screen?: { width: number; height: number }
        closed?: boolean
      }
      error?: string
      isPhone?: boolean
      sideways?: number
      frame?: { left: number; right: number }
      screen?: number
      shot?: string
    } = {}

    beforeAll(async () => {
      size = windowSize()
      await reload('app.emulateMobile(true)')
      await setWindowSize(PHONE.width, PHONE.height)
      await reload('window.location.reload()')
      // A hidden window hands back no frame after a reload until its size is nudged.
      await setWindowSize(PHONE.width + 2, PHONE.height + 2)
      await setWindowSize(PHONE.width, PHONE.height)
      phone = evalAsync(
        `(async () => {
        ${PRELUDE}
        const leaf = await openNote('preview')
        const root = leaf.view.containerEl.querySelector('.markdown-preview-view')
        const svg = await until(() => root.querySelector('.abele-mermaid__canvas svg'))
        if (!svg) return { error: 'no diagram on the phone' }
        await wait(800)
        const f = root.querySelector('.abele-mermaid__frame').getBoundingClientRect()
        return {
          isPhone: document.body.classList.contains('is-phone'),
          sideways: root.scrollWidth - root.clientWidth,
          frame: { left: Math.round(f.left), right: Math.round(f.right) },
          screen: window.innerWidth,
          shot: await shoot('phone-reading'),
          full: await (async () => {
            root.querySelector('.abele-mermaid__fullscreen').click()
            const modal = await until(() => document.querySelector('.modal.abele-modal_full'))
            if (!modal) return { error: 'no dialog' }
            if (!(await until(() => drawn(modal)))) return { error: 'nothing drawn full screen' }
            modal.style.transition = 'none'
            await wait(600)
            const m = modal.getBoundingClientRect()
            const f = modal.querySelector('.abele-mermaid__frame').getBoundingClientRect()
            const report = {
              dialog: { left: Math.round(m.left), right: Math.round(m.right), top: Math.round(m.top), bottom: Math.round(m.bottom) },
              frame: { left: Math.round(f.left), right: Math.round(f.right), height: Math.round(f.height) },
              screen: { width: window.innerWidth, height: window.innerHeight },
              shot: await shoot('phone-fullscreen'),
            }
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            report.closed = !!(await until(() => !document.querySelector('.modal.abele-modal_full'), 5000))
            return report
          })(),
        }
      })()`,
        90_000
      )
      console.info(`\n  ${JSON.stringify(phone)}\n`)
    }, 300_000)

    afterAll(async () => {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reload('app.emulateMobile(false)')
    }, 180_000)

    it('fits the screen and nothing scrolls sideways', () => {
      expect(phone.error).toBeUndefined()
      expect(phone.isPhone).toBe(true)
      expect(phone.sideways).toBe(0)
      expect(phone.frame!.left).toBeGreaterThanOrEqual(0)
      expect(phone.frame!.right).toBeLessThanOrEqual(phone.screen!)
    })

    it('opens full screen as the whole sheet, and closes again', () => {
      const full = phone.full!
      expect(full.error).toBeUndefined()
      expect(full.dialog!.left).toBeGreaterThanOrEqual(0)
      expect(full.dialog!.right).toBeLessThanOrEqual(full.screen!.width)
      expect(full.dialog!.bottom).toBeLessThanOrEqual(full.screen!.height + 1)
      expect(full.frame!.right).toBeLessThanOrEqual(full.screen!.width)
      // Most of the screen goes to the diagram.
      expect(full.frame!.height).toBeGreaterThan(full.screen!.height / 2)
      expect(full.closed).toBe(true)
    })
  })
})
