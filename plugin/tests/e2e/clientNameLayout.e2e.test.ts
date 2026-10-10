import { afterAll, describe, expect, it } from 'vitest'
import {
  activeVaultName,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  restoreDesktopWindow,
  vaultCli,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('client-name')

afterAll(async () => {
  if (available) await restoreDesktopWindow()
})

describe.skipIf(!available)('native client-name connection settings layout', () => {
  it.each([false, true])('fits empty and long names on mobile=%s', async (mobile) => {
    await reloadApp(`app.emulateMobile(${mobile})`)
    const cli = vaultCli(activeVaultName())
    const size = mobile ? [390, 844] : [1280, 900]
    cli.evalRaw(`(() => {
      const win = require('@electron/remote').getCurrentWindow()
      win.setContentSize(${size[0]}, ${size[1]})
      return 'ok'
    })()`)
    for (const state of ['empty', 'long']) {
      const result = cli.evalAwait<{
        over: string[]
        rowVisible: boolean
        value: string
        nativeRow: boolean
        mobile: boolean
        width: number
        height: number
        shot: string
      }>(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
        const api = window.__abeleTest
        const config = api.AbeleConfig.getInstance()
        const saved = JSON.parse(JSON.stringify(config.ai))
        try {
          config.ai.enabled = true
          config.ai.providers = [{ id: 'sample-connection', name: 'Sample connection', baseUrl: 'https://models.example.invalid/v1', apiKeyId: '', clientName: ${JSON.stringify(state === 'empty' ? '' : 'SampleClient/1.0 compatible-model-connection-with-a-long-name')}, models: [{ id: 'sample-model', name: 'Sample model', contextWindow: 1000, maxTokens: 100, supportsReasoning: false }] }]
          config.version.value++
          app.setting.open()
          app.setting.openTabById('abele')
          await wait(300)
          const doc = app.setting.modalEl.ownerDocument
          const view = doc.defaultView
          const win = app.setting.popout?.win.electronWindow || require('@electron/remote').getCurrentWindow()
          win.setContentSize(${size[0]}, ${size[1]})
          await wait(300)
          ;[...doc.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(tab => tab.textContent.trim() === 'AI Agent')?.click()
          await wait(300)
          ;[...doc.querySelectorAll('.abele-ai-settings__tabs .abele-tabs__tab')].find(tab => tab.textContent.trim() === 'General')?.click()
          await wait(300)
          const provider = doc.querySelector('.abele-ai-provider')
          const row = [...provider.querySelectorAll('.setting-item')].find(row => row.querySelector('.setting-item-name')?.textContent === 'Client name')
          row.scrollIntoView({ block: 'center' })
          const input = row.querySelector('input')
          input.focus({ preventScroll: true })
          await wait(400)
          const over = []
          for (const el of row.querySelectorAll('*')) {
            const box = el.getBoundingClientRect()
            if (box.width > 0 && (box.left < -1 || box.right > view.innerWidth + 1)) over.push(el.className || el.tagName)
          }
          const box = row.getBoundingClientRect()
          const image = await win.webContents.capturePage()
          const shot = ${JSON.stringify(shots)} + '/${mobile ? 'phone' : 'desktop'}-${state}.png'
          require('node:fs').writeFileSync(shot, image.resize({ width: view.innerWidth, height: view.innerHeight }).toPNG())
          return { over, rowVisible: box.top >= 0 && box.bottom <= view.innerHeight, value: input.value, nativeRow: !!row.querySelector('.setting-item-info') && !!row.querySelector('.setting-item-control'), mobile: !!app.isMobile, width: view.innerWidth, height: view.innerHeight, shot }
        } finally {
          app.setting.close()
          config.ai = saved
          config.version.value++
        }
      })()`)
      expect(result.mobile).toBe(mobile)
      expect(result.width).toBe(size[0])
      expect(result.height).toBe(size[1])
      expect(result.over).toEqual([])
      expect(result.rowVisible).toBe(true)
      expect(result.nativeRow).toBe(true)
      expect(result.value).toBe(
        state === 'empty' ? '' : 'SampleClient/1.0 compatible-model-connection-with-a-long-name'
      )
    }
  })
})
