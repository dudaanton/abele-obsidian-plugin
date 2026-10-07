import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { WAIT_PRELUDE } from './helpers/wait'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const shot = shotDir('abele-model-settings') + '/timeout.png'

describe.skipIf(!available)('per-model timeout settings on a real screen', () => {
  it('saves, reopens and clears a model override while retaining the global timeout', async () => {
    const raw = await evalLong(
      `(async () => {
      ${WAIT_PRELUDE}
      const config = window.__abeleTest.AbeleConfig.getInstance()
      const originalAi = config.ai
      let result
      try {
        config.editSettings(() => {
          config.ai = {...config.ai, enabled: true, requestTimeoutSeconds: 120, providers: [{
            id: 'sample-provider', name: 'Sample provider', baseUrl: 'https://sample.invalid/v1', apiKeyId: '',
            models: [{id: 'sample-model', name: 'Sample model', contextWindow: 1000, maxTokens: 100, supportsReasoning: false}],
          }]}
        })
        const open = async () => {
          app.setting.open()
          app.setting.openTabById('abele')
          if (!await until(() => app.setting.activeTab?.containerEl, 5000)) throw Error('Settings did not open')
          await wait(300)
          const doc = app.setting.activeTab.containerEl.ownerDocument
          const nav = () => doc.querySelector('.abele-settings__nav .abele-tabs__tab')?.getBoundingClientRect().width
          if (!nav()) { doc.querySelector('.modal-setting-back-button')?.click(); await wait(300) }
          if (!await until(nav, 5000)) throw Error('Settings navigation did not open')
          ;[...doc.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(t => t.textContent.trim() === 'AI Agent')?.click()
          if (!await until(() => doc.querySelector('.abele-ai-settings__tabs'), 5000)) throw Error('AI settings did not open')
          ;[...doc.querySelectorAll('.abele-ai-settings__tabs .abele-tabs__tab')].find(t => t.textContent.trim() === 'General')?.click()
          if (!await until(() => doc.querySelector('.abele-ai-provider .abele-card'), 5000)) throw Error('Model card did not open')
          doc.querySelector('.abele-ai-provider .abele-card').click()
          if (!await until(() => doc.querySelector('.abele-model-edit'), 5000)) throw Error('Model editor did not open')
          const editor = doc.querySelector('.abele-model-edit')
          const row = [...editor.querySelectorAll('.setting-item')].find(e => e.querySelector('.setting-item-name')?.textContent === 'Request timeout (seconds)')
          if (!row) throw Error('Model timeout field is missing')
          return {doc, editor, input: row.querySelector('input')}
        }
        const edit = async (input, value) => {
          input.value = value
          input.dispatchEvent(new Event('input', {bubbles: true}))
          await wait(700)
        }
        const save = async ({doc, editor}) => {
          editor.closest('.modal').querySelector('.abele-modal__footer button').click()
          if (!await until(() => !doc.querySelector('.abele-model-edit'), 5000)) throw Error('Model editor did not close')
          await config.saveSettings()
          app.setting.close()
          await config.reloadSettings()
        }
        const first = await open()
        const initial = first.input.value
        await edit(first.input, '180')
        first.input.scrollIntoView({block: 'center'})
        await wait(300)
        const r = first.input.getBoundingClientRect()
        const outside = r.width <= 0 || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight
        let savedShot
        if (window.__e2eHost) savedShot = await window.__e2eHost.shot(${JSON.stringify(shot)})
        else {
          const fs = require('fs')
          fs.mkdirSync(${JSON.stringify(shotDir('abele-model-settings'))}, {recursive: true})
          const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
          fs.writeFileSync(${JSON.stringify(shot)}, image.toPNG())
          savedShot = ${JSON.stringify(shot)}
        }
        await save(first)
        const saved = config.ai.providers[0].models[0].requestTimeoutSeconds
        const reopened = await open()
        const displayed = reopened.input.value
        await edit(reopened.input, '')
        await save(reopened)
        result = {initial, saved, displayed, cleared: config.ai.providers[0].models[0].requestTimeoutSeconds === undefined,
          global: config.ai.requestTimeoutSeconds, outside, shot: savedShot}
      } finally {
        const doc = app.setting.activeTab?.containerEl.ownerDocument
        doc?.querySelector('.modal:has(.abele-model-edit) .modal-close-button')?.click()
        app.setting.close()
        config.editSettings(() => { config.ai = originalAi })
        await config.saveSettings()
      }
      return JSON.stringify(result)
    })()`,
      90_000
    )
    const result = JSON.parse(raw)
    expect(result).toMatchObject({
      initial: '',
      saved: 180,
      displayed: '180',
      cleared: true,
      global: 120,
      outside: false,
    })
    expect(result.shot).toBeTruthy()
    expect(result.shot).not.toMatch(/^no picture:/)
    console.info(JSON.stringify(result))
  }, 120_000)
})
