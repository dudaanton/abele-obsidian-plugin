/**
 * A press on a task drawn in a note, or on the buttons over a task note, leaves the note where it
 * was and the editor without the focus.
 *
 * The list under a note did not: a press on anything in it that takes no focus of its own went
 * on to the editor, which took the focus, put its cursor down and scrolled to it
 * (`footerTaskClick.e2e.test.ts`). Two more things of ours are drawn inside the editor's page:
 * a task linked on a line of its own, drawn in place of the link, and the row of buttons over a
 * task note. Only the app can show this — a synthetic `click()` has no press before it, and it
 * is the press that the browser and the editor act on.
 *
 * - A note with a task line (`- [ ] [[task]]`) between forty paragraphs above and below, in live preview, the
 *   task in the middle of the window: its checkbox, then its chevron.
 * - A task note with a long body, scrolled to its top: the button that marks it done.
 *
 * Each once with nothing focused, once with the editor focused and its cursor at the far end of
 * the note, as after writing there. After each: what was pressed is where it was, give or take
 * two pixels; the editor does not have the focus; the press did its job.
 *
 * On a desktop window and under `emulateMobile`; with `E2E_TARGET=phone` on the phone. Writes
 * its own folder of notes and removes it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')

const FOLDER = 'Widget click probe'

interface Press {
  /** What was pressed, from the top of the window, before and after. */
  before: number
  after: number
  /** What had the focus afterwards, and whether the editor had it. */
  active: string
  inEditor: boolean
  /** The press did its job: the task is done, or its description is shown. */
  done: boolean
}

interface Report {
  mobile?: boolean
  tick?: Press
  expand?: Press
  tickTyping?: Press
  expandTyping?: Press
  header?: Press
  headerTyping?: Press
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
  const hostPath = folder + '/Sample host note.md'
  const linkedPath = folder + '/Tasks/Sample linked task.md'
  const headedPath = folder + '/Tasks/Sample headed task.md'
  const report = { mobile: !!app.isMobile }

  // A real press where the element is: a finger on a phone, the mouse through DevTools elsewhere.
  // On a phone the request that carries the touch now and then dies on the reversed port before
  // it arrives; it is sent again only when nothing has happened, so a touch that did arrive is
  // never made twice.
  const cdp = window.__e2eHost ? null : require('@electron/remote').getCurrentWebContents().debugger
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
  const describe = (el) =>
    !el || el === document.body ? 'body' : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')
  const open = async (path) => {
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'source', source: false }, active: true })
    await wait(1500)
  }

  // \`find\` gives what to press, \`place\` puts it where it is pressed; \`typing\`: the editor has the
  // focus and its cursor at the end of the note beforehand, otherwise nothing has.
  const measure = async ({ find, place, settled, typing }) => {
    const editor = leaf.view.editor
    if (typing) {
      const last = editor.lastLine()
      editor.setCursor({ line: last, ch: editor.getLine(last).length })
      editor.focus()
    } else {
      const a = document.activeElement
      if (a && a !== document.body) a.blur()
    }
    // A phone's keyboard comes up for a focused editor and scrolls to its cursor on the way.
    await wait(typing ? 1500 : 300)
    let target = null
    for (let attempt = 0; attempt < 3 && !target; attempt++) {
      await place()
      await wait(1200)
      target = await until(find, 5000)
    }
    if (!target) throw new Error('nothing to press')
    const before = target.getBoundingClientRect().top
    await press(target, settled)
    const done = !!(await until(settled, 5000))
    await wait(1500)
    const active = document.activeElement
    return {
      before: Math.round(before),
      after: Math.round(target.isConnected ? target.getBoundingClientRect().top : -9999),
      active: describe(active),
      inEditor: editor.hasFocus(),
      done,
    }
  }

  const scroller = () => leaf.view.containerEl.querySelector('.cm-scroller')
  const widget = () => leaf.view.containerEl.querySelector('.abele-task-widget-container .abele-task-view')
  // The editor draws only what is near the window: the task is scrolled to until it is drawn.
  const placeWidget = async () => {
    const found = await until(() => {
      const w = widget()
      if (w) return w
      const s = scroller()
      s.scrollTop = s.scrollHeight / 2
      return null
    }, 10000)
    if (!found) throw new Error('the linked task was never drawn')
    found.scrollIntoView({ block: 'center' })
  }
  const done = (path) => async () => /\\ncompleted: /.test(await read(path))
  const undone = (path) => async () => !/\\ncompleted: /.test(await read(path))

  try {
    const old = app.vault.getAbstractFileByPath(folder)
    if (old) await app.vault.delete(old, true)
    await app.vault.createFolder(folder)
    await app.vault.createFolder(folder + '/Tasks')
    const paragraphs = (n, what) =>
      Array.from({ length: n }, (_, i) => 'Paragraph ' + (i + 1) + ' ' + what + ' the sample task.').join('\\n\\n')
    const task = (title) =>
      '---\\ntype: task\\ncreated: 2026-01-01\\n---\\n' + title + '\\n\\nThe description of ' + title.toLowerCase() + '.\\n'
    await app.vault.create(linkedPath, task('Sample linked task'))
    await app.vault.create(
      headedPath,
      task('Sample headed task') + '\\n' + paragraphs(60, 'in the body of') + '\\n'
    )
    await app.vault.create(
      hostPath,
      paragraphs(40, 'before') + '\\n\\n- [ ] [[Sample linked task]]\\n\\n' + paragraphs(40, 'after') + '\\n'
    )
    await until(() => app.metadataCache.resolvedLinks[hostPath]?.[linkedPath], 20000)
    await wait(1000)

    // The task drawn in place of its link: tick, untick while writing, open or close twice.
    await open(hostPath)
    const box = () => widget()?.querySelector('input.task-list-item-checkbox')
    const chevron = () => [...(widget()?.children ?? [])].find((c) => c.classList.contains('abele-obsidian-icon'))
    const described = () => !!widget()?.querySelector('.abele-task-view__description')
    // Whether the description was showing when the chevron was found: a task scrolled out of
    // the editor and back is drawn afresh, closed.
    let wasOpen = false
    const chevronNow = () => {
      const c = chevron()
      if (c) wasOpen = described()
      return c
    }
    const flipped = () => described() !== wasOpen
    report.tick = await measure({ find: box, place: placeWidget, settled: done(linkedPath), typing: false })
    report.tickTyping = await measure({ find: box, place: placeWidget, settled: undone(linkedPath), typing: true })
    report.expand = await measure({ find: chevronNow, place: placeWidget, settled: flipped, typing: false })
    report.expandTyping = await measure({ find: chevronNow, place: placeWidget, settled: flipped, typing: true })

    // The buttons over a task note, the note scrolled to its top.
    await open(headedPath)
    const toggle = () => {
      const bar = leaf.view.containerEl.querySelector('.abele-task-header-view')
      return bar ? bar.querySelector('.abele-obsidian-icon') : null
    }
    const placeTop = async () => {
      scroller().scrollTop = 0
    }
    report.header = await measure({ find: toggle, place: placeTop, settled: done(headedPath), typing: false })
    report.headerTyping = await measure({ find: toggle, place: placeTop, settled: undone(headedPath), typing: true })
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
    })

    it('a linked task: ticking it keeps the note in place and the focus out of it', () => {
      stays(report.tick)
    })

    it('a linked task: unticking it while writing keeps the note in place and takes the focus out', () => {
      stays(report.tickTyping)
    })

    it('a linked task: opening it keeps the note in place and the focus out of it', () => {
      stays(report.expand)
    })

    it('a linked task: closing it while writing keeps the note in place and takes the focus out', () => {
      stays(report.expandTyping)
    })

    it('a task note: marking it done keeps the note in place and the focus out of it', () => {
      stays(report.header)
    })

    it('a task note: marking it undone while writing keeps the note in place and takes the focus out', () => {
      stays(report.headerTyping)
    })
  })

if (onPhone()) {
  suite(
    'pressing a task drawn in a note, on the phone',
    async () => {},
    async () => {}
  )
} else {
  suite(
    'pressing a task drawn in a note, on a desktop',
    async () => {},
    async () => {}
  )

  let size: [number, number] = [0, 0]
  suite(
    'pressing a task drawn in a note, in the phone layout',
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
