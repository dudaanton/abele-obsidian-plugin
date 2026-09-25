/**
 * A new chat opens with the cursor in its composer, in the running app, whichever way it was
 * asked for.
 *
 * The unit tier proves each of those asks and that the chat answers; what only the app can show
 * is that the answer lands — that the field is on screen and takes the cursor once the panel's
 * leaf has been made and the chat has mounted into it. Before each step the cursor is put in a
 * field of the probe's own, so a composer that merely kept it from the step before fails.
 *
 * One `eval` runs the whole sequence. Tabs it opens are closed again, and the panel is left
 * open or closed as it was found. Requires Obsidian running on a vault with the development
 * build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw, activeVaultName } from './helpers/obsidianCli'

type Report = Record<string, boolean | string>

const script = `(async () => {
  const T = window.__abeleTest
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const svc = T.ChatService.getInstance()
  const VIEW = 'abele-ai-sidebar-view'
  const report = {}
  const tabsBefore = [...svc.tabOrder.value]
  const hadPanel = app.workspace.getLeavesOfType(VIEW).length > 0

  const decoy = document.createElement('input')
  decoy.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;opacity:0'
  document.body.appendChild(decoy)
  const elsewhere = () => decoy.focus()
  const composerFocused = () =>
    !!document.activeElement?.matches?.('.abele-ai-chat .abele-chat-input__textarea')
  const focusedWithin = async (ms = 3000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (composerFocused()) return true
      await wait(50)
    }
    return false
  }
  const panelChat = () =>
    app.workspace.getLeavesOfType(VIEW)[0]?.view.containerEl.querySelector('.abele-ai-chat')

  try {
    // ── the command, with no panel open: the leaf is made and the chat mounts into it ──
    for (const leaf of app.workspace.getLeavesOfType(VIEW)) leaf.detach()
    await svc.openBlankChat()
    elsewhere()
    app.commands.executeCommandById('abele:show-ai-sidebar')
    report.commandFreshPanel = await focusedWithin()

    // ── the command again, over the blank chat already on screen ──
    elsewhere()
    app.commands.executeCommandById('abele:show-ai-sidebar')
    report.commandOpenPanel = await focusedWithin()

    // ── the + in the tab bar ──
    elsewhere()
    const tabBefore = svc.activeTabId.value
    panelChat().querySelector('.abele-chat-tabs__add').click()
    report.plusNewTab = svc.activeTabId.value !== tabBefore
    report.plusFocused = await focusedWithin()

    // ── "Start a new chat" in the header ──
    elsewhere()
    panelChat().querySelector('[aria-label="Start a new chat"]').click()
    report.newChatFocused = await focusedWithin()
  } catch (e) {
    report.error = String(e && e.stack || e)
  } finally {
    decoy.remove()
    for (const id of [...svc.tabOrder.value]) {
      if (!tabsBefore.includes(id)) await svc.closeTab(id)
    }
    if (!hadPanel) for (const leaf of app.workspace.getLeavesOfType(VIEW)) leaf.detach()
  }
  return report
})()`

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('a new chat opens with the cursor in its composer', () => {
  let report: Report = {}

  beforeAll(() => {
    const raw = evalRaw(script, 45_000)
    report = JSON.parse(raw) as Report
    console.info(`\n  vault ${activeVaultName()}\n  ${JSON.stringify(report, null, 2)}\n`)
  }, 60_000)

  it('runs to the end', () => {
    expect(report.error ?? '').toBe('')
  })

  it('from the command, when the panel was closed', () => {
    expect(report.commandFreshPanel).toBe(true)
  })

  it('from the command, over the blank chat already open', () => {
    expect(report.commandOpenPanel).toBe(true)
  })

  it('from the + in the tab bar', () => {
    expect(report.plusNewTab).toBe(true)
    expect(report.plusFocused).toBe(true)
  })

  it('from "Start a new chat"', () => {
    expect(report.newChatFocused).toBe(true)
  })
})
