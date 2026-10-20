import { afterAll, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { horizontalOverflow } from './helpers/horizontalOverflow'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('ai-settings')
afterAll(async () => {
  if (available && evalJson<boolean>('!!app.isMobile')) await reloadApp('app.emulateMobile(false)')
})

it.skipIf(!available).each([
  { name: 'desktop', width: 1280, height: 900, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true },
])('keeps shared AI settings and override controls usable on $name', async (size) => {
  if (size.mobile) await reloadApp('app.emulateMobile(true)')
  evalRaw(
    `require('@electron/remote').getCurrentWindow().setContentSize(${size.width}, ${size.height})`
  )
  const raw = await evalLong(
    `(async () => {
    const wait = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms))
    const api = window.__abeleTest
    const config = api.AbeleConfig.getInstance()
    const before = JSON.parse(JSON.stringify(config.ai))
    window.__aiSettingsBefore = before
    const service = api.ChatService.getInstance()
    const previousTab = service.activeTabId.value
    const sidebarSize = app.workspace.rightSplit.size
    const previousLeaves = app.workspace.getLeavesOfType('abele-ai-sidebar').map(leaf => leaf.id)
    const keyId = 'abele-sample-settings-consistency'
    let tab = null
    let settingsWindow = null
    const report = { overflow: [], labels: [], patternKept: false, modelReset: false, offKept: false, shots: [] }
    const qa = (doc, selector) => [...doc.querySelectorAll(selector)]
    const close = async (doc = document) => {
      doc.querySelector('.modal-container .modal-close-button')?.click()
      await wait()
    }
    const measure = (root) => {
      if (!root) throw Error('Missing settings surface')
      report.overflow.push(...(${horizontalOverflow.toString()})(root))
    }
    const shoot = async (name, doc = document) => {
      const win = doc === document ? require('@electron/remote').getCurrentWindow() : settingsWindow
      if (!win) throw Error('Missing settings window')
      await wait()
      const image = await win.webContents.capturePage()
      const path = ${JSON.stringify(shots + '/' + size.name + '-')} + name + '.png'
      require('fs').writeFileSync(path, image.toPNG())
      report.shots.push(name)
    }
    try {
      config.editSettings(() => { config.ai = {
        ...config.ai, enabled: true,
        providers: [{ id: 'sample-chat', name: 'Sample chat provider', baseUrl: 'https://sample.invalid/v1', apiKeyId: '', models: [
          { id: 'sample-model', name: 'Sample model', contextWindow: 128000, maxTokens: 4096, supportsReasoning: false },
          { id: 'sample-alternate', name: 'Sample alternate', contextWindow: 128000, maxTokens: 4096, supportsReasoning: false },
        ] }],
        imageProviders: [{ id: 'sample-image', name: 'Sample image provider with a longer display name', apiType: 'openai', endpoint: '', apiKeyId: '', models: [] }],
        secrets: [{ id: 'sample-settings-key', name: 'Sample named key', keyId }],
      } })
      await config.saveSettings()
      api.secrets().set(keyId, 'sample-key-value-not-a-real-credential')
      const registry = api.AgentRegistry.getInstance()
      const reviewer = registry.create({ name: 'Sample reviewer', utility: true })
      const agent = registry.create({ name: 'Sample agent', providerId: 'sample-chat', modelId: 'sample-model', interceptorAgentId: reviewer.id })
      registry.setDefault(agent.id)
      await config.saveSettings()
      app.setting.open()
      app.setting.openTabById('abele')
      await wait(600)
      const doc = app.setting.activeTab.containerEl.ownerDocument
      settingsWindow = require('@electron/remote').BrowserWindow.getAllWindows().find(win => win.getTitle().startsWith('Settings - ' + app.vault.getName() + ' - '))
      if (settingsWindow) settingsWindow.setContentSize(1000, 900)
      const pressTab = async (selector, label) => {
        const button = qa(doc, selector).find(tab => tab.textContent.trim() === label)
        if (!button) throw Error('Missing tab: ' + label)
        button.click(); await wait()
      }
      await pressTab('.abele-settings__nav .abele-tabs__tab', 'AI Agent')
      measure(doc.querySelector('.abele-settings__content'))
      await shoot('overview', doc)
      await pressTab('.abele-ai-settings__tabs .abele-tabs__tab', 'Models')
      doc.querySelector('.abele-ai-provider').scrollIntoView({ block: 'start' })
      await shoot('providers', doc)
      doc.querySelectorAll('.abele-ai-provider')[1].scrollIntoView({ block: 'start' })
      await shoot('image-provider', doc)
      const imageLimit = qa(doc, '.setting-item').find(row => row.querySelector('.setting-item-name')?.textContent.trim() === 'Image generation time limit')
      if (!imageLimit) throw Error('Missing image time limit setting')
      imageLimit.scrollIntoView({ block: 'center' })
      measure(imageLimit)
      await shoot('image-time-limit', doc)
      await pressTab('.abele-ai-settings__tabs .abele-tabs__tab', 'General')
      const card = qa(doc, '.abele-card').find(card => card.textContent.includes('Sample named key'))
      card.click(); await wait()
      card.scrollIntoView({ block: 'center' })
      measure(doc.querySelector('.abele-ai-secret__editor'))
      await shoot('named-key', doc)
      await pressTab('.abele-ai-settings__tabs .abele-tabs__tab', 'Agents')
      qa(doc, '.abele-card').find(card => card.textContent.includes('Sample agent')).click()
      await wait()
      const editorDoc = doc.querySelector('.abele-agent-editor') ? doc : document
      // The list keeps its entries closed; the agent's one interceptor is opened to show it.
      editorDoc.querySelector('.abele-agent-editor .abele-interceptors__name').click()
      await wait()
      const interceptorRow = qa(editorDoc, '.setting-item').find(row => row.querySelector('.setting-item-name')?.textContent === 'Interceptor')
      interceptorRow.scrollIntoView({ block: 'start' })
      measure(editorDoc.querySelector('.abele-agent-editor'))
      await shoot('agent-interceptor', editorDoc)
      qa(editorDoc, '.abele-agent-editor .abele-tabs__tab').find(tab => tab.textContent.trim() === 'Access').click()
      await wait()
      report.labels.push(qa(editorDoc, '.abele-agent-editor select')[0].textContent)
      // A different tab keeps the modal's previous scroll position; capture its first row.
      await wait(500)
      for (const scroller of qa(editorDoc, '.modal-container *')) if (scroller.scrollTop) scroller.scrollTop = 0
      await shoot('agent-permissions', editorDoc)
      await close(editorDoc)
      if (settingsWindow) settingsWindow.close()
      else app.setting.close()
      await wait()
      tab = service.createTab()
      const session = service.activeSession.value
      if (!session || tab === previousTab) throw Error('No temporary chat tab')
      session.save = async () => {}
      session.switchAgent(agent.id)
      session.activeModelId.value = 'sample-alternate'
      session.permissionMode.value = 'allow-edit'
      session.interceptor.script.value = 'Missing sample interceptor'
      session.interceptor.pattern.value = '^sample'
      app.commands.executeCommandById('abele:show-ai-sidebar')
      await wait(600)
      if (!${size.mobile}) app.workspace.rightSplit.setSize(600)
      await wait()
      const chat = document.querySelector('.abele-ai-chat')
      measure(chat)
      await shoot('chat-override')
      chat.querySelector('[aria-label="More chat actions"]').click()
      await wait()
      qa(document, '.menu-item').find(item => (item.querySelector('.menu-item-title')?.textContent ?? item.textContent).trim() === 'Access, tools and chat settings').click()
      await wait()
      qa(document, '.abele-chat-setup .abele-tabs__tab').find(tab => tab.textContent.trim() === 'Chat').click()
      await wait()
      document.querySelector('.abele-chat-setup .abele-interceptors__name').click()
      await wait()
      const field = document.querySelector('input[placeholder="Everything"]')
      field.value = '['; field.dispatchEvent(new Event('input', { bubbles: true }))
      await wait()
      report.patternKept = session.interceptor.pattern.value === '^sample' && !!document.querySelector('.mod-warning')
      measure(document.querySelector('.abele-chat-setup').closest('.modal'))
      await shoot('chat-settings-invalid-pattern')
      const modelReset = document.querySelector('.abele-chat-settings .abele-override-notice__reset')
      if (!modelReset || !modelReset.getBoundingClientRect().width) throw Error('Model override is not marked in chat settings')
      modelReset.closest('.setting-item').scrollIntoView({ block: 'center' })
      await shoot('chat-model-override')
      field.value = '^sample'; field.dispatchEvent(new Event('input', { bubbles: true }))
      const picker = qa(document, '.setting-item').find(row => row.querySelector('.setting-item-name')?.textContent === 'Interceptors').querySelector('select:not(.is-measuring)')
      picker.value = ''; picker.dispatchEvent(new Event('change', { bubbles: true }))
      await wait()
      report.offKept = picker.value === '' && !session.interceptor.isActive && !session.interceptor.followsAgent
      modelReset.click()
      await wait()
      report.modelReset = !session.isOverridden('modelId') && !session.isOverridden('providerId')
      qa(document, '.abele-chat-setup .abele-tabs__tab').find(tab => tab.textContent.trim() === 'Access').click()
      await wait()
      report.labels.push(qa(document, '.abele-scope-mgr select').map(select => select.textContent).join(''))
      measure(document.querySelector('.abele-chat-setup').closest('.modal'))
      qa(document, '.abele-scope-mgr .abele-override-notice')[1].scrollIntoView({ block: 'center' })
      await shoot('chat-permissions-override')
      await close()
      app.setting.open(); app.setting.openTabById('editor'); await wait(500)
      const nativeDoc = app.setting.activeTab.containerEl.ownerDocument
      settingsWindow = require('@electron/remote').BrowserWindow.getAllWindows().find(win => win.getTitle().startsWith('Settings - ' + app.vault.getName() + ' - '))
      await shoot('native-settings-rows', nativeDoc)
      return report
    } finally {
      try {
        await close()
        if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close()
        else app.setting.close()
        if (tab) service.dropTab(tab)
        if (previousTab) service.switchTab(previousTab)
        if (typeof app.workspace.rightSplit.setSize === 'function') app.workspace.rightSplit.setSize(sidebarSize)
        for (const leaf of app.workspace.getLeavesOfType('abele-ai-sidebar')) if (!previousLeaves.includes(leaf.id)) leaf.detach()
      } finally {
        api.secrets().remove(keyId)
        config.editSettings(() => { config.ai = before })
        await config.saveSettings()
        delete window.__aiSettingsBefore
      }
    }
  })()`,
    150_000
  )
  const report = JSON.parse(raw)
  expect(report.overflow).toEqual([])
  expect(report.patternKept).toBe(true)
  expect(report.modelReset).toBe(true)
  expect(report.offKept).toBe(true)
  for (const labels of report.labels) {
    for (const label of [
      'Ask before every change',
      'Edit files without asking',
      'Everything without asking',
    ])
      expect(labels).toContain(label)
  }
  expect(report.shots).toHaveLength(11)
})
