import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  enterPhone,
  evalJson,
  evalLong,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  restoreDesktopWindow,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-drawer-switch')
const views = [
  'abele-ai-sidebar-view',
  'abele-timeline-sidebar-view',
  'abele-todo-sidebar-view',
  'abele-finance-sidebar-view',
  'abele-accounts-sidebar-view',
  'abele-time-tracking-sidebar-view',
  'abele-node-sidebar',
  'abele-script-runs-view',
  'abele-script-view',
  'abele-github',
  'abele-github-notifications',
  'abele-debug-view',
  'abele-requests',
]

// The inactive Abele leaf stays mounted while a native view is selected. Its switch must
// not keep the footer hidden. All fixtures stay offline; no provider or project code runs.
const probe = (type: string, phone: boolean) => `(async () => {
  const ws = app.workspace, config = window.__abeleTest.AbeleConfig.getInstance()
  const wasCollapsed = ws.rightSplit.collapsed, size = ws.rightSplit.size
  const oldAi = config.ai.enabled
  const oldGithub = config.github.enabled
  const leaves = []
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => {
    for (let i = 0; i < 160; i++) { if (fn()) return; await wait(50) }
    throw Error('Drawer did not settle: ' + fn.toString())
  }
  const report = { switches: 0, rows: [], restored: [], overflow: [], shot: '', error: '' }
  try {
    config.ai.enabled = true
    config.github.enabled = false
    const leaf = ws.getRightLeaf(true); leaves.push(leaf)
    await leaf.setViewState({ type: ${JSON.stringify(type)}, active: true })
    await ws.revealLeaf(leaf); ws.rightSplit.expand()
    if (!app.isMobile) ws.rightSplit.setSize(390)
    const content = leaf.view.containerEl
    await until(() => content.querySelector(${JSON.stringify(phone ? '.abele-drawer-switch.is-shown' : 'span[hidden]')}))
    await wait(${phone ? 600 : 200})
    const drawer = content.closest('.workspace-drawer')
    if (${phone} && !drawer) throw Error('The view is outside the phone drawer')
    report.switches = content.querySelectorAll('.abele-drawer-switch.is-shown').length
    if (drawer) {
      report.rows = ['.workspace-drawer-header', '.workspace-drawer-tab-options'].map(selector => {
        const row = drawer.querySelector(selector)
        if (!row) throw Error('Missing native drawer row: ' + selector)
        return getComputedStyle(row).display
      })
    }
    for (const control of content.querySelectorAll('.abele-drawer-switch.is-shown')) {
      const r = control.getBoundingClientRect(), p = content.getBoundingClientRect()
      if (r.width < 24 || r.height < 24 || r.left < p.left || r.right > p.right || r.top < p.top)
        report.overflow.push('Drawer switch is clipped or too small')
      const header = control.closest('.nav-header')?.getBoundingClientRect()
      if (header && (r.top < header.top - 1 || r.bottom > header.bottom + 1))
        report.overflow.push('Drawer switch has escaped its header row')
    }
    if (${phone} && ${JSON.stringify(type)} === 'abele-ai-sidebar-view') {
      const chat = content.querySelector('.abele-ai-chat')
      // A newly opened chat focuses its composer. Measure the home-indicator inset
      // with the keyboard dismissed; keyboard-open layout deliberately has no such pad.
      chat.querySelector('.abele-drawer-switch').focus()
      await until(() => !chat.classList.contains('abele-keyboard-open'))
      chat.style.setProperty('--safe-area-inset-bottom', '34px')
      await wait(100)
      const composer = chat.querySelector('.abele-chat-input')
      if (!composer || composer.getBoundingClientRect().bottom > chat.getBoundingClientRect().bottom - 33)
        report.overflow.push('Chat composer overlaps the home indicator inset')
      if (chat.querySelector('.abele-ai-chat__header-actions [aria-label="Open a chat you have had"]'))
        report.overflow.push('Chat history still occupies the header')
      chat.querySelector('.abele-ai-chat__overflow [aria-haspopup="menu"]').click()
      await until(() => document.querySelector('.menu .menu-item-title'))
      const first = document.querySelector('.menu .menu-item-title')
      if (first.textContent !== 'Open a chat you have had') report.overflow.push('Chat history is not first in the more menu')
      first.closest('.menu-item').click()
      await until(() => document.querySelector('.abele-chat-history') && !document.querySelector('.menu'))
      await wait(300)
      document.querySelector('.abele-chat-history').closest('.modal').querySelector('.modal-header-button, .modal-close-button').click()
      await until(() => !document.querySelector('.abele-chat-history'))
    }
    const path = ${JSON.stringify(shots + '/' + (phone ? 'phone-' : 'desktop-') + type + '.png')}
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(path, image.toPNG()); report.shot = path
    if (${phone} && ${JSON.stringify(type)} === 'abele-ai-sidebar-view') {
      const session = window.__abeleTest.ChatService.getInstance().activeSession.value
      const wasPreparing = session.preparingClone.value
      try {
        session.preparingClone.value = true
        await wait(200)
        const chat = content.querySelector('.abele-ai-chat')
        const control = chat.querySelector('.abele-drawer-switch.is-shown')
        const r = control.getBoundingClientRect(), p = chat.getBoundingClientRect()
        if (r.width > 64 || r.left - p.left > p.width / 3)
          report.overflow.push('The loading switch is stretched or centred')
        if (chat.querySelector('.abele-chat-input, .abele-ai-chat__header-actions'))
          report.overflow.push('Chat editing actions remain available while copying')
        const pending = await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(${JSON.stringify(shots + '/phone-chat-copy-pending.png')}, pending.toPNG())
      } finally { session.preparingClone.value = wasPreparing }
    }
    if (${phone}) {
      const native = ws.getRightLeaf(true); leaves.push(native)
      await native.setViewState({ type: 'file-explorer', active: true })
      await ws.revealLeaf(native); ws.rightSplit.expand()
      await until(() => native.view.containerEl.closest('.workspace-drawer')?.querySelector('.workspace-drawer-tab-options'))
      await wait(600)
      const nativeDrawer = native.view.containerEl.closest('.workspace-drawer')
      await ws.revealLeaf(leaf); ws.rightSplit.expand()
      await until(() => content.querySelector('.abele-drawer-switch.is-shown'))
      await wait(300)
      content.querySelector('.abele-drawer-switch.is-shown').click()
      await until(() => document.querySelector('.menu .menu-item-title'))
      const drawerLeaves = []
      ws.iterateAllLeaves(candidate => {
        if (candidate.getRoot() === leaf.getRoot()) drawerLeaves.push(candidate)
      })
      const entries = [...document.querySelectorAll('.menu .menu-item')]
      const titles = entries.map(entry => entry.querySelector('.menu-item-title')?.textContent)
      if (JSON.stringify(titles) !== JSON.stringify(drawerLeaves.map(candidate => candidate.view.getDisplayText())))
        report.overflow.push('Drawer menu does not list its views')
      await wait(300)
      const menuShot = await require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').writeFileSync(${JSON.stringify(shots + '/phone-menu-' + type + '.png')}, menuShot.toPNG())
      entries[drawerLeaves.indexOf(native)].click()
      await until(() => !document.querySelector('.menu') && native.view.containerEl.closest('.workspace-drawer-active-tab-content'))
      await wait(300)
      report.restored = ['.workspace-drawer-header', '.workspace-drawer-tab-options'].map(selector => getComputedStyle(nativeDrawer.querySelector(selector)).display)
    }
  } catch (error) { report.error = String(error.stack || error) }
  finally {
    leaves.reverse().forEach(leaf => leaf.detach())
    config.ai.enabled = oldAi
    config.github.enabled = oldGithub
    if (wasCollapsed) ws.rightSplit.collapse()
    if (!app.isMobile && typeof size === 'number') ws.rightSplit.setSize(size)
  }
  return JSON.stringify(report)
})()`

describe.skipIf(!isObsidianRunning() || !hasTestApi())('drawer view switch', () => {
  afterAll(async () => {
    if (evalJson<boolean>('!!app.isMobile')) await reloadApp('app.emulateMobile(false)')
    await restoreDesktopWindow()
  }, 120_000)
  describe.each([false, true])('phone=%s', (phone) => {
    beforeAll(async () => {
      if (phone) await enterPhone(390, 844)
      else await restoreDesktopWindow()
    }, 120_000)
    it.each(views)(
      '%s keeps switching available and restores native rows',
      async (type) => {
        const report = JSON.parse(await evalLong(probe(type, phone), 60_000))
        expect(report.error).toBe('')
        expect(report.switches).toBe(phone ? 1 : 0)
        expect(report.overflow).toEqual([])
        expect(report.shot).toBeTruthy()
        if (phone) {
          expect(report.rows).toEqual(['none', 'none'])
          expect(report.restored).toHaveLength(2)
          expect(report.restored).not.toContain('none')
        }
      },
      90_000
    )
  })
})
