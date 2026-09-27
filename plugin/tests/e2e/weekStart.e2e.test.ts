/**
 * "Week starts on Monday" in the running app, across a plugin reload.
 *
 * The store could be built while the settings were still loading, and it copied the week start
 * out of them then — before there was one. The sidebar calendar started its weeks on Sunday with
 * the setting on. Here the setting is written to `data.json`, the plugin is reloaded, and the
 * timeline sidebar's calendar is read for its first weekday. Both ways round, and the vault's
 * own value is put back afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning, reloadPlugin } from './helpers/obsidianCli'

const available = isObsidianRunning() && hasTestApi()
const evalAsync = <T>(script: string, timeoutMs = 60_000): T =>
  JSON.parse(evalRaw(script, timeoutMs)) as T

const PLUGIN = `app.plugins.plugins.abele`

function setWeekStart(monday: boolean | null): void {
  evalAsync(`(async () => {
    const p = ${PLUGIN}
    const data = (await p.loadData()) ?? {}
    if (${monday === null}) delete data.weekStartsOnMonday
    else data.weekStartsOnMonday = ${monday}
    await p.saveData(data)
    return JSON.stringify(true)
  })()`)
}

/** The first weekday of the sidebar calendar after a fresh load of the plugin. */
function firstWeekdayAfterReload(): string {
  reloadPlugin()
  return evalAsync(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const until = async (fn, ms) => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) { const v = fn(); if (v) return v; await wait(100) }
      return null
    }
    await until(() => ${PLUGIN} && window.__abeleTest, 30000)
    // Opened for the look and closed again, the sidebar as it was: an open one narrows the
    // main pane for every test that runs in this window after this one.
    const type = 'abele-timeline-sidebar-view'
    const collapsed = app.workspace.rightSplit.collapsed
    let leaf = app.workspace.getLeavesOfType(type)[0]
    const made = !leaf
    if (made) {
      leaf = app.workspace.getRightLeaf(false)
      await leaf.setViewState({ type, active: true })
    }
    await app.workspace.revealLeaf(leaf)
    const day = await until(() => leaf.view.containerEl.querySelector('.abele-calendar__weekday'), 20000)
    const first = day ? day.textContent.trim() : ''
    if (made) leaf.detach()
    if (collapsed) app.workspace.rightSplit.collapse()
    return JSON.stringify(first)
  })()`)
}

describe.skipIf(!available)('the week start after a plugin reload', () => {
  let original: boolean | null = null

  beforeAll(() => {
    original = evalAsync<boolean | null>(`(async () => {
      const data = (await ${PLUGIN}.loadData()) ?? {}
      return JSON.stringify(typeof data.weekStartsOnMonday === 'boolean' ? data.weekStartsOnMonday : null)
    })()`)
  })

  afterAll(() => {
    setWeekStart(original)
    reloadPlugin()
  })

  it('starts the sidebar calendar on Monday with the setting on', () => {
    setWeekStart(true)
    expect(firstWeekdayAfterReload()).toBe('Mo')
  })

  it('starts it on Sunday with the setting off', () => {
    setWeekStart(false)
    expect(firstWeekdayAfterReload()).toBe('Su')
  })
})
