/**
 * The measuring half of a layout probe, as source text to splice into an `eval`.
 *
 * It is the same set of questions `phoneLayout.e2e.test.ts` asks of the chat dialogs — nothing
 * past the edge, one scroller that reaches the bottom, no desktop `max-height`, the sheet the
 * height of the screen, no clipped focus ring, a card's actions on the row of its title — so a
 * file that measures other dialogs asks them the same way. It is text because it runs inside
 * the app: everything here is evaluated in the renderer, not in the test process.
 *
 * No backticks anywhere in it: the text is itself spliced into a template literal, and one
 * would end the script.
 */

/** What one screen says about itself. */
export interface Screen {
  /** Class names of elements past the right edge of the root, with how far past. */
  over: string[]
  /** Everything inside the body that scrolls, with the space left blank under it. */
  scrollers: { name: string; height: number; spare: number }[]
  /** Scrolling boxes with a fixed ceiling lower than the body they stand in. */
  capped: string[]
  /** Cards whose actions were pushed onto a row of their own, below the title. */
  stranded: string[]
  /** Fields whose focus ring an ancestor cuts, with the ancestor and by how much. */
  clipped: string[]
  /** The root's height as a share of the window's. */
  fill: number
  /** The window's width when the screen was measured. */
  width: number
  /** Where the picture went. */
  shot: string
  error: string
  /** Whatever else a screen was asked, by name. */
  extra: Record<string, unknown>
}

/**
 * Helpers defined inside the renderer: `wait`, `until`, `name`, `measure(root, body)`,
 * `ringsOf(root)`, `shoot(label)`, `closeDialog()`, and `screen(label, root, body)`, which
 * measures, rings and pictures one screen into a `Screen`.
 */
export const probePrelude = (shots: string): string => `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      try { if (fn()) return true } catch {}
      await wait(100)
    }
    return false
  }
  const fs = require('fs')
  const win = require('@electron/remote').getCurrentWindow()
  fs.mkdirSync(${JSON.stringify(shots)}, { recursive: true })

  const name = (el) => ((el.className || el.tagName) + '').split(' ')[0].slice(0, 48)

  const measure = (root, body) => {
    const box = root.getBoundingClientRect()
    const view = root.ownerDocument.defaultView
    const edge = Math.min(box.right, view.innerWidth)
    const over = []
    const walk = (el) => {
      const s = view.getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'absolute') return
      if (el.classList.contains('is-measuring')) return
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > edge + 1) over.push(name(el) + ' +' + Math.round(r.right - edge))
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return
      for (const c of el.children) walk(c)
    }
    for (const c of root.children) walk(c)

    const host = body || root
    const hostBox = host.getBoundingClientRect()
    const scrollers = []
    const capped = []
    for (const el of host.querySelectorAll('*')) {
      const s = view.getComputedStyle(el)
      if (s.overflowY !== 'auto' && s.overflowY !== 'scroll') continue
      const ceiling = parseFloat(s.maxHeight)
      if (s.maxHeight.endsWith('px') && ceiling < hostBox.height - 1) capped.push(name(el) + ' ' + Math.round(ceiling) + 'px')
      if (el.scrollHeight <= el.clientHeight + 1) continue
      const r = el.getBoundingClientRect()
      if (r.height === 0) continue
      scrollers.push({ name: name(el), height: Math.round(r.height), spare: Math.round(hostBox.bottom - r.bottom) })
    }

    const stranded = []
    for (const actions of root.querySelectorAll('.abele-card__actions')) {
      const title = actions.parentElement && actions.parentElement.querySelector('.abele-card__title')
      if (!title) continue
      if (actions.getBoundingClientRect().top >= title.getBoundingClientRect().bottom - 1) {
        stranded.push(title.textContent.trim().slice(0, 40))
      }
    }

    return { over, scrollers, capped, stranded,
      fill: Math.round((box.height / view.innerHeight) * 100) / 100, width: view.innerWidth }
  }

  const ringClipped = (field) => {
    const view = field.ownerDocument.defaultView
    const cs = view.getComputedStyle(field)
    const nums = (cs.boxShadow.match(/-?\\d+(\\.\\d+)?px/g) || []).map(parseFloat)
    const shadow = nums.length >= 4 ? Math.max(0, nums[2]) + Math.max(0, nums[3]) : 0
    const outline = cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || '0') : 0
    const reach = Math.max(shadow, outline)
    if (reach <= 0) return []
    const r = field.getBoundingClientRect()
    const ring = { left: r.left - reach, right: r.right + reach }
    const cut = []
    for (let el = field.parentElement; el && el !== field.ownerDocument.documentElement; el = el.parentElement) {
      const s = view.getComputedStyle(el)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      const b = el.getBoundingClientRect()
      const left = b.left + el.clientLeft
      const right = left + el.clientWidth
      const by = Math.max(left - ring.left, ring.right - right)
      if (by > 0.5) cut.push(name(el) + ' ' + Math.round(by) + 'px')
    }
    return cut
  }

  /** Every focusable thing under the root, focused in turn, and what cut its ring. */
  const ringsOf = (root) => {
    const clipped = []
    const view = root.ownerDocument.defaultView
    const scrolls = new Map()
    for (const f of root.querySelectorAll('input, textarea, select, button, [tabindex="0"]')) {
      const s = view.getComputedStyle(f)
      if (s.display === 'none' || s.visibility === 'hidden') continue
      if (f.getBoundingClientRect().width === 0) continue
      // Focusing scrolls a field into view; where every scroller stood is put back after.
      for (let el = f.parentElement; el; el = el.parentElement) if (!scrolls.has(el)) scrolls.set(el, el.scrollTop)
      f.focus()
      for (const cut of ringClipped(f)) clipped.push(name(f) + ' "' + (f.textContent || f.placeholder || '').trim().slice(0, 20) + '": ' + cut)
      f.blur()
    }
    for (const [el, top] of scrolls) el.scrollTop = top
    return clipped
  }

  /**
   * A picture of the window. A capture after a reload under a phone's emulation can wait for
   * ever for a frame that never comes; a nudge of the window's size makes one, so a capture
   * that has not answered in five seconds is asked again after one.
   */
  const shoot = async (label) => {
    for (const el of document.querySelectorAll('.modal, .modal-container')) el.style.transition = 'none'
    await wait(400)
    let img = null
    for (let attempt = 0; attempt < 3 && !img; attempt++) {
      try {
        img = await Promise.race([win.webContents.capturePage(), wait(5000).then(() => null)])
      } catch (error) {
        img = null
      }
      if (!img) {
        const [w, h] = win.getContentSize()
        win.setContentSize(w + 2, h + 2)
        await wait(300)
        win.setContentSize(w, h)
        await wait(500)
      }
    }
    if (!img) throw new Error('the window gave no picture')
    const path = ${JSON.stringify(shots)} + '/' + label.replace(/[^a-z0-9]+/gi, '-') + '.png'
    fs.writeFileSync(path, img.toPNG())
    return path
  }

  const closeDialog = async () => {
    for (let i = 0; i < 4 && document.querySelector('.modal, .menu'); i++) {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
      )
      await wait(300)
    }
    return !document.querySelector('.modal, .menu')
  }

  const screen = async (label, root, body) => {
    const entry = { over: [], scrollers: [], capped: [], stranded: [], clipped: [], fill: 0, width: window.innerWidth, shot: '', error: '', extra: {} }
    try {
      if (!root) throw new Error('nothing to measure')
      entry.shot = await shoot(label)
      Object.assign(entry, measure(root, body))
      entry.clipped = ringsOf(root)
    } catch (e) {
      entry.error = String((e && e.message) || e)
    }
    return entry
  }
`
