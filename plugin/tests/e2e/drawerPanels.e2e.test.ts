/**
 * Every sidebar panel renders when it is opened into a phone's closed drawer.
 *
 * A panel's component is teleported into the pane the view builds. Aimed at a selector, the
 * teleport looks the pane up in the document at the moment the panel is listed — and a pane
 * opened into a folded drawer on a phone is not in the document yet, so the panel mounted
 * nowhere and the drawer, once slid open, was blank. The finance and accounts panels were
 * found that way; the others shared the same line and the same fault.
 *
 * Each panel is opened here into the right drawer while it is folded, the drawer is then slid
 * open, and the pane has to hold something with a height. Pictures of each go to
 * `/tmp/abele-drawer/`.
 *
 * Requires Obsidian running with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw, evalJson } from './helpers/obsidianCli'

const SHOTS = '/tmp/abele-drawer'
const PHONE = { width: 390, height: 844 }

const PANELS = {
  timeline: 'abele-timeline-sidebar-view',
  todo: 'abele-todo-sidebar-view',
  'AI chat': 'abele-ai-sidebar-view',
  finance: 'abele-finance-sidebar-view',
  accounts: 'abele-accounts-sidebar-view',
  'time tracking': 'abele-time-tracking-sidebar-view',
  'script runs': 'abele-script-runs-view',
} as const

interface Pane {
  /** Elements the panel's component put into the pane. */
  children: number
  /** Height of what it put there. */
  height: number
  shot: string
  error: string
}

type Report = Record<string, Pane>

const evalAsync = <T>(script: string, timeoutMs: number): T => {
  const raw = evalRaw(script, timeoutMs)
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`The probe answered with something other than JSON: ${raw.slice(0, 400)}`)
  }
}

const probeScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const fs = require('fs')
  const win = require('@electron/remote').getCurrentWindow()
  fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
  const panels = ${JSON.stringify(PANELS)}
  const ws = app.workspace
  const report = {}
  for (const [label, type] of Object.entries(panels)) {
    try {
      ws.detachLeavesOfType(type)
      ws.rightSplit.collapse()
      await wait(400)
      const leaf = ws.getRightLeaf(false)
      await leaf.setViewState({ type, active: false })
      await wait(300)
      ws.rightSplit.expand()
      ws.revealLeaf(leaf)
      await wait(1200)
      const widget = leaf.view.containerEl.querySelector('.view-content > div')
      const kids = widget ? [...widget.children] : []
      const height = kids.reduce((h, k) => Math.max(h, k.getBoundingClientRect().height), 0)
      let shot = ${JSON.stringify(SHOTS)} + '/' + label.replace(/ /g, '-') + '.png'
      // The first capture after a reload can fail inside the compositor; the picture is for a
      // person to look at, and a failed one says nothing about the panel.
      try {
        fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG())
      } catch (e) {
        shot = 'no picture: ' + String((e && e.message) || e)
      }
      report[label] = { children: kids.length, height: Math.round(height), shot, error: '' }
    } catch (e) {
      report[label] = { children: 0, height: 0, shot: '', error: String((e && e.message) || e) }
    } finally {
      ws.detachLeavesOfType(type)
    }
  }
  ws.rightSplit.collapse()
  return report
})()`

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

describe.skipIf(!available)('a sidebar opened into a closed phone drawer', () => {
  let report: Report = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    size = windowSize()
    await setWindowSize(PHONE.width, PHONE.height)
    await setMobile(true)
    report = evalAsync<Report>(probeScript, 120_000)
    const lines = Object.entries(report).map(
      ([label, p]) => `  ${label.padEnd(16)} ${p.children} el, ${p.height}px ${p.shot || p.error}`
    )
    console.info(`\n${lines.join('\n')}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    if (size[0]) await setWindowSize(size[0], size[1])
    await setMobile(false)
  }, 120_000)

  it.each(Object.keys(PANELS))('%s renders once the drawer is opened', (label) => {
    const pane = report[label]
    expect(pane?.error ?? 'no report').toBe('')
    expect(pane.children).toBeGreaterThan(0)
    expect(pane.height).toBeGreaterThan(0)
  })
})
