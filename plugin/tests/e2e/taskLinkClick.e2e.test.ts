/**
 * A press on a link in a task's words follows the link and leaves the task alone.
 *
 * A task row opens its task on a press anywhere in it. A link in its name or its description
 * is the one thing in the row that leads somewhere else, and a web link or a tag there opened
 * the task note as well. Only the app can show what a real press does: the row is drawn under a
 * note inside the editor, which acts on a press of its own, and in the timeline.
 *
 * A task with a note link, a web link and a tag in its name and in its description, dated today
 * so the timeline shows it, in the group of a note so the list under that note does too. In each
 * place, folded and then unfolded, a real press — the mouse on a desktop, a finger on a phone —
 * on each link and on the words beside them:
 *
 * - the note link opens its note, and the task's note is not opened;
 * - the web link is left for the app to follow, and the task's note is not opened;
 * - the tag does not open the task's note;
 * - none of them folds or unfolds the row;
 * - the words outside a link open the task, as before.
 *
 * The web link goes nowhere: the press is recorded at the window and then held back, so nothing
 * leaves the machine. On a desktop window and under `emulateMobile`; with `E2E_TARGET=phone` on
 * the phone. Writes its own folder of notes and removes it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  enterPhone,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')

const FOLDER = 'Task link click probe'

interface Press {
  /** The task's own note was opened. */
  task: boolean
  /** The note the link names was opened. */
  note: boolean
  /**
   * How many times the web link was followed: its press reached the window with nothing holding
   * it back, or the app opened its address itself (as the editor does with a link in it).
   */
  web: number
  /** The row's description was shown before the press. */
  before: boolean
  /** The description appeared or went while the row was on the page. */
  toggled: boolean
}

type Place = Record<string, Press | undefined>

interface Report {
  mobile?: boolean
  footer?: Place
  timeline?: Place
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
  const groupPath = folder + '/Sample link group.md'
  const taskPath = folder + '/Tasks/Sample linked task.md'
  const targetPath = folder + '/Sample link target.md'
  const otherPath = folder + '/Sample other target.md'
  const report = { mobile: !!app.isMobile }

  // A real press where the point is: a finger on a phone, the mouse through DevTools elsewhere.
  const cdp = window.__e2eHost ? null : require('@electron/remote').getCurrentWebContents().debugger
  const press = async ({ x, y }) => {
    x = Math.round(x); y = Math.round(y)
    if (window.__e2eHost) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { return await window.__e2eHost.tap(x, y) } catch (e) {
          if (!/connection was lost|no answer from the host/.test(String(e && e.message))) throw e
          await wait(1500)
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
  const middle = (r) => ({ x: r.left + Math.min(r.width / 2, 12), y: r.top + r.height / 2 })
  const pointOf = (el) => middle(el.getClientRects()[0] ?? el.getBoundingClientRect())
  // The first words of a part, before its first link.
  const wordsOf = (part) => {
    const text = [...part.querySelector('p').childNodes].find((n) => n.nodeType === 3 && n.textContent.trim())
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, Math.min(6, text.length))
    return middle(range.getBoundingClientRect())
  }

  // Every press on a link is seen at the window after the row has had it, and then held back:
  // whether the app would have followed it is recorded, and nothing is opened outside.
  let web = 0
  const opened = (url) => { if (String(url).startsWith('https://example.invalid/')) web++ }
  const atWindow = (e) => {
    const a = e.target.closest && e.target.closest('a')
    if (!a) return
    if (a.classList.contains('external-link') && !e.defaultPrevented) web++
    e.preventDefault()
  }
  window.addEventListener('click', atWindow)
  const realOpen = window.open
  window.open = (url) => { opened(url); return null }
  const shell = window.__e2eHost ? null : require('electron').shell
  const realExternal = shell?.openExternal
  if (shell) shell.openExternal = async (url) => { opened(url) }

  const shows = (path) => app.workspace.getLeavesOfType('markdown').some((l) => l.view.file?.path === path)
  const closeOurs = () => {
    for (const l of app.workspace.getLeavesOfType('markdown'))
      if (l.view.file?.path?.startsWith(folder + '/')) l.detach()
    for (const l of app.workspace.getLeavesOfType('abele-timeline-sidebar-view')) if (l.__linkProbe) l.detach()
  }

  const places = {
    footer: async () => {
      const leaf = app.workspace.getLeaf('tab')
      await leaf.setViewState({ type: 'markdown', state: { file: groupPath, mode: 'source', source: false }, active: true })
      const scroller = leaf.view.containerEl.querySelector('.cm-scroller')
      return until(() => {
        if (scroller) scroller.scrollTop = scroller.scrollHeight
        return leaf.view.containerEl.querySelector('.abele-footer-view [data-abele-anchor="task:' + taskPath + '"]')
      }, 20000)
    },
    timeline: async () => {
      const leaf = app.workspace.getLeaf('tab')
      leaf.__linkProbe = true
      await leaf.setViewState({ type: 'abele-timeline-sidebar-view', active: true })
      app.workspace.setActiveLeaf(leaf, { focus: true })
      return until(() => leaf.view.containerEl.querySelector('.abele-timeline [data-abele-anchor="task:' + taskPath + '"]'), 20000)
    },
  }

  // Opens the place afresh, brings the row into view drawn, folded or unfolded as asked.
  const showRow = async (place, unfolded) => {
    closeOurs()
    await wait(300)
    const row = await places[place]()
    if (!row) throw new Error(place + ': the task row never appeared')
    row.scrollIntoView({ block: 'center' })
    if (!(await until(() => row.querySelector('.abele-task-view__title a.external-link'), 10000)))
      throw new Error(place + ': the row never drew its name')
    const open = () => !!row.querySelector('.abele-task-view__description a.external-link')
    // The editor goes on measuring and scrolling for a moment after the row is brought into
    // view, and a press made meanwhile lands beside the chevron; it is made again only when
    // nothing has happened.
    for (let attempt = 0; attempt < 3 && open() !== unfolded; attempt++) {
      row.scrollIntoView({ block: 'center' })
      await wait(1200)
      await press(pointOf(row.querySelector('.abele-entry-row__more')))
      await until(() => open() === unfolded, 3000)
    }
    if (open() !== unfolded) throw new Error(place + ': the row did not ' + (unfolded ? 'unfold' : 'fold'))
    row.scrollIntoView({ block: 'center' })
    await wait(800)
    return row
  }

  // What was pressed before a failure is kept beside it.
  const run = async (place, out) => {
    for (const unfolded of [false, true]) {
      const part = unfolded ? '.abele-task-view__description' : '.abele-task-view__title'
      const state = unfolded ? 'unfolded' : 'folded'
      const picks = {
        note: (p) => pointOf(p.querySelector('a.internal-link')),
        web: (p) => pointOf(p.querySelector('a.external-link')),
        tag: (p) => pointOf(p.querySelector('a.tag')),
        words: (p) => wordsOf(p),
      }
      for (const [kind, pick] of Object.entries(picks)) {
        const row = await showRow(place, unfolded)
        const before = !!row.querySelector('.abele-task-view__description')
        // A link to a note may take the row's page away with it, so a fold is watched for while
        // the row is there rather than looked for afterwards.
        let toggled = false
        const detail = (n) => n.nodeType === 1 && (n.matches('.abele-entry-row__detail') || !!n.querySelector('.abele-entry-row__detail'))
        const watch = new MutationObserver((list) => {
          for (const m of list) if ([...m.addedNodes, ...m.removedNodes].some(detail)) toggled = true
        })
        watch.observe(row, { childList: true, subtree: true })
        web = 0
        await press(pick(row.querySelector(part)))
        await wait(1500)
        watch.disconnect()
        out[state + ' ' + kind] = {
          task: shows(taskPath),
          note: shows(unfolded ? otherPath : targetPath),
          web,
          before,
          toggled,
        }
      }
    }
    return out
  }

  try {
    const old = app.vault.getAbstractFileByPath(folder)
    if (old) await app.vault.delete(old, true)
    await app.vault.createFolder(folder)
    await app.vault.createFolder(folder + '/Tasks')
    await app.vault.create(groupPath, 'A sample group note.\\n')
    await app.vault.create(targetPath, 'The note the name links to.\\n')
    await app.vault.create(otherPath, 'The note the description links to.\\n')
    await app.vault.create(
      taskPath,
      '---\\ntype: task\\ncreated: 2026-01-01\\ndate: ' + window.moment().format('YYYY-MM-DD') +
        '\\ngroups:\\n  - "[[Sample link group]]"\\n---\\n' +
        'Sample words [[Sample link target]] and [a site](https://example.invalid/sample) and #sample-tag\\n\\n' +
        'Described here [[Sample other target]] and [a page](https://example.invalid/page) and #other-tag\\n'
    )
    await until(() => {
      const links = app.metadataCache.resolvedLinks[taskPath]
      return links && Object.keys(links).length >= 3
    }, 20000)
    await wait(1500)
    for (const place of ['footer', 'timeline']) {
      report[place] = {}
      try { await run(place, report[place]) } catch (e) { report[place].error = String((e && e.message) || e) }
    }
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    window.removeEventListener('click', atWindow)
    window.open = realOpen
    if (shell) shell.openExternal = realExternal
    closeOurs()
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

const suite = (title: string, prepare: () => Promise<void>, restore: () => Promise<void>) =>
  describe.skipIf(!available)(title, () => {
    let report: Report = {}

    beforeAll(async () => {
      await prepare()
      report = JSON.parse(await evalLong(script, 300_000)) as Report
      console.info(`\n  ${JSON.stringify(report)}\n`)
    }, 400_000)

    afterAll(restore, 180_000)

    it('runs to the end', () => {
      expect(report.error ?? '').toBe('')
      expect(report.footer?.error ?? '').toBe('')
      expect(report.timeline?.error ?? '').toBe('')
    })

    for (const place of ['footer', 'timeline'] as const) {
      for (const state of ['folded', 'unfolded'] as const) {
        const press = (kind: string) => {
          const p = report[place]?.[`${state} ${kind}`]
          expect(p, `${place} ${state} ${kind} was not pressed`).toBeDefined()
          return p!
        }
        const unmoved = (p: Press) => {
          expect(p.before).toBe(state === 'unfolded')
          expect(p.toggled).toBe(false)
        }

        it(`${place}, ${state}: a note link opens its note, not the task`, () => {
          const p = press('note')
          expect(p.note).toBe(true)
          expect(p.task).toBe(false)
          unmoved(p)
        })

        it(`${place}, ${state}: a web link is followed, not the task`, () => {
          const p = press('web')
          expect(p.web).toBe(1)
          expect(p.task).toBe(false)
          unmoved(p)
        })

        it(`${place}, ${state}: a tag does not open the task`, () => {
          const p = press('tag')
          expect(p.task).toBe(false)
          unmoved(p)
        })

        it(`${place}, ${state}: the words beside the links open the task`, () => {
          expect(press('words').task).toBe(true)
        })
      }
    }
  })

if (onPhone()) {
  suite(
    'a link in a task row, on the phone',
    async () => {},
    async () => {}
  )
} else {
  suite(
    'a link in a task row, on a desktop',
    async () => {},
    async () => {}
  )

  let size: [number, number] = [0, 0]
  suite(
    'a link in a task row, in the phone layout',
    async () => {
      size = windowSize()
      await enterPhone(390, 844)
    },
    async () => {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reloadApp('app.emulateMobile(false)')
    }
  )
}
