import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalLong,
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  runCli,
} from './helpers/obsidianCli'

const available = isObsidianRunning() && hasTestApi()
const KEY = 'abele-changelog-version'

describe.skipIf(!available)('changelog in Obsidian', () => {
  let before: unknown
  beforeAll(() => {
    before = evalJson(`app.loadLocalStorage('${KEY}') ?? null`)
  })
  afterAll(() => {
    evalRaw(
      `app.saveLocalStorage('${KEY}', ${JSON.stringify(before)}); app.setting.close(); for (const leaf of app.workspace.getLeavesOfType('abele-changelog')) leaf.detach()`
    )
  })

  it('opens from the unconditional command, restores ranges, resets and reuses its tab', async () => {
    const result = JSON.parse(
      await evalLong(`(async () => {
      app.commands.executeCommandById('abele:open-changelog')
      await new Promise(r => setTimeout(r, 400))
      const leaf = app.workspace.getLeavesOfType('abele-changelog')[0]
      await leaf.setViewState({ type: 'abele-changelog', state: { range: { from: '1.56.0', to: '1.58.0' } }, active: true })
      await new Promise(r => setTimeout(r, 100))
      const headings = [...leaf.view.contentEl.querySelectorAll('article h2')].map(el => el.textContent)
      const state = leaf.view.getState()
      await leaf.setViewState({ type: 'abele-changelog', state, active: true })
      app.commands.executeCommandById('abele:open-changelog')
      await new Promise(r => setTimeout(r, 300))
      const reused = app.workspace.getLeavesOfType('abele-changelog').length === 1 && app.workspace.getLeavesOfType('abele-changelog')[0] === leaf
      const all = leaf.view.contentEl.querySelector('h1').textContent === 'All versions'
      const oldest = () => [...leaf.view.contentEl.querySelectorAll('article h2')].pop()?.textContent
      while (oldest() !== '0.0.1') {
        const button = [...leaf.view.contentEl.querySelectorAll('button')].find(b => b.textContent.includes('Show older versions'))
        if (!button) break
        button.click(); await new Promise(r => setTimeout(r, 50))
      }
      const reachedOldest = oldest() === '0.0.1'
      leaf.detach()
      return JSON.stringify({ headings, reused, all, reachedOldest, clean: !document.querySelector('.abele-changelog-view') })
    })()`)
    ) as {
      headings: string[]
      reused: boolean
      all: boolean
      reachedOldest: boolean
      clean: boolean
    }
    expect(result.headings).toEqual(['1.58.0', '1.57.0'])
    expect(result.reused).toBe(true)
    expect(result.all).toBe(true)
    expect(result.reachedOldest).toBe(true)
    expect(result.clean).toBe(true)
  })

  it('opens from Other settings and closes the settings in their own window', async () => {
    const result = JSON.parse(
      await evalLong(`(async () => {
      app.setting.open(); app.setting.openTabById('abele')
      await new Promise(r => setTimeout(r, 400))
      const doc = app.setting.activeTab.containerEl.ownerDocument
      const tab = [...doc.querySelectorAll('.abele-settings .abele-tabs__tab')].find(b => b.textContent.trim() === 'Other')
      tab?.click(); await new Promise(r => setTimeout(r, 200))
      const button = [...doc.querySelectorAll('.abele-settings__other button')].find(b => b.textContent.includes('Open changelog'))
      button?.click(); await new Promise(r => setTimeout(r, 300))
      const result = { found: !!button, closed: !doc.querySelector('.modal-container.mod-dim'), opened: !!app.workspace.getLeavesOfType('abele-changelog')[0] }
      app.setting.close(); app.workspace.getLeavesOfType('abele-changelog')[0]?.detach()
      return JSON.stringify(result)
    })()`)
    ) as { found: boolean; closed: boolean; opened: boolean }
    expect(result.found).toBe(true)
    expect(result.opened).toBe(true)
    expect(result.closed).toBe(true)
  })

  it('keeps the changelog available with AI disabled', async () => {
    const enabled = evalJson<boolean>('window.__abeleTest.AbeleConfig.getInstance().ai.enabled')
    try {
      await evalLong(
        `(async () => { const config=window.__abeleTest.AbeleConfig.getInstance(); config.ai.enabled=false; await config.saveSettings(); return 'ok' })()`
      )
      runCli(['plugin:reload', 'id=abele'])
      expect(evalJson<boolean>("!!app.commands.commands['abele:open-changelog']")).toBe(true)
      evalRaw("app.commands.executeCommandById('abele:open-changelog')")
      const title = JSON.parse(
        await evalLong(
          `(async () => { await new Promise(r=>setTimeout(r,300)); return JSON.stringify(app.workspace.getLeavesOfType('abele-changelog')[0].view.contentEl.querySelector('h1').textContent) })()`
        )
      )
      expect(title).toBe('All versions')
    } finally {
      await evalLong(
        `(async () => { const config=window.__abeleTest.AbeleConfig.getInstance(); config.ai.enabled=${JSON.stringify(enabled)}; await config.saveSettings(); app.workspace.getLeavesOfType('abele-changelog')[0]?.detach(); return 'ok' })()`
      )
      runCli(['plugin:reload', 'id=abele'])
    }
  })

  it('baselines a fresh device silently, offers a skipped-version upgrade once and does not nag after dismissal', async () => {
    evalRaw(`app.saveLocalStorage('${KEY}', null)`)
    runCli(['plugin:reload', 'id=abele'])
    const baseline = JSON.parse(
      await evalLong(`(async () => {
      await new Promise(r => setTimeout(r, 500))
      return JSON.stringify({ marker: app.loadLocalStorage('${KEY}'), offers: [...document.querySelectorAll('.notice')].filter(n => n.textContent.includes("What's new")).length })
    })()`)
    ) as { marker: { schema: number; lastRunVersion: string }; offers: number }
    expect(baseline.marker.schema).toBe(1)
    expect(baseline.offers).toBe(0)
    evalRaw(`app.saveLocalStorage('${KEY}', { schema: 1, lastRunVersion: '1.56.0' })`)
    runCli(['plugin:reload', 'id=abele'])
    const updated = JSON.parse(
      await evalLong(`(async () => {
      await new Promise(r => setTimeout(r, 500))
      const notice = [...document.querySelectorAll('.notice')].find(n => n.textContent.includes("What's new"))
      if (!notice) return JSON.stringify({ found: false })
      const buttons = [...notice.querySelectorAll('button')]
      const bounds = notice.getBoundingClientRect()
      const clipped = buttons.filter(b => { b.focus(); const r=b.getBoundingClientRect(); return r.left < bounds.left + 2 || r.right > bounds.right - 2 }).length
      buttons.find(b => b.textContent === "What's new").click()
      await new Promise(r => setTimeout(r, 200))
      const leaf = app.workspace.getLeavesOfType('abele-changelog')[0]
      const title = leaf.view.contentEl.querySelector('h1').textContent
      leaf.detach()
      const hide = window.__abeleTest.showChangelogOffer(app, { from: '1.56.0', to: '1.58.0' })
      try { [...document.querySelectorAll('.notice button')].find(b => b.textContent === 'Dismiss').click() } finally { hide() }
      return JSON.stringify({ found: true, clipped, title, marker: app.loadLocalStorage('${KEY}') })
    })()`)
    ) as { found: boolean; clipped: number; title: string; marker: { lastRunVersion: string } }
    expect(updated.found).toBe(true)
    expect(updated.clipped).toBe(0)
    expect(updated.title).toBe(`What's new since 1.56.0 through ${baseline.marker.lastRunVersion}`)
    expect(updated.marker.lastRunVersion).toBe(baseline.marker.lastRunVersion)
    runCli(['plugin:reload', 'id=abele'])
    const count = JSON.parse(
      await evalLong(
        `(async () => { await new Promise(r => setTimeout(r, 500)); return JSON.stringify([...document.querySelectorAll('.notice')].filter(n=>n.textContent.includes("What's new")).length) })()`
      )
    ) as number
    expect(count).toBe(0)
  })
})
