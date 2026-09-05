/**
 * Every dialog of the chat, on a phone.
 *
 * The 1.18.0 settings dialog shipped with its tab strip on two rows, the skills list a box in
 * the top half of an otherwise empty sheet, and a width rule reaching the dialog from inside
 * one of its tabs. Every one of those had been looked at — on a desktop, at a desktop width.
 * Nothing had asked the question at the size a phone asks it, and happy-dom cannot: it computes
 * no layout at all.
 *
 * So the question is asked here, geometrically, of the running app in the layout Obsidian
 * gives a phone (`app.emulateMobile(true)`) in a phone-sized window (390×844, an iPhone's
 * points). For every screen:
 *
 * - nothing reaches past the right edge of the screen it is on;
 * - at most one thing scrolls inside the body — nested scrollers are the sign of a box that was
 *   sized for a small window and is now standing inside a sheet the height of the screen;
 * - whatever does scroll reaches the bottom of the body rather than leaving a blank half-screen
 *   under it, which is what a `max-height` written for a desktop dialog looks like on a phone;
 * - a sheet stands the height of the screen.
 *
 * And a picture of each screen is written to `/tmp/abele-phone/`, because a measurement says
 * that nothing is broken in the ways listed and a person looking at the picture says whether
 * it is right. Look at them before a release. They are never committed.
 *
 * `emulateMobile` reloads the app, which takes any JS state with it, so the run is separate
 * `eval` calls: switch, resize, probe, restore. See `commentChats.e2e.test.ts` for the same
 * shape and why. Requires Obsidian running on a vault with the development build — see
 * docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  isObsidianRunning,
  hasTestApi,
  evalRaw,
  evalJson,
  activeVaultName,
} from './helpers/obsidianCli'

const PHONE = { width: 390, height: 844 }
const SHOTS = '/tmp/abele-phone'

interface Screen {
  /** Class names of elements past the right edge of the root, with how far past. */
  over: string[]
  /** Everything inside the body that scrolls, with the space left blank under it. */
  scrollers: { name: string; height: number; spare: number }[]
  /** Scrolling boxes with a fixed ceiling lower than the body they stand in. */
  capped: string[]
  /** Ancestors that cut the focus ring of the field the screen focused, with how much of it. */
  clipped: string[]
  /** The root's height as a share of the window's. */
  fill: number
  /** Where the picture went. */
  shot: string
  error: string
}

type Report = Record<string, Screen>

/** `evalRaw` for a script that resolves to a JSON-serializable value, parsed directly. */
const evalAsync = <T>(script: string, timeoutMs: number): T =>
  JSON.parse(evalRaw(script, timeoutMs)) as T

const probeScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(100)
    }
    return false
  }
  const fs = require('fs')
  const win = require('@electron/remote').getCurrentWindow()
  fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })

  const name = (el) => ((el.className || el.tagName) + '').split(' ')[0].slice(0, 48)

  const measure = (root, body) => {
    const box = root.getBoundingClientRect()
    const edge = Math.min(box.right, window.innerWidth)
    const over = []
    const walk = (el) => {
      const s = getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'absolute') return
      if (el.classList.contains('is-measuring')) return
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > edge + 1) over.push(name(el) + ' +' + Math.round(r.right - edge))
      // What a row that scrolls sideways holds is meant to reach past its edge; the row is not.
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return
      for (const c of el.children) walk(c)
    }
    for (const c of root.children) walk(c)

    const host = body || root
    const hostBox = host.getBoundingClientRect()
    const scrollers = []
    const capped = []
    for (const el of host.querySelectorAll('*')) {
      const s = getComputedStyle(el)
      if (s.overflowY !== 'auto' && s.overflowY !== 'scroll') continue
      // A scrolling box with a fixed ceiling lower than the sheet was sized for another
      // dialog; on a phone it is the list in the top half of an empty screen.
      const ceiling = parseFloat(s.maxHeight)
      if (s.maxHeight.endsWith('px') && ceiling < hostBox.height - 1) capped.push(name(el) + ' ' + Math.round(ceiling) + 'px')
      if (el.scrollHeight <= el.clientHeight + 1) continue
      const r = el.getBoundingClientRect()
      if (r.height === 0) continue
      scrollers.push({ name: name(el), height: Math.round(r.height), spare: Math.round(hostBox.bottom - r.bottom) })
    }

    return { over, scrollers, capped, fill: Math.round((box.height / window.innerHeight) * 100) / 100 }
  }

  /**
   * The ancestors that cut a focused field's ring. The ring is a box-shadow drawn outside the
   * field's box, so every ancestor that clips has to leave room for its blur and spread; the
   * dialog's mount point did not, and the search field lost 2px off each side on a phone.
   */
  const ringClipped = (field) => {
    const nums = (getComputedStyle(field).boxShadow.match(/-?\\d+(\\.\\d+)?px/g) || []).map(parseFloat)
    const reach = nums.length >= 4 ? Math.max(0, nums[2]) + Math.max(0, nums[3]) : 0
    const r = field.getBoundingClientRect()
    const ring = { left: r.left - reach, right: r.right + reach, top: r.top - reach, bottom: r.bottom + reach }
    const cut = []
    for (let el = field.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      const b = el.getBoundingClientRect()
      const left = b.left + el.clientLeft, top = b.top + el.clientTop
      const box = { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }
      // The sides only: a scrolling body may legitimately have a field below its fold.
      const by = Math.max(box.left - ring.left, ring.right - box.right)
      if (by > 0.5) cut.push(name(el) + ' ' + Math.round(by) + 'px')
    }
    return cut
  }

  const shoot = async (label) => {
    // A hidden or backgrounded window runs no animations: a dialog measured mid-slide-in reads
    // where it started from. Nothing here waits on one.
    for (const el of document.querySelectorAll('.modal, .modal-container')) el.style.transition = 'none'
    await wait(400)
    const img = await win.webContents.capturePage()
    const path = ${JSON.stringify(SHOTS)} + '/' + label.replace(/[^a-z0-9]+/gi, '-') + '.png'
    fs.writeFileSync(path, img.toPNG())
    return path
  }

  const report = {}
  const screen = async (label, root, body) => {
    const entry = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: '' }
    try {
      if (!root) throw new Error('nothing to measure')
      entry.shot = await shoot(label)
      Object.assign(entry, measure(root, body))
    } catch (e) {
      entry.error = String((e && e.message) || e)
    }
    report[label] = entry
  }

  // Obsidian draws no .modal-close-button on a phone; Escape closes a dialog everywhere.
  const closeDialog = async () => {
    if (!document.querySelector('.modal')) return
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
    )
    await until(() => !document.querySelector('.modal'), 3000)
  }

  // Lists worth measuring: a vault with two skills shows nothing about how a list of twenty
  // stands in a sheet. These are written for the run and removed after it.
  const SEEDED = []
  const seed = async () => {
    const folder = 'Phone probe'
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder)
    for (let i = 1; i <= 12; i++) {
      const path = folder + '/probe-skill-' + i + '.md'
      const body = '---\\ntype: abele-skill\\nname: probe-skill-' + i +
        '\\ndescription: A skill written by the phone layout probe, number ' + i +
        ', with a description long enough to wrap onto a second line on a phone.\\n---\\n'
      await app.vault.create(path, body)
      SEEDED.push(path)
    }
    for (let i = 1; i <= 8; i++) {
      const path = folder + '/Probe prompt ' + i + '.md'
      const body = '---\\ntype: abele-prompt\\ndescription: A prompt written by the phone layout probe, number ' + i + '.\\n---\\nAsk about {{topic}}.\\n'
      await app.vault.create(path, body)
      SEEDED.push(path)
    }
    // Until the metadata cache has read the last of them, or the picker lists nothing new.
    await until(() => {
      const last = app.vault.getAbstractFileByPath(SEEDED[SEEDED.length - 1])
      return !!(last && app.metadataCache.getFileCache(last)?.frontmatter)
    }, 10000)
  }
  const unseed = async () => {
    for (const path of SEEDED) {
      const file = app.vault.getAbstractFileByPath(path)
      if (file) await app.vault.delete(file)
    }
    const folder = app.vault.getAbstractFileByPath('Phone probe')
    if (folder) await app.vault.delete(folder, true)
  }

  try {
    await closeDialog()
    await seed()
    app.commands.executeCommandById('abele:show-ai-sidebar')
    await until(() => {
      const chat = document.querySelector('.abele-ai-chat')
      return chat && chat.getBoundingClientRect().height > 0
    }, 8000)
    await wait(500)

    const chat = document.querySelector('.abele-ai-chat')
    await screen('chat', chat, chat)

    // The one dialog everything about a chat lives in, tab by tab.
    const setup = chat && chat.querySelector('.lucide-sliders-horizontal')
    if (setup) {
      setup.closest('.abele-icon, .clickable-icon, div').click()
      await until(() => document.querySelector('.modal .abele-chat-setup'), 5000)
      await wait(300)
      const tabs = [...document.querySelectorAll('.modal .abele-chat-setup .abele-tabs__tab')]
      for (const tab of tabs) {
        tab.click()
        await wait(400)
        const modal = document.querySelector('.modal')
        const label = tab.textContent.trim().toLowerCase()
        // The picker takes focus itself; the picture is of the ring that comes with it, which
        // a scrolling box clips unless it is given room. Blurred before measuring.
        // Every focusable thing on the tab is focused and its ring measured, not only the
        // search field: a dropdown's wrapper and the dialog's content element each cut one.
        const clipped = []
        if (modal) {
          for (const f of modal.querySelectorAll('input, textarea, select, button, [tabindex="0"]')) {
            const s = getComputedStyle(f)
            if (s.display === 'none' || s.visibility === 'hidden') continue
            if (f.getBoundingClientRect().width === 0) continue
            f.focus()
            for (const cut of ringClipped(f)) clipped.push(name(f) + ': ' + cut)
            f.blur()
          }
        }
        const field = modal && modal.querySelector('.abele-sp-picker input')
        if (field) {
          field.focus()
          await wait(200)
          await shoot('setup ' + label + ' focused')
          field.blur()
        }
        await screen('setup ' + label, modal, modal && modal.querySelector('.abele-modal__body'))
        report['setup ' + label].clipped = clipped
      }
      await closeDialog()
    } else {
      report['setup'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'no setup button' }
    }

    const history = chat && chat.querySelector('.lucide-history')
    if (history) {
      history.closest('.abele-icon, .clickable-icon, div').click()
      await until(() => document.querySelector('.modal .abele-chat-history'), 5000)
      await wait(300)
      const modal = document.querySelector('.modal')
      await screen('history', modal, modal && modal.querySelector('.abele-modal__body'))
      await closeDialog()
    }
  } catch (e) {
    report['run'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: String((e && e.message) || e) }
  } finally {
    await closeDialog()
    await unseed()
  }

  return report
})()`

/** Closes anything standing over the note and switches emulation, letting the reload settle. */
const setMobile = async (on: boolean): Promise<void> => {
  evalRaw(
    `(() => {
      const close = document.querySelector('.modal-close-button')
      if (close) close.click()
      app.emulateMobile(${on});
      return 'ok'
    })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 4000))
}

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

describe.skipIf(!available)('the chat dialogs on a phone', () => {
  let report: Report = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    size = windowSize()
    await setMobile(true)
    await setWindowSize(PHONE.width, PHONE.height)
    report = evalAsync<Report>(probeScript, 120_000)

    const lines = Object.entries(report).map(
      ([label, s]) => `  ${label.padEnd(20)} ${s.shot || s.error}`
    )
    console.info(`\n  vault ...................... ${activeVaultName()}\n${lines.join('\n')}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    await setMobile(false)
    if (size[0]) await setWindowSize(size[0], size[1])
  }, 120_000)

  const screens = [
    'chat',
    'setup scope',
    'setup skills',
    'setup prompts',
    'setup tools',
    'setup settings',
    'setup debug',
    'history',
  ]

  it('reaches every screen', () => {
    expect(report.run?.error ?? '').toBe('')
    for (const label of screens) {
      expect(report[label], label).toBeDefined()
      expect(report[label].error, label).toBe('')
    }
  })

  it.each(screens)('%s: nothing reaches past the edge of the screen', (label) => {
    expect(report[label]?.over ?? ['no report']).toEqual([])
  })

  it.each(screens)('%s: one thing scrolls inside the body, and it reaches the bottom', (label) => {
    const scrollers = report[label]?.scrollers ?? []
    expect(scrollers.length, JSON.stringify(scrollers)).toBeLessThanOrEqual(1)
    for (const s of scrollers)
      expect(s.spare, `${s.name} leaves ${s.spare}px blank under it`).toBeLessThanOrEqual(24)
  })

  it.each(screens.filter((s) => s.startsWith('setup')))(
    '%s: nothing cuts the focus ring off any field',
    (label) => {
      expect(report[label]?.clipped ?? ['no report']).toEqual([])
    }
  )

  it.each(screens)('%s: no box is capped below the height of the sheet', (label) => {
    expect(report[label]?.capped ?? ['no report']).toEqual([])
  })

  it.each(screens.filter((s) => s.startsWith('setup')))(
    '%s: the sheet stands the height of the screen',
    (label) => {
      expect(report[label]?.fill ?? 0).toBeGreaterThanOrEqual(0.85)
    }
  )
})
