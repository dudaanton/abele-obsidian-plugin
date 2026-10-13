/**
 * The list panels in the phone layout, against the phone's own bars: every panel's header below
 * the status bar and the native view header, and the last row of a long list revealable above the
 * bottom toolbar. Both run in one phone session for the file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { enterPhone, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('list-panel-bottom')

/** Synthetic events and an empty task projection; no notes, settings or credentials are written. */
function panelBottomScript(shotPath: string): string {
  return `(async () => {
    const api = window.__abeleTest
    const store = api.GlobalStore.getInstance()
    const service = api.calendars()
    const ws = app.workspace
    const previous = { settings: service.deps.settings, events: service.state.events,
      tasks: store.tasksList.value, leaf: ws.activeLeaf, right: ws.rightSplit.collapsed,
      left: ws.leftSplit.collapsed }
    let leaf
    const frame = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('window is not drawing')), 5000)
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve() }))
    })
    const until = async (read) => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) { const found = read(); if (found) return found; await new Promise(r => setTimeout(r, 50)) }
      throw Error('synthetic list did not render')
    }
    try {
      const feed = { id: 'sample-bottom-feed', name: 'Sample calendar', color: 'purple',
        enabled: true, source: 'ics', keyId: '', server: '', username: '', calendarUrl: '' }
      const today = new Date(); today.setHours(0, 0, 0, 0)
      service.deps.settings = () => ({ refreshMinutes: 30, feeds: [feed] })
      service.state.events = { [feed.id]: Array.from({ length: 14 }, (_, i) => ({
        id: 'sample-bottom-' + i, uid: 'sample-bottom-' + i, feedId: feed.id,
        title: 'Sample final event ' + i, allDay: false,
        start: today.getTime() + (8 + i) * 3600000,
        end: today.getTime() + (9 + i) * 3600000,
        location: 'Sample room', description: '', url: ''
      })) }
      store.tasksList.value = { tasks: new Map() }
      service.state.version++
      leaf = ws.getLeaf('tab')
      await leaf.setViewState({ type: 'abele-timeline-sidebar-view', active: true })
      await ws.revealLeaf(leaf)
      const panel = await until(() => leaf.view.containerEl.querySelector('.abele-timeline-sidebar'))
      const last = await until(() => [...panel.querySelectorAll('.abele-calendar-event__title')]
        .find(el => el.textContent === 'Sample final event 13'))
      await frame()
      panel.scrollTop = panel.scrollHeight
      await frame()
      const edge = panel.getBoundingClientRect()
      const obstacles = [...document.querySelectorAll('.mobile-navbar, .mobile-toolbar')]
        .map(el => el.getBoundingClientRect())
        .filter(r => r.width > 0 && r.height > 0 && r.top > edge.top && r.top < edge.bottom)
      const rect = last.getBoundingClientRect()
      const result = { lastTop: rect.top, lastBottom: rect.bottom,
        panelTop: edge.top, panelBottom: edge.bottom,
        occlusionTop: Math.min(edge.bottom, ...obstacles.map(r => r.top)),
        scrollTop: panel.scrollTop, clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight,
        bottomSpacing: getComputedStyle(panel).getPropertyValue('--view-bottom-spacing'),
        paddingBottom: getComputedStyle(panel).paddingBottom }
      if (window.__e2eHost) await window.__e2eHost.shot(${JSON.stringify(shotPath)})
      else {
        const fs = require('fs'); fs.mkdirSync(${JSON.stringify(shots)}, { recursive: true })
        const image = await require('@electron/remote').getCurrentWebContents().capturePage()
        fs.writeFileSync(${JSON.stringify(shotPath)}, image.toPNG())
      }
      return result
    } finally {
      service.deps.settings = previous.settings
      service.state.events = previous.events
      store.tasksList.value = previous.tasks
      service.state.version++
      leaf?.detach()
      if (previous.leaf) ws.setActiveLeaf(previous.leaf, { focus: true })
      if (previous.right) ws.rightSplit.collapse(); else ws.rightSplit.expand()
      if (previous.left) ws.leftSplit.collapse(); else ws.leftSplit.expand()
    }
  })()`
}

describe('list panels below and above native phone chrome', () => {
  let size: number[] | undefined
  beforeAll(async () => {
    if (onPhone()) return
    size = JSON.parse(
      evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
    )
    await enterPhone(390, 844)
  }, 180_000)
  afterAll(async () => {
    if (!size) return
    // Leaving the phone puts the desktop size recorded on the way in back.
    await reloadApp('app.emulateMobile(false)')
    evalRaw(
      `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]}); 'restored'`
    )
  }, 180_000)

  it('keeps every list panel below the status bar and native view header', async () => {
    const result = JSON.parse(
      await evalLong(`(async () => {
      const previous = app.workspace.activeLeaf
      const leaves = []
      const rows = []
      const frame = () => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('window is not drawing')), 5000)
        requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve() }))
      })
      try {
        for (const [type, selector] of [
          ['abele-time-tracking-sidebar-view', '.abele-time-tracking-sidebar__header'],
          ['abele-todo-sidebar-view', '.abele-todo-list__header'],
          ['abele-finance-sidebar-view', '.abele-finance-sidebar__header'],
          ['abele-accounts-sidebar-view', '.abele-accounts-sidebar__header']
        ]) {
          const leaf = app.workspace.getLeaf('tab'); leaves.push(leaf)
          await leaf.setViewState({ type, active: true }); await app.workspace.revealLeaf(leaf)
          let header
          const deadline = Date.now() + 15000
          while (Date.now() < deadline) {
            header = leaf.view.containerEl.querySelector(selector)
            if (header?.getBoundingClientRect().height > 0) break
            await new Promise(r => setTimeout(r, 50))
          }
          if (!header?.getBoundingClientRect().height) throw Error('list header did not render: ' + type)
          await frame()
          const panel = header.closest('.abele-sidebar-panel')
          const style = getComputedStyle(panel)
          const safe = parseFloat(style.getPropertyValue('--safe-area-inset-top')) || 0
          const nativeHeight = parseFloat(style.getPropertyValue('--view-header-height')) || 0
          const native = leaf.view.containerEl.querySelector('.view-header')?.getBoundingClientRect().bottom || 0
          rows.push({ type, top: header.getBoundingClientRect().top, nativeBottom: Math.max(native, safe + nativeHeight) })
        }
        return rows
      } finally {
        for (const leaf of leaves) leaf.detach()
        if (previous) app.workspace.setActiveLeaf(previous, { focus: true })
      }
    })()`)
    )
    console.info(JSON.stringify(result))
    expect(result).toHaveLength(4)
    for (const row of result) expect(row.top, row.type).toBeGreaterThanOrEqual(row.nativeBottom)
  })

  it('can reveal the last event on a phone without hiding it behind the toolbar', async () => {
    const result = JSON.parse(await evalLong(panelBottomScript(`${shots}/bottom.png`)))
    console.info(JSON.stringify(result))
    expect(result.lastTop).toBeGreaterThanOrEqual(result.panelTop)
    expect(result.lastBottom).toBeLessThanOrEqual(result.occlusionTop + 1)
  })
})
