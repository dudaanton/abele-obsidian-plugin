import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { WAIT_PRELUDE } from './helpers/wait'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('configured model entry selection', () => {
  it('switches between two entries with one API id in the real chat picker', async () => {
    const raw = await evalLong(`(async () => {
      ${WAIT_PRELUDE}
      const api = window.__abeleTest
      const config = api.AbeleConfig.getInstance()
      const chats = api.ChatService.getInstance()
      const registry = api.AgentRegistry.getInstance()
      const previous = JSON.parse(JSON.stringify(config.exportSettings()))
      const oldTab = chats.activeTabId.value
      const collapsed = app.workspace.rightSplit.collapsed
      let id, session, originalSave
      try {
        config.ai.providers = [{ id: 'sample-provider', name: 'Sample provider', baseUrl: 'https://sample.invalid/v1', apiKeyId: '', models: [
          { id: 'sample-model', entryId: 'sample-medium', name: 'Sample balanced', contextWindow: 1000, maxTokens: 100, supportsReasoning: true, reasoningEffort: 'medium' },
          { id: 'sample-model', entryId: 'sample-high', name: 'Sample thorough', contextWindow: 1000, maxTokens: 100, supportsReasoning: true, reasoningEffort: 'high' }
        ] }]
        const agent = registry.create({ name: 'Sample model agent', providerId: 'sample-provider', modelId: 'sample-model' })
        id = chats.createTab()
        if (id === oldTab) throw Error('No free sample tab')
        session = chats.getSession(id)
        originalSave = session.save
        session.save = async () => {}
        session.agentId.value = agent.id
        session.activeProviderId.value = 'sample-provider'
        session.activeModelId.value = 'sample-medium'
        chats.switchTab(id)
        await chats.revealSidebar({ focus: false })
        const button = await until(() => [...document.querySelectorAll('.abele-agent-selector__model')].find(el => el.getBoundingClientRect().width), 8000)
        if (!button) throw Error('Model picker did not render')
        button.click()
        const second = await until(() => [...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim() === 'Sample thorough'), 5000)
        if (!second) throw Error('Second model choice missing')
        second.click()
        await wait(200)
        const chosen = session.resolveModel()
        if (session.activeModelId.value !== 'sample-high' || chosen.id !== 'sample-model' || chosen.reasoningEffort !== 'high') throw Error('Second entry did not resolve independently')
        button.click()
        const first = await until(() => [...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim() === 'Sample balanced'), 5000)
        if (!first) throw Error('First model choice missing')
        first.click()
        await wait(200)
        if (session.resolveModel().reasoningEffort !== 'medium') throw Error('Could not switch back to first entry')
        return JSON.stringify({ selectedSecond: true, switchedBack: true })
      } finally {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        if (session) session.save = async () => {}
        if (id && id !== oldTab) await chats.closeTab(id)
        if (session && originalSave) session.save = originalSave
        config.applySettings(previous)
        registry.notifyConfigReloaded()
        if (oldTab) chats.switchTab(oldTab)
        if (collapsed) app.workspace.rightSplit.collapse()
      }
    })()`)
    expect(JSON.parse(raw)).toEqual({ selectedSecond: true, switchedBack: true })
  })
})
