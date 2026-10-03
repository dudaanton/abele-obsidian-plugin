import { describe, expect, it } from 'vitest'
import { evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('list-panel-bottom')

/** Synthetic events and an empty task projection; no notes, settings or credentials are written. */
export function panelBottomScript(shotPath: string): string {
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

describe('list panel bottom above native navigation', () => {
  it('can reveal the last event on a phone without hiding it behind the toolbar', async () => {
    let size: number[] | undefined
    try {
      if (!onPhone()) {
        size = JSON.parse(
          evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
        )
        await reloadApp('app.emulateMobile(true)')
        evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844); 'sized'`)
        await reloadApp()
      }
      const result = JSON.parse(await evalLong(panelBottomScript(`${shots}/bottom.png`)))
      console.info(JSON.stringify(result))
      expect(result.lastTop).toBeGreaterThanOrEqual(result.panelTop)
      expect(result.lastBottom).toBeLessThanOrEqual(result.occlusionTop + 1)
    } finally {
      if (size) {
        await reloadApp('app.emulateMobile(false)')
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]}); 'restored'`
        )
        await reloadApp()
      }
    }
  })
})
