/**
 * A note left scrolled down into the list under it comes back there, to the same row at the
 * same spot, with the list as it was left: pages shown, a task's description open.
 *
 * A group note with seventy tasks of its own, in live preview (the one mode with a list under
 * the note). The list is scrolled until its third page is drawn, the forty-fourth task opened,
 * and the forty-fifth brought a little below the top of the window. The note is left for another
 * in the same tab and opened again. Measured:
 *
 * - the forty-fifth row is back where it was, give or take a few pixels;
 * - the forty-fourth task still shows its description;
 * - on the way there nothing shakes: the scroller never turns back, and once the row has landed
 *   it stays.
 *
 * On a desktop window and under `emulateMobile`; with `E2E_TARGET=phone` on the phone. Writes its
 * own folder of notes and removes it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')

const FOLDER = 'Footer place probe'
const TASKS = 70
/** The row looked at, by its place in the list: past the first two pages of twenty. */
const ROW = 44
/** The row opened just above it. */
const OPENED = 43

interface Back {
  /** The row's top against the top of the scroller, when it was left and once back. */
  before: number
  after: number
  /** The rows drawn when it was left and once back. */
  rowsBefore: number
  rowsAfter: number
  /** Whether the opened task shows its description once back. */
  opened: boolean
  /** The scroller's position at every frame after the note opened again. */
  tops: number[]
  /** The row's top against the scroller's at every frame, null while it is not drawn. */
  rowTops: (number | null)[]
}

interface EditorSnapshot {
  mode: string
  source: boolean
  livePreview: boolean | null
  footerWidgets: number
  rows: number
}

interface Report {
  mobile?: boolean
  leaving?: EditorSnapshot
  other?: EditorSnapshot
  reopened?: EditorSnapshot
  back?: Back
  error?: string
}

const script = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const frame = () => new Promise((r) => requestAnimationFrame(r))
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
  const groupPath = folder + '/Sample place group.md'
  const otherPath = folder + '/Sample other note.md'
  const taskPath = (i) => folder + '/Tasks/Sample task ' + String(i).padStart(2, '0') + '.md'
  const report = { mobile: !!app.isMobile }
  const defaults = {
    mode: app.vault.getConfig('defaultViewMode'),
    livePreview: app.vault.getConfig('livePreview'),
  }
  const leaf = app.workspace.getLeaf(false)
  const scroller = () => leaf.view.containerEl.querySelector('.cm-scroller')
  const rows = () => [...leaf.view.containerEl.querySelectorAll('.abele-todo-list .abele-task-view')]
  const editorSnapshot = () => {
    const state = leaf.view.getState()
    const cm = leaf.view.editor?.cm
    const field = window.__abeleTest.editorLivePreviewField
    return {
      mode: leaf.view.getMode(),
      source: state.source,
      livePreview: cm && field ? cm.state.field(field, false) : null,
      footerWidgets: leaf.view.containerEl.querySelectorAll('.abele-footer-widget-container').length,
      rows: rows().length,
    }
  }
  /** Rows by their task's name, which stays when the list is drawn again. */
  const nameOf = (row) => /Sample task \\d+/.exec(row?.textContent ?? '')?.[0] ?? null
  const names = {}
  const rowNamed = (i) => rows().find((r) => nameOf(r) === names[i])
  const topOf = (el) => Math.round(el.getBoundingClientRect().top - scroller().getBoundingClientRect().top)

  try {
    // Exercise navigation even when newly opened notes default to reading view.
    app.vault.setConfig('defaultViewMode', 'preview')
    app.vault.setConfig('livePreview', false)
    const old = app.vault.getAbstractFileByPath(folder)
    if (old) await app.vault.delete(old, true)
    await app.vault.createFolder(folder)
    await app.vault.createFolder(folder + '/Tasks')
    const intro = Array.from({ length: 30 }, (_, i) => 'Paragraph ' + (i + 1) + ' of the sample group note.').join('\\n\\n')
    await app.vault.create(groupPath, intro + '\\n')
    await app.vault.create(otherPath, 'A short note.\\n')
    for (let i = 1; i <= ${TASKS}; i++) {
      await app.vault.create(
        taskPath(i),
        '---\\ntype: task\\ncreated: 2026-01-01\\ngroups:\\n  - "[[Sample place group]]"\\n---\\n' +
          'Sample task ' + String(i).padStart(2, '0') + '\\n\\nThe description of sample task ' + i + '.\\n'
      )
    }
    await until(() => {
      const links = app.metadataCache.resolvedLinks[taskPath(1)]
      return links && Object.keys(links).length
    }, 20000)
    await wait(1500)

    await leaf.setViewState({ type: 'markdown', state: { file: groupPath, mode: 'source', source: false }, active: true })
    await wait(1500)
    // Down the list until the row is drawn, pages being added as their ends come into view.
    const drawn = await until(() => {
      const s = scroller()
      s.scrollTop = s.scrollHeight
      return rows().length > ${ROW} + 5
    }, 30000)
    if (!drawn) throw new Error('the list never reached the row')
    // A row draws its title once it has been on screen.
    for (const i of [${OPENED}, ${ROW}]) {
      rows()[i].scrollIntoView({ block: 'center' })
      if (!(await until(() => nameOf(rows()[i]), 5000))) throw new Error('row ' + i + ' never drew its title')
      names[i] = nameOf(rows()[i])
    }
    rowNamed(${OPENED}).scrollIntoView({ block: 'center' })
    await wait(800)
    const opener = [...rowNamed(${OPENED}).children].find((c) => c.classList.contains('abele-obsidian-icon'))
    opener.click()
    if (!(await until(() => rowNamed(${OPENED})?.querySelector('.abele-task-view__description'), 5000)))
      throw new Error('the task never opened')
    await wait(600)
    // The row a little below the top of the window, then time for the place to be saved.
    rowNamed(${ROW}).scrollIntoView({ block: 'start' })
    scroller().scrollTop -= 120
    await wait(2500)
    const before = topOf(rowNamed(${ROW}))
    const rowsBefore = rows().length
    report.leaving = editorSnapshot()

    await leaf.openFile(app.vault.getAbstractFileByPath(otherPath), { active: true })
    await wait(800)
    report.other = editorSnapshot()
    await leaf.openFile(app.vault.getAbstractFileByPath(groupPath), { active: true })
    const tops = []
    const rowTops = []
    for (let i = 0; i < 240; i++) {
      await frame()
      const s = scroller()
      tops.push(Math.round(s ? s.scrollTop : -1))
      const r = rowNamed(${ROW})
      rowTops.push(r ? topOf(r) : null)
    }
    await wait(500)
    const row = rowNamed(${ROW})
    const after = row ? topOf(row) : null
    const rowsAfter = rows().length
    report.reopened = editorSnapshot()
    // A row draws its text once it is on screen: the opened one is brought into view to look.
    rowNamed(${OPENED})?.scrollIntoView({ block: 'center' })
    const opened = !!(await until(() => rowNamed(${OPENED})?.querySelector('.abele-task-view__description'), 3000))
    report.back = { before, after, rowsBefore, rowsAfter, opened, tops, rowTops }
  } catch (e) {
    report.error = String((e && e.stack) || e)
  } finally {
    app.vault.setConfig('defaultViewMode', defaults.mode)
    app.vault.setConfig('livePreview', defaults.livePreview)
    const f = app.vault.getAbstractFileByPath(folder)
    for (const l of app.workspace.getLeavesOfType('markdown'))
      if (l.view.file?.path.startsWith(folder)) l.detach()
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

/** How many times the scroller changed direction: a note that shakes turns back and forth. */
const turns = (tops: number[]): number => {
  let n = 0
  let dir = 0
  for (let i = 1; i < tops.length; i++) {
    const d = Math.sign(tops[i] - tops[i - 1])
    if (d && dir && d !== dir) n++
    if (d) dir = d
  }
  return n
}

const suite = (title: string, prepare: () => Promise<void>, restore: () => Promise<void>) =>
  describe.skipIf(!available)(title, () => {
    let report: Report = {}

    beforeAll(async () => {
      await prepare()
      report = JSON.parse(await evalLong(script, 240_000)) as Report
      const b = report.back
      const moves = b?.tops.filter((t, i) => i === 0 || t !== b.tops[i - 1])
      console.info(
        `\n  ${JSON.stringify({ ...b, tops: moves, rowTops: undefined, leaving: report.leaving, other: report.other, reopened: report.reopened, error: report.error })}\n`
      )
    }, 400_000)

    afterAll(restore, 180_000)

    const trace = () => JSON.stringify({ ...report.back, tops: report.back?.tops.join(' ') })

    it('runs to the end', () => {
      expect(report.error ?? '').toBe('')
      expect(report.back).toBeDefined()
    })

    it('the row looked at is back at the same spot', () => {
      const b = report.back!
      expect(b.after, trace()).not.toBeNull()
      expect(Math.abs(b.after - b.before), trace()).toBeLessThanOrEqual(4)
    })

    it('the list is as it was left: its pages drawn and the task still open', () => {
      const b = report.back!
      expect(b.rowsAfter, trace()).toBeGreaterThanOrEqual(b.rowsBefore)
      expect(b.opened, trace()).toBe(true)
    })

    it('nothing shakes on the way: the scroll never turns back, and the row stays once there', () => {
      const b = report.back!
      expect(turns(b.tops), trace()).toBe(0)
      const landed = b.rowTops.findIndex((t) => t !== null && Math.abs(t - b.before) <= 4)
      expect(landed, trace()).toBeGreaterThan(-1)
      for (const t of b.rowTops.slice(landed))
        expect(t !== null && Math.abs(t - b.before) <= 4, trace()).toBe(true)
    })
  })

if (onPhone()) {
  suite(
    'a note left in the list under it comes back there, on the phone',
    async () => {},
    async () => {}
  )
} else {
  suite(
    'a note left in the list under it comes back there, on a desktop',
    async () => {},
    async () => {}
  )

  let size: [number, number] = [0, 0]
  suite(
    'a note left in the list under it comes back there, in the phone layout',
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
