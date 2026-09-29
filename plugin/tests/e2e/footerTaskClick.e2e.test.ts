/**
 * Ticking a task or opening its description in the list under a note leaves the note where it
 * was and the editor without the focus.
 *
 * The list is drawn inside the editor, as a block at the end of the note. A press there that
 * the list does not claim goes on to the editor: it takes the focus, puts its cursor at the end
 * of the note and scrolls to it, so the page jumped and the keyboard landed in the note. Only
 * the app can show it — a synthetic `click()` has no press before it, and it is the press that
 * the browser and the editor act on.
 *
 * A group note with seventy tasks of its own, each with a description, in live preview, scrolled
 * so a task a dozen rows down is in the middle of the window. A real press — the mouse on a
 * desktop, a finger on a phone — on its checkbox, then on another task's chevron; once with
 * nothing focused, once with the editor focused and its cursor at the top of the note, as after
 * writing in it. After each:
 *
 * - the row above the one pressed is where it was, give or take two pixels;
 * - the editor does not have the focus;
 * - the ticked task's file says it is done, the opened task shows its description.
 *
 * Source mode and reading view draw no list under the note; the probe checks that too. On a
 * desktop window and under `emulateMobile`; with `E2E_TARGET=phone` on the phone. Writes its own
 * folder of notes and removes it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')

const FOLDER = 'Footer click probe'
const TASKS = 70

interface Press {
  /** The row above the pressed one, from the top of the window, before and after. */
  before: number
  after: number
  /** What had the focus afterwards, and whether it was inside the editor. */
  active: string
  inEditor: boolean
  /** The ticked task's file says done / the opened task shows its description. */
  done: boolean
}

interface Report {
  mobile?: boolean
  live?: {
    tick?: Press
    expand?: Press
    tickTyping?: Press
    expandTyping?: Press
    error?: string
  }
  /** Rows of the list drawn in source mode and in reading view. */
  sourceRows?: number
  readingRows?: number
  error?: string
}

const script = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const v = await fn()
      if (v) return v
      await wait(100)
    }
    return null
  }
  const folder = ${JSON.stringify(FOLDER)}
  const groupPath = folder + '/Footer click group.md'
  const taskPath = (i) => folder + '/Tasks/Sample task ' + String(i).padStart(2, '0') + '.md'
  const report = { mobile: !!app.isMobile }

  // A real press where the element is: a finger on a phone, the mouse through DevTools elsewhere.
  const cdp = window.__e2eHost ? null : require('@electron/remote').getCurrentWebContents().debugger
  // On a phone the request that carries the touch now and then dies on the reversed port before
  // it arrives; it is sent again only when nothing has happened, so a touch that did arrive is
  // never made twice.
  const press = async (el, settled) => {
    const r = el.getBoundingClientRect()
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
    if (window.__e2eHost) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { return await window.__e2eHost.tap(x, y) } catch (e) {
          if (!String(e && e.message).includes('connection was lost')) throw e
          await wait(1500)
          if (await settled()) return
        }
      }
      return
    }
    const mouse = (type, buttons) =>
      cdp.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 })
    await mouse('mouseMoved', 0)
    await mouse('mousePressed', 1)
    await wait(60)
    await mouse('mouseReleased', 0)
  }

  const read = (path) => app.vault.cachedRead(app.vault.getAbstractFileByPath(path))
  const leaf = app.workspace.getLeaf('tab')
  const footer = () => leaf.view.containerEl.querySelector('.abele-footer-view')
  const rows = () => [...(footer()?.querySelectorAll('.abele-todo-list .abele-task-view') ?? [])]
  const describe = (el) =>
    !el || el === document.body ? 'body' : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')

  // Brings a row to the middle of the window, lets everything settle, then presses what \`pick\`
  // chose in it and measures the row above it. \`typing\`: the editor has the focus and its
  // cursor at the top of the note beforehand, as after writing in it and scrolling down;
  // otherwise nothing has. The editor draws only what is near the window, so the list is scrolled
  // back to and the row picked afresh after the editor jumped to its cursor.
  const measure = async (at, pick, typing) => {
    const editor = leaf.view.editor
    if (typing) {
      editor.setCursor({ line: 0, ch: 0 })
      editor.focus()
    } else {
      const a = document.activeElement
      if (a && a !== document.body) a.blur()
    }
    // A phone's keyboard comes up for a focused editor and scrolls to its cursor on the way.
    await wait(typing ? 1500 : 300)
    let row = null
    for (let attempt = 0; attempt < 3 && !row; attempt++) {
      await showRows()
      rows()[at].scrollIntoView({ block: 'center' })
      await wait(1200)
      row = rows()[at] ?? null
    }
    if (!row) throw new Error('the list went out of the editor before the press')
    const above = row.previousElementSibling
    const { target, settled } = pick(row)
    const before = above.getBoundingClientRect().top
    await press(target, settled)
    const done = !!(await until(settled, 5000))
    // The editor scrolls to its cursor a frame or several after the press; a re-render follows
    // the file being written.
    await wait(1500)
    const active = document.activeElement
    return {
      before: Math.round(before),
      after: Math.round(above.getBoundingClientRect().top),
      active: describe(active),
      inEditor: editor.hasFocus() || !!(active && active.closest && active.closest('.cm-content') && !active.closest('.abele-footer-widget-container')),
      done,
    }
  }

  const showRows = async () => {
    const scroller = leaf.view.containerEl.querySelector('.cm-scroller')
    const filled = await until(() => {
      scroller.scrollTop = scroller.scrollHeight
      return rows().length >= 18
    }, 30000)
    if (!filled) throw new Error('the list under the note never filled')
  }

  const open = async (state) => {
    await leaf.setViewState({ type: 'markdown', state: { file: groupPath, ...state }, active: true })
    await wait(1500)
  }

  const runLive = async () => {
    const out = {}
    try {
      await open({ mode: 'source', source: false })
      await showRows()
      // A row draws its title once it has been on screen.
      rows()[11].scrollIntoView({ block: 'center' })
      const named = (i) => /Sample task \\d+/.test(rows()[i]?.textContent ?? '')
      if (!(await until(() => [8, 12, 14].every(named), 10000))) throw new Error('the rows never drew their titles')
      await wait(1000)
      const nameOf = (row) => /Sample task \\d+/.exec(row.textContent)[0]

      // Rows well inside the first page, so the list runs on past them on both sides. A ticked
      // row leaves the list, so the next tick takes the row that moved up into its place.
      const tick = (typing) =>
        measure(8, (row) => {
          const path = folder + '/Tasks/' + nameOf(row) + '.md'
          return {
            target: row.querySelector('input.task-list-item-checkbox'),
            settled: async () => /\\ncompleted: /.test(await read(path)),
          }
        }, typing)
      const expand = (at, typing) =>
        measure(at, (row) => ({
          target: [...row.children].find((c) => c.classList.contains('abele-obsidian-icon')),
          settled: () => !!row.querySelector('.abele-task-view__description'),
        }), typing)
      out.tick = await tick(false)
      out.expand = await expand(12, false)
      out.tickTyping = await tick(true)
      out.expandTyping = await expand(14, true)
    } catch (e) {
      out.error = String((e && e.message) || e)
    }
    return out
  }

  try {
    const old = app.vault.getAbstractFileByPath(folder)
    if (old) await app.vault.delete(old, true)
    await app.vault.createFolder(folder)
    await app.vault.createFolder(folder + '/Tasks')
    const intro = Array.from({ length: 30 }, (_, i) => 'Paragraph ' + (i + 1) + ' of the sample group note.').join('\\n\\n')
    await app.vault.create(groupPath, intro + '\\n')
    for (let i = 1; i <= ${TASKS}; i++) {
      await app.vault.create(
        taskPath(i),
        '---\\ntype: task\\ncreated: 2026-01-01\\ngroups:\\n  - "[[Footer click group]]"\\n---\\n' +
          'Sample task ' + String(i).padStart(2, '0') + '\\n\\nThe description of sample task ' + i + '.\\n'
      )
    }
    // The link index takes the new notes in over a moment.
    await until(() => {
      const links = app.metadataCache.resolvedLinks[taskPath(${TASKS})]
      return links && Object.keys(links).length
    }, 20000)
    await wait(1500)

    report.live = await runLive()
    // Source mode and reading view draw no list under the note, so there is nothing to press.
    await open({ mode: 'source', source: true })
    report.sourceRows = leaf.view.containerEl.querySelectorAll('.abele-task-view').length
    await open({ mode: 'preview' })
    report.readingRows = leaf.view.containerEl.querySelectorAll('.abele-task-view').length
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    leaf.detach()
    const f = app.vault.getAbstractFileByPath(folder)
    if (f) await app.vault.delete(f, true)
  }
  return JSON.stringify(report)
})()`

const available = isObsidianRunning() && hasTestApi()

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const windowSize = (): [number, number] =>
  JSON.parse(
    evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
  ) as [number, number]

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

const stays = (p: Press | undefined) => {
  expect(p).toBeDefined()
  expect(p!.done).toBe(true)
  expect(Math.abs(p!.after - p!.before)).toBeLessThanOrEqual(2)
  expect(p!.inEditor, `focus went to ${p!.active}`).toBe(false)
}

const suite = (title: string, prepare: () => Promise<void>, restore: () => Promise<void>) =>
  describe.skipIf(!available)(title, () => {
    let report: Report = {}

    beforeAll(async () => {
      await prepare()
      report = JSON.parse(await evalLong(script, 240_000)) as Report
      console.info(`\n  ${JSON.stringify(report)}\n`)
    }, 400_000)

    afterAll(restore, 180_000)

    it('runs to the end', () => {
      expect(report.error ?? '').toBe('')
      expect(report.live?.error ?? '').toBe('')
    })

    it('ticking a task keeps the note in place and the focus out of it', () => {
      stays(report.live?.tick)
    })

    it('opening a task keeps the note in place and the focus out of it', () => {
      stays(report.live?.expand)
    })

    it('ticking a task while writing in the note keeps it in place and takes the focus out', () => {
      stays(report.live?.tickTyping)
    })

    it('opening a task while writing in the note keeps it in place and takes the focus out', () => {
      stays(report.live?.expandTyping)
    })

    it('source mode and reading view draw no list under the note', () => {
      expect(report.sourceRows).toBe(0)
      expect(report.readingRows).toBe(0)
    })
  })

if (onPhone()) {
  suite(
    'pressing a task in the list under a note, on the phone',
    async () => {},
    async () => {}
  )
} else {
  suite(
    'pressing a task in the list under a note, on a desktop',
    async () => {},
    async () => {}
  )

  let size: [number, number] = [0, 0]
  suite(
    'pressing a task in the list under a note, in the phone layout',
    async () => {
      size = windowSize()
      await reloadApp('app.emulateMobile(true)')
      await setWindowSize(390, 844)
      await reloadApp('window.location.reload()')
    },
    async () => {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reloadApp('app.emulateMobile(false)')
    }
  )
}
