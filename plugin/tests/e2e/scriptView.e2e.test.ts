/**
 * A script opens a view, a press changes it, the state survives the tab being closed and
 * restored. Only this tier has a workspace to restore from.
 *
 * Every step here is a promise — a leaf opening, a script running again — and `obsidian
 * eval` cannot await one. Each probe therefore parks its result on
 * `window.__abeleTest.viewProbe` and the test polls for it, the way the modal test does.
 *
 * Requires Obsidian running with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalJson, evalRaw } from './helpers/obsidianCli'

const SCRIPT = `// @name E2E Counter
// @description A view that counts presses
const v = view({ title: 'E2E Counter', icon: 'hash' })
v.state.count ??= 0
const label = new Badge(String(v.state.count))
const plus = new Button({ text: 'Plus', id: 'plus', onClick: () => { v.state.count++; label.text = String(v.state.count) } })
v.style('.counter { border: 1px solid var(--interactive-accent); }')
v.body = [new Html({ html: '<div class="counter"><div class="slot"></div></div>', children: { '.slot': new Row([label, plus]) } })]
await v.open()
`

type Probe<T> = { ok: true; value: T } | { ok: false; error: string }

/** The tab and title bar as drawn: a fresh leaf is titled before its view exists. */
interface Header {
  title: string
  icon: string
  bar: string
}
interface Opened {
  live: boolean
  badge: string
  scoped: boolean
  header: Header | null
}
interface Restored {
  badge: string
  title: string
  header: Header
  tabs: number
}

/** Waits, inside the app, for a live script view; `null` if none appears in time. */
const WAIT_FOR_LIVE = `async function waitForLive() {
  for (let i = 0; i < 100; i++) {
    const el = document.querySelector('.abele-script-view_live')
    if (el) return el
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}
/** What the tab and the title bar actually show — not what getDisplayText() would say. */
function headerOf(leaf) {
  return {
    title: leaf.tabHeaderInnerTitleEl?.textContent,
    icon: leaf.tabHeaderInnerIconEl?.querySelector('svg')?.getAttribute('class'),
    bar: leaf.view.containerEl.querySelector('.view-header-title')?.textContent,
  }
}`

/**
 * Starts `body` in the app and polls for what it parks on `viewProbe`. The poll is bounded:
 * a probe that never finishes fails the test instead of hanging the run.
 */
async function probe<T>(body: string): Promise<T> {
  const started = evalRaw(`(() => {
    const t = window.__abeleTest
    t.viewProbe = null
    ;(async () => {
      ${WAIT_FOR_LIVE}
      try {
        t.viewProbe = { ok: true, value: await (async () => { ${body} })() }
      } catch (e) {
        t.viewProbe = { ok: false, error: String(e && e.stack || e) }
      }
    })()
    return 'started'
  })()`)
  if (!started.includes('started')) throw new Error(`Probe did not start: ${started}`)

  let result: Probe<T> | null = null
  for (let attempt = 0; attempt < 60 && !result; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    result = evalJson<Probe<T> | null>('window.__abeleTest.viewProbe ?? null')
  }
  if (!result) throw new Error('Probe did not finish in time')
  if (!result.ok) throw new Error(`Probe failed in the app: ${result.error}`)
  return result.value
}

const setup = `
  const t = window.__abeleTest
  const folder = t.AbeleConfig.getInstance().ai.scriptsFolder
  const path = folder + '/E2E Counter.js'
  if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder)
  const existing = app.vault.getAbstractFileByPath(path)
  if (existing) await app.vault.delete(existing)
  await app.vault.create(path, ${JSON.stringify(SCRIPT)})
  await t.ScriptService.getInstance().discover()
  return path
`

const openView = `
  const t = window.__abeleTest
  const s = t.ScriptService.getInstance().getAll().find((x) => x.meta.name === 'E2E Counter')
  if (!s) throw new Error('E2E Counter was not discovered')
  await t.ScriptService.getInstance().execute(s.path, {}, { source: 'command' })
  const el = await waitForLive()
  const leaf = app.workspace.getLeavesOfType('abele-script-view')[0]
  return {
    live: Boolean(el),
    badge: el?.querySelector('.abele-badge')?.textContent,
    scoped: Boolean(el?.querySelector('style')?.textContent.includes('.abele-script-view[data-id=')),
    header: leaf ? headerOf(leaf) : null,
  }
`

const press = `
  const el = document.querySelector('.abele-script-view_live')
  el.querySelector('button').click()
  await new Promise((r) => setTimeout(r, 100))
  const leaf = app.workspace.getLeavesOfType('abele-script-view')[0]
  return { badge: el.querySelector('.abele-badge').textContent, saved: leaf.view.getState() }
`

const closeAndRestore = `
  const leaf = app.workspace.getLeavesOfType('abele-script-view')[0]
  const saved = leaf.view.getState()
  leaf.detach()
  await new Promise((r) => setTimeout(r, 200))
  const fresh = app.workspace.getLeaf('tab')
  await fresh.setViewState({ type: 'abele-script-view', active: true, state: saved })
  const el = await waitForLive()
  return {
    badge: el?.querySelector('.abele-badge')?.textContent,
    title: fresh.view.getDisplayText(),
    header: headerOf(fresh),
    tabs: app.workspace.getLeavesOfType('abele-script-view').length,
  }
`

const cleanup = `
  for (const leaf of app.workspace.getLeavesOfType('abele-script-view')) leaf.detach()
  const folder = window.__abeleTest.AbeleConfig.getInstance().ai.scriptsFolder
  const f = app.vault.getAbstractFileByPath(folder + '/E2E Counter.js')
  if (f) await app.vault.delete(f)
  window.__abeleTest.viewProbe = null
  return true
`

describe('a script view in the running app', () => {
  beforeAll(async () => {
    if (!isObsidianRunning() || !hasTestApi()) {
      throw new Error('Obsidian with the development build is not running')
    }
    await probe(setup)
  }, 60_000)

  afterAll(async () => {
    await probe(cleanup)
  }, 60_000)

  it('opens live, with scoped css, and counts a press', async () => {
    const opened = await probe<Opened>(openView)
    expect(opened).toEqual({
      live: true,
      badge: '0',
      scoped: true,
      header: { title: 'E2E Counter', icon: 'svg-icon lucide-hash', bar: 'E2E Counter' },
    })

    const pressed = await probe<{
      badge: string
      saved: { script: string; state: { count: number } }
    }>(press)
    expect(pressed.badge).toBe('1')
    expect(pressed.saved.script).toBe('E2E Counter')
    expect(pressed.saved.state.count).toBe(1)
  }, 60_000)

  it('comes back with its state after the tab is closed and restored', async () => {
    const back = await probe<Restored>(closeAndRestore)
    expect(back).toEqual({
      badge: '1',
      title: 'E2E Counter',
      header: { title: 'E2E Counter', icon: 'svg-icon lucide-hash', bar: 'E2E Counter' },
      tabs: 1,
    })
  }, 60_000)
})
