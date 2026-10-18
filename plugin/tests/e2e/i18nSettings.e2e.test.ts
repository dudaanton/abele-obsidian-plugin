import { describe, expect, it } from 'vitest'
import { evalLong, evalRaw, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'

const locales = ['en', 'en-XA', 'ru', 'de', 'lv', 'es']
const probe = (locale: string, phone: boolean) => `(async () => {
  ${WAIT_PRELUDE}
  // The phone host retains the active tab when its settings sheet closes. Flush our
  // tab's unmount before changing a reload-bound locale, then display it explicitly.
  app.setting.activeTab?.hide?.()
  app.setting.close()
  await window.__abeleTest.setTestLocale(${JSON.stringify(locale)})
  app.setting.open()
  app.setting.openTabById('abele')
  if (app.setting.activeTab?.id === 'abele') app.setting.activeTab.display()
  const root = await until(() => app.setting.activeTab?.containerEl.querySelector('.abele-settings__nav'))
  if (!root) throw new Error('Settings navigation did not mount')
  let d = root.ownerDocument
  const frame = () => new Promise(resolve => {
    const timer = setTimeout(resolve, 250)
    d.defaultView.requestAnimationFrame(() => { clearTimeout(timer); resolve() })
  })
  const settle = async (el = root) => {
    let previous = ''
    let same = 0
    const ready = await until(async () => {
      await frame()
      const r = el.getBoundingClientRect()
      const current = [r.top, r.bottom, r.left, r.right, el.scrollTop].join(' ')
      same = current === previous ? same + 1 : 0
      previous = current
      return same >= 3
    }, 5000, 0)
    if (!ready) throw new Error('Settings geometry did not settle')
  }
  await settle()
  const labels = [...root.querySelectorAll('.abele-tabs__tab')].map(el => el.textContent.trim())
  const pageIds = [...root.querySelectorAll('[data-tab-id]')].map(el => el.dataset.tabId)
  const over = [...root.querySelectorAll('.abele-tabs__tab, .abele-tabs__label, .abele-settings__group')].filter(el => {
    const rect = el.getBoundingClientRect()
    return rect.right > root.getBoundingClientRect().right + 1 || el.scrollWidth > el.clientWidth + 1
  }).map(el => el.textContent.trim())
  const { remote } = require('electron')
  const fs = require('fs')
  fs.mkdirSync(${JSON.stringify(shotDir('i18n-settings'))}, { recursive: true })
  const shoot = async suffix => {
    const w = remote.BrowserWindow.getAllWindows().find(w => w.getTitle().startsWith('Settings - ' + app.vault.getName() + ' - ')) || remote.getCurrentWindow()
    fs.writeFileSync(${JSON.stringify(shotDir('i18n-settings'))} + '/' + ${JSON.stringify(locale + (phone ? '-phone' : '-desktop'))} + suffix + '.png', (await w.webContents.capturePage()).toPNG())
  }
  await shoot('-top')
  let endVisible = true
  let geometry = []
  if (${phone}) {
    const last = [...root.querySelectorAll('.abele-tabs__tab')].at(-1)
    last.scrollIntoView({ block: 'end', behavior: 'instant' })
    await settle(last)
    const bounds = last.getBoundingClientRect()
    endVisible = bounds.top >= 0 && bounds.bottom <= d.defaultView.innerHeight + 1
    for (let el = last; el; el = el.parentElement) {
      const rect = el.getBoundingClientRect()
      geometry.push({ cls: el.className, top: rect.top, bottom: rect.bottom, height: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, overflow: d.defaultView.getComputedStyle(el).overflowY })
    }
    await shoot('-bottom')
  }
  let nodeDialog = null
  const pages = []
  const layoutOver = []
  const measureContent = (label, el) => {
    const box = el.getBoundingClientRect()
    if (el.scrollWidth > el.clientWidth + 1 || box.left < -1 || box.right > el.ownerDocument.defaultView.innerWidth + 1)
      layoutOver.push({ label, width: el.clientWidth, scroll: el.scrollWidth, left: box.left, right: box.right })
  }
  let errorState = false
  let missingState = false
  const dialogs = []
  const closeDialog = async () => {
    d.body.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
    if (await until(() => !d.querySelector('.modal.abele-modal'), 3000)) return
    d.querySelector('.modal.abele-modal')?.closest('.modal-container')?.querySelector('.modal-bg')?.click()
    if (!await until(() => !d.querySelector('.modal.abele-modal'))) throw new Error('Localized dialog did not close')
  }
  if (['ru', 'en-XA'].includes(${JSON.stringify(locale)})) {
    root.querySelector('[data-tab-id="nodes"]').click()
    const add = await until(() => d.querySelector('[data-testid="node-settings-add-local"]'))
    if (!add) throw new Error('Node settings did not mount')
    add.scrollIntoView({ block: 'center', behavior: 'instant' })
    await settle(add)
    await shoot('-nodes')
    add.click()
    const dialog = await until(() => d.querySelector('.abele-node-settings-local-dialog'))
    if (!dialog) throw new Error('Local node dialog did not open')
    await settle(dialog)
    await shoot('-node-local-empty')
    measureContent('local node empty', dialog)
    const inputs = [...dialog.querySelectorAll('input')]
    inputs[0].value = 'sample-project-with-a-long-local-node-label-'.repeat(4)
    inputs[0].dispatchEvent(new d.defaultView.Event('input', { bubbles: true }))
    await settle(dialog)
    await shoot('-node-local-long')
    measureContent('local node long', dialog)
    nodeDialog = {
      over: dialog.scrollWidth > dialog.clientWidth + 1,
      disabled: dialog.querySelector('.mod-cta')?.disabled,
      title: dialog.querySelector('.modal-title')?.textContent?.trim(),
    }
    dialog.querySelector('[data-testid="node-settings-local-cancel"]').click()
    await until(() => !d.querySelector('.abele-node-settings-local-dialog'))
    const config = window.__abeleTest.AbeleConfig.getInstance()
    const aiBefore = config.ai
    const display = async id => {
      const pane = app.setting.activeTab.containerEl
      if (${phone} && !pane.querySelector('.abele-settings__nav')) {
        const back = pane.ownerDocument.querySelector('.modal-setting-back-button')
        if (!back) throw new Error('Settings page menu button did not mount')
        back.click()
      }
      const tab = await until(() => pane.querySelector('.abele-settings__nav [data-tab-id="' + id + '"]'))
      if (!tab) throw new Error('Missing settings page: ' + id)
      tab.click()
      const content = await until(() => app.setting.activeTab.containerEl.querySelector('.abele-settings__content'))
      d = content.ownerDocument
      await settle(content)
      content.scrollTop = 0
      content.scrollIntoView({ block: 'start', behavior: 'instant' })
      await settle(content)
      return content
    }
    const captureContent = async (suffix, content) => {
      content.scrollTop = 0
      await settle(content)
      await shoot(suffix)
      if (content.scrollHeight > content.clientHeight + 1) {
        content.scrollTop = content.scrollHeight
        await settle(content)
        await shoot(suffix + '-bottom')
        content.scrollTop = 0
        await settle(content)
      }
    }
    try {
      // The fixture changes only the in-memory settings. No script runs and nothing is saved.
      config.ai = { ...aiBefore, enabled: true, startupScripts: [{ script: 'sample-missing-script', devices: 'both' }], agents: (aiBefore.agents || []).map((agent, index) => index === 0 ? { ...agent, description: 'Migrated from the global AI settings.' } : agent) }
      for (const id of pageIds) {
        const content = await display(id)
        await captureContent('-page-' + id, content)
        measureContent(id, content)
        pages.push(id)
        const nestedSelector = id === 'ai' ? '.abele-ai-settings__tabs' : id === 'scripts' ? '.abele-settings__scripts-tabs' : null
        if (!nestedSelector) continue
        const nestedIds = [...content.querySelectorAll(nestedSelector + ' [data-tab-id]')].map(el => el.dataset.tabId)
        for (const nested of nestedIds) {
          content.querySelector(nestedSelector + ' [data-tab-id="' + nested + '"]').click()
          await settle(content)
          await captureContent('-page-' + id + '-' + nested, content)
          measureContent(id + '/' + nested, content)
          if (id === 'ai' && nested === 'agents' && config.ai.agents.length) {
            if (content.textContent.includes('Migrated from the global AI settings.')) throw new Error('Built-in agent description is untranslated')
            if (!config.ai.agents.some(agent => agent.description === 'Migrated from the global AI settings.')) throw new Error('Displaying settings rewrote a stored description')
          }
          if (id === 'ai' && nested === 'mcp') {
            content.querySelector('[data-testid="settings-mcp-add"]').click()
            const editor = await until(() => d.querySelector('.abele-mcp-server'))
            if (!editor) throw new Error('MCP editor did not mount')
            await settle(editor)
            await shoot('-mcp-editor-empty')
            measureContent('mcp editor', editor.closest('.modal'))
            await closeDialog()
          }
          if (id === 'ai' && nested === 'models') {
            const input = content.querySelector('[data-testid="settings-request-timeout"]')
            if (!input) throw new Error('Request timeout input did not mount')
            const previous = input.value
            input.value = '0'
            input.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }))
            const alert = await until(() => content.querySelector('[role="alert"]'))
            if (!alert) throw new Error('Invalid timeout did not show its error')
            alert.scrollIntoView({ block: 'center', behavior: 'instant' })
            await settle(alert)
            await shoot('-error-timeout')
            measureContent('timeout error', content)
            errorState = input.getAttribute('aria-invalid') === 'true' && !!alert.textContent.trim()
            input.value = previous
          }
          if (id === 'scripts' && nested === 'startup') {
            const row = await until(() => content.querySelector('[data-script="sample-missing-script"]'))
            if (!row) throw new Error('Missing script fixture did not mount')
            row.scrollIntoView({ block: 'center', behavior: 'instant' })
            await settle(row)
            await shoot('-missing-script')
            measureContent('missing script', content)
            missingState = !!row.querySelector('.setting-item-description')?.textContent.trim()
          }
        }
      }
    } finally {
      config.ai = aiBefore
    }
    app.setting.activeTab?.hide?.()
    app.setting.close()
    d = document
    for (const name of ['model', 'image-model', 'transfer-send', 'transfer-preview', 'transfer-scan', 'agent-tools', 'lint-rule', 'key-destinations']) {
      const completion = window.__abeleTest.openDialog(name)
      try {
        const modal = await until(() => d.querySelector('.modal.abele-modal'))
        if (!modal) throw new Error('Localized fixture did not mount: ' + name)
        await settle(modal)
        await shoot('-dialog-' + name)
        measureContent(name, modal)
        dialogs.push(name)
        const tabs = [...modal.querySelectorAll('[data-tab-id]')].map(el => el.dataset.tabId)
        for (const tab of tabs) {
          modal.querySelector('[data-tab-id="' + tab + '"]').click()
          await settle(modal)
          await shoot('-dialog-' + name + '-' + tab)
          measureContent(name + '/' + tab, modal)
        }
      } finally {
        await closeDialog()
        await completion
      }
    }
  }
  app.setting.close()
  return JSON.stringify({ labels, over, endVisible, geometry, nodeDialog, pages, errorState, missingState, dialogs, layoutOver })
})()`

describe.skipIf(!isObsidianRunning())('translated Settings navigation', () => {
  it('keeps the English baseline and fits every pilot language on desktop and phone', async () => {
    async function check(phone: boolean) {
      for (const locale of locales) {
        const result = JSON.parse(await evalLong(probe(locale, phone), 180_000)) as {
          labels: string[]
          over: string[]
          endVisible: boolean
          geometry: unknown[]
          nodeDialog: { over: boolean; disabled: boolean; title: string } | null
          pages: string[]
          errorState: boolean
          missingState: boolean
          dialogs: string[]
          layoutOver: unknown[]
        }
        expect(result.labels).toHaveLength(18)
        expect(result.over, `${locale} ${phone ? 'phone' : 'desktop'}`).toEqual([])
        expect(
          result.endVisible,
          `${locale}: last page is reachable: ${JSON.stringify(result.geometry)}`
        ).toBe(true)
        if (locale === 'en')
          expect(result.labels).toEqual([
            'Tasks',
            'Journals',
            'Calendars',
            'Links',
            'Linter',
            'Books',
            'Finance',
            'Time Tracking',
            'AI Agent',
            'Scripts',
            'Nodes',
            'Git hosting',
            'Quick button',
            'Header buttons',
            'Sync',
            'Transfer',
            'Logs',
            'Other',
          ])
        if (locale === 'en-XA')
          expect(result.labels.filter((label) => !label.startsWith('⟦'))).toEqual([])
        if (locale === 'ru') expect(result.labels[0]).toBe('Задачи')
        if (['ru', 'en-XA'].includes(locale)) {
          expect(result.nodeDialog?.over).toBe(false)
          expect(result.nodeDialog?.disabled).toBe(true)
          expect(result.nodeDialog?.title).toBeTruthy()
          expect(result.pages).toHaveLength(18)
          expect(result.errorState).toBe(true)
          expect(result.missingState).toBe(true)
          expect(result.dialogs).toHaveLength(8)
          expect(result.layoutOver, locale + (phone ? ' phone' : ' desktop')).toEqual([])
        }
      }
    }
    try {
      await check(false)
      await withEmulatedPhone(() => check(true))
    } finally {
      evalRaw(`app.setting.close(); window.__abeleTest?.setTestLocale('en')`)
      await reloadApp('app.emulateMobile(false)')
    }
  }, 600_000)
})
