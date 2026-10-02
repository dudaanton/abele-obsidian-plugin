import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { WAIT_PRELUDE } from './helpers/wait'
import { buildLongPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'sample-review-live'
const OUT = resolve(__dirname, '../../build/review-live')
let probe = 0
const run = <T>(body: string): T => {
  const script = `(async () => {
  ${WAIT_PRELUDE}
  const state = window.__sampleMiscReview
  const cfg = window.__abeleTest.AbeleConfig.getInstance()
  const delay = (ms) => new Promise((done) => setTimeout(done, ms))
  const ready = async (fn, label) => {
    const result = await until(fn, 12000)
    if (!result) throw Error('Not ready: ' + label)
    return result
  }
  try { ${body} } catch (error) { return { error: String(error.stack || error) } }
})()`
  writeFileSync(resolve(OUT, `probe-${++probe}.js`), script)
  new Function('return ' + script)
  // Keep quoted DOM selectors and escaped script text intact through the CLI argument parser.
  return evalAsync<T>(`eval(atob('${Buffer.from(script).toString('base64')}'))`, 44000)
}

interface MemorySample {
  heap: number
  images: number
  decoded: number
  frames: number
  alive: number
  blobs: number
}
const measure = `
  const remote = require('@electron/remote')
  const cdp = remote.getCurrentWebContents().debugger
  if (!cdp.isAttached()) { cdp.attach('1.3'); state.attached = true }
  await cdp.sendCommand('HeapProfiler.collectGarbage')
  await delay(200)
  const usage = require('electron').webFrame.getResourceUsage()
  const bounds = state.view.contentEl.getBoundingClientRect()
  const picture = await remote.getCurrentWebContents().capturePage({ x: Math.round(bounds.left), y: Math.round(bounds.top), width: Math.round(bounds.width), height: Math.round(bounds.height) })
  state.capture = (state.capture || 0) + 1
  require('fs').writeFileSync(${JSON.stringify(OUT)} + '/sample-pdf-' + state.capture + '.png', picture.toPNG())
  const sample = {
    heap: performance.memory?.usedJSHeapSize || 0,
    decoded: usage.images.liveSize,
    images: [...state.urls.values()].filter((value) => value.type === 'image/png').length,
    blobs: [...state.urls.values()].reduce((bytes, value) => bytes + value.size, 0),
    frames: state.view.engine.renderer.getContents().length,
    alive: [...state.documents].filter((reference) => reference.deref()).length,
  }
`

const pageReady = `
  const pageReady = async (index) => ready(() => {
    const renderer = state.view.engine.renderer
    if (renderer.index !== index) return false
    const current = renderer.getContents().find((content) => content.index === index)
    const image = current?.doc.querySelector('#canvas img')
    const frame = current?.doc.defaultView?.frameElement?.getBoundingClientRect()
    return image?.complete && image.naturalWidth && frame?.width && frame.height
  }, 'PDF page ' + index)
`

describe.skipIf(!available)('miscellaneous review fixes in the running app', () => {
  beforeAll(() => {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(resolve(OUT, 'sample-long.pdf'), buildLongPdf(300))
    const result = run<{ ok?: boolean; error?: string }>(`
      const store = window.__abeleTest.secrets()
      window.__sampleMiscReview = {
        settings: cfg.exportSettings(), layout: app.workspace.getLayout(),
        get: store.get, set: store.set, values: new Map([
          ['abele-sample-review-first', 'first value'], ['abele-sample-review-second', 'second value'],
        ]), files: new Map(), documents: new Set(), urls: new Map(),
      }
      const saved = window.__sampleMiscReview
      const places = cfg.reader.placesPath || 'abele-book-places.json'
      const backup = (app.plugins.plugins.abele.manifest.dir || app.vault.configDir + '/plugins/abele') + '/book-places.backup.json'
      for (const path of [places, backup]) saved.files.set(path, await app.vault.adapter.exists(path) ? await app.vault.adapter.read(path) : null)
      store.get = function (id) { return saved.values.has(id) ? saved.values.get(id) : saved.get.call(this, id) }
      store.set = function (id, value) { if (saved.values.has(id)) saved.values.set(id, value); else saved.set.call(this, id, value) }
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (old) throw Error('Sample review directory already exists')
      await app.vault.createFolder(${JSON.stringify(DIR)})
      cfg.automations = []
      cfg.ai = { ...cfg.ai, enabled: true, scriptsEnabled: false, providers: [], imageProviders: [], secrets: [
        { id: 'sample-first', name: 'Sample first', keyId: 'abele-sample-review-first' },
        { id: 'sample-second', name: 'Sample second', keyId: 'abele-sample-review-second' },
      ] }
      await cfg.saveSettings()
      return { ok: true }
    `)
    expect(result).toEqual({ ok: true })
  })

  afterAll(() => {
    const result = run<{ ok?: boolean; error?: string }>(`
      if (!state) return { ok: true }
      app.setting.close()
      state.leaf?.detach()
      if (state.create) URL.createObjectURL = state.create
      if (state.revoke) URL.revokeObjectURL = state.revoke
      await delay(1000)
      const store = window.__abeleTest.secrets()
      store.get = state.get; store.set = state.set
      cfg.applySettings(state.settings)
      await cfg.saveSettings()
      const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (dir) await app.vault.delete(dir, true)
      await app.workspace.changeLayout(state.layout)
      await delay(1200)
      for (const [path, text] of state.files) {
        if (text === null) { if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path) }
        else await app.vault.adapter.write(path, text)
      }
      if (state.attached) require('@electron/remote').getCurrentWebContents().debugger.detach()
      delete window.__sampleMiscReview
      return { ok: true }
    `)
    expect(result).toEqual({ ok: true })
  })

  it('keeps a secret draft with its record during a real external-settings reload', () => {
    const result = run<{ correct?: boolean; masked?: boolean; closed?: boolean; error?: string }>(`
      app.setting.open(); app.setting.openTabById('abele')
      const d = await ready(() => app.setting.activeTab?.containerEl?.ownerDocument, 'settings document')
      const qa = (selector) => [...d.querySelectorAll(selector)]
      await ready(() => qa('.abele-settings__nav .abele-tabs__tab').find((tab) => tab.textContent.includes('AI Agent')), 'AI settings tab')
        .then((tab) => tab.click())
      await ready(() => qa('.abele-ai-settings__tabs .abele-tabs__tab').find((tab) => tab.textContent.trim() === 'General'), 'general tab')
        .then((tab) => tab.click())
      const card = (name) => qa('.abele-card').find((row) => row.querySelector('.abele-card__name')?.textContent.trim() === name)
      const first = await ready(() => card('Sample first'), 'first secret')
      first.click()
      const field = await ready(() => card('Sample first')?.querySelector('input[placeholder="Value..."]'), 'key editor')
      field.value = 'first draft'; field.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }))
      card('Sample first').querySelector('[aria-label="Reveal"]')?.click()
      const incoming = cfg.exportSettings()
      incoming.ai.secrets = [incoming.ai.secrets[1], incoming.ai.secrets[0]]
      await app.plugins.plugins.abele.saveData(incoming)
      await app.plugins.plugins.abele.onExternalSettingsChange()
      await ready(() => card('Sample first')?.querySelector('input[placeholder="Value..."]')?.value === 'first draft', 'identity-bound draft after reorder')
      card('Sample first').querySelector('input[placeholder="Value..."]').scrollIntoView({ block: 'center' })
      await delay(200)
      const remote = require('@electron/remote')
      const settingsWindow = remote.BrowserWindow.getAllWindows().find((win) => win.getTitle().startsWith('Settings - ' + app.vault.getName() + ' - '))
      if (settingsWindow) require('fs').writeFileSync(${JSON.stringify(resolve(OUT, 'sample-secret-reorder.png'))}, (await settingsWindow.webContents.capturePage()).toPNG())
      ;[...card('Sample first').querySelectorAll('button')].find((button) => button.textContent.trim() === 'Save').click()
      await ready(() => state.values.get('abele-sample-review-first') === 'first draft', 'key save')
      const correct = state.values.get('abele-sample-review-second') === 'second value'
      card('Sample first').click()
      const removed = cfg.exportSettings()
      removed.ai.secrets = removed.ai.secrets.filter((secret) => secret.id !== 'sample-first')
      await app.plugins.plugins.abele.saveData(removed)
      await app.plugins.plugins.abele.onExternalSettingsChange()
      await ready(() => !d.querySelector('.abele-ai-secret__editor'), 'removed editor closed')
      const closed = !d.querySelector('.abele-ai-secret__editor')
      card('Sample second').click()
      await ready(() => card('Sample second')?.querySelector('input[type="password"]'), 'second key remains masked')
      const masked = card('Sample second').querySelector('input[type="password"]').value === 'second value'
      app.setting.close()
      await delay(650)
      return { correct, masked, closed }
    `)
    expect(result).toEqual({ correct: true, masked: true, closed: true })
  })

  it('keeps global and agent script modes after a real script-subfolder rename', () => {
    const result = run<{ indexed?: boolean; global?: string; agent?: string; error?: string }>(`
      const folder = ${JSON.stringify(DIR)} + '/Scripts'
      await app.vault.createFolder(folder + '/Utilities')
      await app.vault.create(folder + '/Utilities/sample.js', ${JSON.stringify('// @name Sample helper\nreturn 1\n')})
      cfg.ai = { ...cfg.ai, scriptsEnabled: true, scriptsFolder: folder, toolModes: { ...cfg.ai.toolModes, 'script_sample-helper': 'auto' } }
      const agent = cfg.ai.agents[0]
      if (!agent) throw Error('No sample agent baseline')
      agent.toolModes = { ...agent.toolModes, 'script_sample-helper': 'ask' }
      await cfg.saveSettings()
      const service = window.__abeleTest.ScriptService.getInstance()
      await ready(() => service.getAll().some((script) => script.path === folder + '/Utilities/sample.js'), 'initial script discovery')
      await app.vault.rename(app.vault.getAbstractFileByPath(folder + '/Utilities'), folder + '/Helpers')
      await ready(() => service.getAll().some((script) => script.path === folder + '/Helpers/sample.js') && !service.getAll().some((script) => script.path === folder + '/Utilities/sample.js'), 'renamed script discovered')
      return { indexed: true, global: cfg.ai.toolModes['script_sample-helper'], agent: cfg.ai.agents[0].toolModes['script_sample-helper'] }
    `)
    expect(result).toEqual({ indexed: true, global: 'auto', agent: 'ask' })
  })

  it('keeps a long PDF memory footprint bounded while paging through the real scroll renderer', () => {
    const start = run<MemorySample & { error?: string }>(`
      state.create = URL.createObjectURL; state.revoke = URL.revokeObjectURL
      URL.createObjectURL = function (blob) {
        const url = state.create.call(this, blob)
        if (['image/png', 'text/html'].includes(blob.type)) state.urls.set(url, { type: blob.type, size: blob.size })
        return url
      }
      URL.revokeObjectURL = function (url) { state.urls.delete(url); return state.revoke.call(this, url) }
      cfg.reader = { ...cfg.reader, pdfLayout: 'scrolled', pdfZoom: 'fit-width' }
      await cfg.saveSettings()
      const bytes = Uint8Array.from(require('fs').readFileSync(${JSON.stringify(resolve(OUT, 'sample-long.pdf'))}))
      const path = ${JSON.stringify(DIR)} + '/sample-long.pdf'
      await app.vault.createBinary(path, bytes.buffer)
      app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse()
      state.leaf = app.workspace.getLeaf('tab')
      await state.leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
      state.view = state.leaf.view
      await ready(() => state.view.model.status === 'ready', 'PDF ready')
      state.view.engine.renderer.addEventListener('load', (event) => state.documents.add(new WeakRef(event.detail.doc)))
      for (const content of state.view.engine.renderer.getContents()) state.documents.add(new WeakRef(content.doc))
      ${pageReady}
      await state.view.engine.renderer.goTo({ index: 0 })
      await pageReady(0)
      await delay(400)
      ${measure}
      return sample
    `)
    expect(start.error).toBeUndefined()
    for (let batch = 0; batch < 10; batch++) {
      const result = run<{ ok?: boolean; error?: string }>(`
        ${pageReady}
        for (let index = ${batch * 30}; index < ${batch * 30 + 30}; index += 5) {
          await state.view.engine.renderer.goTo({ index })
          await pageReady(index)
        }
        return { ok: true }
      `)
      expect(result).toEqual({ ok: true })
    }
    const end = run<MemorySample & { error?: string }>(`
      await delay(400)
      ${measure}
      return sample
    `)
    expect(end.error).toBeUndefined()
    console.log('PDF memory before/after paging', JSON.stringify({ start, end }))
    writeFileSync(resolve(OUT, 'sample-pdf-memory.json'), JSON.stringify({ start, end }, null, 2))
    expect(end.images).toBeLessThanOrEqual(end.frames + 2)
    expect(end.alive).toBeLessThanOrEqual(end.frames + 5)
    const closed = run<{ images?: number; urls?: number; error?: string }>(`
      state.leaf.detach(); state.leaf = null
      await delay(300)
      return { images: [...state.urls.values()].filter((row) => row.type === 'image/png').length, urls: state.urls.size }
    `)
    expect(closed).toEqual({ images: 0, urls: 0 })
  })
})
