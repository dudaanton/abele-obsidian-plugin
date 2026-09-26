/**
 * Dialogs taller than the window they open in, on the desktop.
 *
 * The MCP server dialog grows by a row per tool once they are fetched. In a window shorter than
 * that it was cut off at both ends — the top of the form and the row with Save — and nothing
 * scrolled it: the dialog clips what it holds, and the body inside never scrolled (2026-09-26,
 * from a screenshot). This makes the window short, fetches forty tools from a stub, and asks
 * of every such dialog that nothing it holds is cut off where it cannot be scrolled to, that
 * the body is what scrolls, and that the buttons are on screen without scrolling at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw, evalJson } from './helpers/obsidianCli'

const SHORT = { width: 1000, height: 480 }

interface Dialog {
  error: string
  /** The dialog's top and bottom against the window's height. */
  top: number
  bottom: number
  window: number
  /** Boxes that clip without scrolling, and hold more than they show. */
  cut: string[]
  /** Whether the body scrolls, and whether its last element comes into sight when it does. */
  bodyScrolls: boolean
  lastReached: boolean
  /** The footer's buttons, by their text. */
  buttons: string[]
  /** Buttons of the footer that stand outside the window or the dialog before any scrolling. */
  hiddenButtons: string[]
}

type Report = Record<string, Dialog>

const script = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(100)
    }
    return false
  }
  const name = (el) => ((el.className || el.tagName) + '').split(' ')[0].slice(0, 48)
  const closeDialog = async () => {
    if (!document.querySelector('.modal')) return
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
    )
    await until(() => !document.querySelector('.modal'), 3000)
  }

  const measure = (modal) => {
    for (const el of document.querySelectorAll('.modal, .modal-container')) el.style.transition = 'none'
    const box = modal.getBoundingClientRect()
    const entry = { error: '', top: Math.round(box.top), bottom: Math.round(box.bottom),
      window: window.innerHeight, cut: [], bodyScrolls: false, lastReached: false, buttons: [], hiddenButtons: [] }
    // A box that clips and does not scroll hides whatever it holds past its edge for good.
    for (const el of [modal, ...modal.querySelectorAll('*')]) {
      const s = getComputedStyle(el)
      if (s.overflowY !== 'hidden' && s.overflowY !== 'clip') continue
      if (el.scrollHeight > el.clientHeight + 1) entry.cut.push(name(el) + ' ' + (el.scrollHeight - el.clientHeight) + 'px')
    }
    const body = modal.querySelector('.abele-modal__body')
    const footer = modal.querySelector('.abele-modal__footer')
    for (const b of footer ? footer.querySelectorAll('button') : []) {
      entry.buttons.push(b.textContent.trim())
      const r = b.getBoundingClientRect()
      if (r.top < Math.max(0, box.top) || r.bottom > Math.min(window.innerHeight, box.bottom)) {
        entry.hiddenButtons.push(b.textContent.trim())
      }
    }
    // Whichever box scrolls the dialog's content — the body, or Obsidian's dialog itself.
    const scroller = [body, modal].find((el) => {
      const s = getComputedStyle(el)
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1
    })
    entry.bodyScrolls = scroller === body
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight
      const all = body.querySelectorAll('*')
      const last = all[all.length - 1]
      const s = scroller.getBoundingClientRect()
      const r = last.getBoundingClientRect()
      entry.lastReached = r.bottom <= s.bottom + 1 && r.bottom <= window.innerHeight + 1
      scroller.scrollTop = 0
    }
    return entry
  }

  const report = {}
  const t = window.__abeleTest
  const service = t.McpService.getInstance()
  const fetchTools = service.fetchTools
  try {
    // Forty tools, answered at once, whatever the URL: the list is what is under test.
    const lorem = 'Reads a page of the documentation for a library and returns it as markdown, with the examples kept whole.'
    service.fetchTools = async () =>
      Array.from({ length: 40 }, (_, i) => ({ name: 'tool-' + i, description: lorem, inputSchema: { type: 'object', properties: {} } }))
    await closeDialog()
    t.openMcpServer()
    if (!(await until(() => document.querySelector('.modal .abele-mcp-server'), 5000))) {
      report['mcp server'] = { error: 'the dialog did not open' }
    } else {
      const modal = document.querySelector('.modal .abele-mcp-server').closest('.modal')
      ;[...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fetch tools').click()
      await until(() => modal.querySelectorAll('.abele-mcp-server .setting-item').length > 40, 5000)
      await wait(400)
      report['mcp server'] = measure(modal)
    }
    await closeDialog()

    t.openSecretsList()
    if (await until(() => document.querySelector('.modal .abele-secrets-list'), 5000)) {
      await wait(400)
      report['secrets list'] = measure(document.querySelector('.modal'))
    } else {
      report['secrets list'] = { error: 'the dialog did not open' }
    }
    await closeDialog()

    t.showFormModal(Array.from({ length: 16 }, (_, i) => ({ name: 'f' + i, label: 'Field ' + i, type: 'text' })))
    if (await until(() => document.querySelector('.modal .abele-script-form'), 5000)) {
      await wait(400)
      report['script form'] = measure(document.querySelector('.modal'))
    } else {
      report['script form'] = { error: 'the dialog did not open' }
    }
    await closeDialog()
  } catch (e) {
    report['run'] = { error: String((e && e.message) || e) }
  } finally {
    service.fetchTools = fetchTools
    await closeDialog()
  }
  return JSON.stringify(report)
})()`

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`,
    30_000
  )

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => {
      require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height})
      return 'ok'
    })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('a dialog taller than the window', () => {
  let report: Report = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    size = windowSize()
    await setWindowSize(SHORT.width, SHORT.height)
    report = JSON.parse(evalRaw(script, 90_000)) as Report
  }, 150_000)

  afterAll(async () => {
    if (size[0]) await setWindowSize(size[0], size[1])
  }, 60_000)

  const dialogs = ['mcp server', 'secrets list', 'script form']

  it('opens every dialog', () => {
    expect(report.run?.error ?? '').toBe('')
    for (const label of dialogs) expect(report[label]?.error, label).toBe('')
  })

  it.each(dialogs)('%s: stands inside the window', (label) => {
    const d = report[label]
    expect(d.top).toBeGreaterThanOrEqual(0)
    expect(d.bottom).toBeLessThanOrEqual(d.window)
  })

  it.each(dialogs)('%s: nothing is cut off where no scrolling reaches it', (label) => {
    expect(report[label]?.cut ?? ['no report']).toEqual([])
  })

  it.each(dialogs)('%s: its last line is reached by scrolling', (label) => {
    expect(report[label]?.lastReached).toBe(true)
  })

  it('mcp server: the body scrolls, and Save stays on screen without scrolling', () => {
    const d = report['mcp server']
    expect(d.bodyScrolls).toBe(true)
    expect(d.buttons).toContain('Save')
    expect(d.hiddenButtons).toEqual([])
  })
})
