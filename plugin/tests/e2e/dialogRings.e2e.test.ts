/**
 * Focus rings in the chat dialogs, on the desktop.
 *
 * A field draws its ring outside its own box, so every ancestor that clips has to leave room
 * for it. Twice on 2026-09-05 one did not — the dialog's mount point on a phone, its content
 * element on the desktop — and the search field lost 2px off each side: «задолбала меня
 * обрезка содержимого в модалках». This focuses every focusable thing in every tab of the
 * setup dialog, the history, the icon picker, the MCP server form and the list of keys, and
 * measures its ring against every clipping ancestor. The phone probe does the same at 390×844.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw } from './helpers/obsidianCli'

interface Cut {
  screen: string
  field: string
  by: string[]
}

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
  const press = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const closeDialog = async () => {
    if (!document.querySelector('.modal')) return
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
    )
    await until(() => !document.querySelector('.modal'), 3000)
  }

  const ringClipped = (field) => {
    const cs = getComputedStyle(field)
    const nums = (cs.boxShadow.match(/-?\\d+(\\.\\d+)?px/g) || []).map(parseFloat)
    const shadow = nums.length >= 4 ? Math.max(0, nums[2]) + Math.max(0, nums[3]) : 0
    const outline = cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || '0') : 0
    const reach = Math.max(shadow, outline)
    if (reach <= 0) return []
    const r = field.getBoundingClientRect()
    const ring = { left: r.left - reach, right: r.right + reach, top: r.top - reach, bottom: r.bottom + reach }
    const cut = []
    for (let el = field.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const s = getComputedStyle(el)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      const b = el.getBoundingClientRect()
      const left = b.left + el.clientLeft, top = b.top + el.clientTop
      const box = { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }
      // A scrolling box may legitimately have the field scrolled out of it vertically; the
      // sides are what a ring loses to a box that stands flush with the content.
      const by = Math.max(box.left - ring.left, ring.right - box.right)
      if (by > 0.5) cut.push(name(el) + ' ' + Math.round(by) + 'px')
    }
    return cut
  }

  const cuts = []
  const measureAll = (screen, root) => {
    const fields = root.querySelectorAll('input, textarea, select, button, [tabindex="0"]')
    for (const field of fields) {
      const s = getComputedStyle(field)
      if (s.display === 'none' || s.visibility === 'hidden') continue
      if (field.getBoundingClientRect().width === 0) continue
      field.focus()
      const by = ringClipped(field)
      if (by.length) cuts.push({ screen, field: name(field) + (field.placeholder ? ' "' + field.placeholder + '"' : ''), by })
      field.blur()
    }
  }

  await closeDialog()
  app.commands.executeCommandById('abele:show-ai-sidebar')
  await until(
    () => [...document.querySelectorAll('.abele-ai-chat')].some((el) => el.getBoundingClientRect().height > 0),
    5000
  )
  await wait(400)

  const chat = [...document.querySelectorAll('.abele-ai-chat')].find(
    (el) => el.getBoundingClientRect().height > 0
  )
  press(chat && chat.querySelector('.lucide-sliders-horizontal'))
  if (!(await until(() => document.querySelector('.modal .abele-chat-setup'), 5000))) {
    return JSON.stringify([{ screen: 'setup', field: '-', by: ['dialog did not open'] }])
  }
  await wait(300)
  for (const tab of [...document.querySelectorAll('.modal .abele-chat-setup .abele-tabs__tab')]) {
    tab.click()
    await wait(400)
    measureAll('setup ' + tab.textContent.trim().toLowerCase(), document.querySelector('.modal'))
  }
  await closeDialog()

  press(chat && chat.querySelector('.lucide-history'))
  if (await until(() => document.querySelector('.modal'), 5000)) {
    await wait(400)
    measureAll('history', document.querySelector('.modal'))
    await closeDialog()
  }

  window.__abeleTest.openIconPicker('calendar')
  if (await until(() => document.querySelector('.modal .abele-icon-picker .abele-icon-picker__icon'), 5000)) {
    await wait(400)
    measureAll('icon picker', document.querySelector('.modal'))
    await closeDialog()
  } else {
    cuts.push({ screen: 'icon picker', field: '-', by: ['dialog did not open'] })
  }

  // The MCP server's form with its tools fetched, from a stub: fields above a body that scrolls,
  // and Save in the row under it.
  const service = window.__abeleTest.McpService.getInstance()
  const fetchTools = service.fetchTools
  try {
    service.fetchTools = async () =>
      Array.from({ length: 12 }, (_, i) => ({ name: 'tool-' + i, description: 'A tool.', inputSchema: { type: 'object', properties: {} } }))
    window.__abeleTest.openMcpServer()
    if (await until(() => document.querySelector('.modal .abele-mcp-server'), 5000)) {
      const modal = document.querySelector('.modal .abele-mcp-server').closest('.modal')
      ;[...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fetch tools').click()
      await until(() => modal.querySelectorAll('.abele-mcp-server .setting-item').length > 12, 5000)
      await wait(400)
      measureAll('mcp server', modal)
      await closeDialog()
    } else {
      cuts.push({ screen: 'mcp server', field: '-', by: ['dialog did not open'] })
    }
  } finally {
    service.fetchTools = fetchTools
  }

  window.__abeleTest.openSecretsList()
  if (await until(() => document.querySelector('.modal .abele-secrets-list'), 5000)) {
    await wait(400)
    measureAll('secrets list', document.querySelector('.modal'))
    await closeDialog()
  } else {
    cuts.push({ screen: 'secrets list', field: '-', by: ['dialog did not open'] })
  }

  return JSON.stringify(cuts)
})()`

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('focus rings in the chat dialogs on the desktop', () => {
  let cuts: Cut[] = []

  beforeAll(() => {
    cuts = JSON.parse(evalRaw(script, 120_000)) as Cut[]
  }, 150_000)

  it('no box in the setup dialog, the history, the icon picker, the MCP server or the list of keys cuts the ring off a focused field', () => {
    expect(cuts.map((c) => `${c.screen}: ${c.field} — ${c.by.join(', ')}`)).toEqual([])
  })
})
