/** Live characterization: real books/PDFs, close/unload/reload and forced-GC heap samples.
 * No timing/heap budget and no automatic registration-engine rewrite follow from this diagnostic.
 */
import { expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evalLong, reloadApp } from './helpers/obsidianCli'
import { WAIT_PRELUDE } from './helpers/wait'
import { shotDir } from './helpers/shots'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildLongPdf } from '../fixtures/books/pdfFixture'

it('records retained reader heap after real EPUB/PDF cycles and plugin reloads', async () => {
  await reloadApp()
  const result = JSON.parse(
    await evalLong(
      `(async () => {
    ${WAIT_PRELUDE}
    const dir = 'Sample reader retention'
    const savedLayout = JSON.parse(JSON.stringify(app.workspace.getLayout()))
    const savedReader = JSON.parse(JSON.stringify(window.__abeleTest.AbeleConfig.getInstance().reader))
    const cdp = require('@electron/remote').getCurrentWebContents().debugger
    const attached = cdp.isAttached()
    if (!attached) cdp.attach('1.3')
    const originalDefine = customElements.define
    const names = []
    customElements.define = function(name, ...args) {
      names.push(name)
      return originalDefine.call(this, name, ...args)
    }
    const samples = []
    const sample = async (stage) => {
      await cdp.sendCommand('HeapProfiler.collectGarbage')
      const heap = await cdp.sendCommand('Runtime.getHeapUsage')
      const dom = await cdp.sendCommand('Memory.getDOMCounters')
      const result = { stage, usedHeapBytes: heap.usedSize, totalHeapBytes: heap.totalSize,
        readers: app.workspace.getLeavesOfType('abele-book').length,
        frames: document.querySelectorAll('iframe').length,
        retainedReaderRegistrations: names.filter(n => /^(foliate-|abele-pdf-)/.test(n) && customElements.get(n)).length,
        dom }
      samples.push(result)
      return result
    }
    const visit = async (path, sections) => {
      const config = window.__abeleTest.AbeleConfig.getInstance()
      config.reader = { ...config.reader, pdfInReader: true }
      const leaf = app.workspace.getLeaf('tab')
      try {
        await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
        if (!await until(() => leaf.view.model?.status === 'ready' && leaf.view.engine, 20000)) throw Error('reader not ready: ' + path)
        for (let index = 0; index < sections; index++) {
          await leaf.view.engine.goTo(index)
          if (!await until(() => leaf.view.engine?.renderer.getContents().some(c =>
            (c.index ?? (leaf.view.fixed ? leaf.view.engine.lastLocation?.section?.current : undefined)) === index &&
            c.doc?.body && (!path.endsWith('.pdf') || (c.doc.querySelector('#canvas img')?.complete && c.doc.querySelector('#canvas img')?.naturalWidth > 0))), 15000)) throw Error('section not drawn: ' + JSON.stringify({ path, index, status: leaf.view.model.status, hidden: document.hidden, renderer: leaf.view.engine.renderer.getBoundingClientRect().toJSON(), contents: leaf.view.engine.renderer.getContents().map(c => ({ index: c.index, body: !!c.doc?.body })), last: leaf.view.engine.lastLocation }))
        }
        await sample('open:' + path)
      } finally { leaf.detach() }
      if (!await until(() => !app.workspace.getLeavesOfType('abele-book').length, 10000)) throw Error('reader leaf remained')
    }
    try {
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)
      await app.vault.createBinary(dir + '/sample.epub', Uint8Array.from(atob(${JSON.stringify(Buffer.from(buildRichEpub()).toString('base64'))}), c => c.charCodeAt(0)).buffer)
      await app.vault.createBinary(dir + '/sample.pdf', Uint8Array.from(atob(${JSON.stringify(Buffer.from(buildLongPdf(12)).toString('base64'))}), c => c.charCodeAt(0)).buffer)
      await sample('baseline')
      // Control: the whole development bundle may be retained on reload independently of
      // opening a book. Do not attribute its heap delta to reader constructors alone.
      await app.plugins.disablePlugin('abele')
      await sample('control-unloaded')
      await app.plugins.enablePlugin('abele')
      await sample('control-reloaded-no-book')
      for (let cycle = 0; cycle < 3; cycle++) {
        await visit(dir + '/sample.epub', 3)
        await sample('closed:' + dir + '/sample.epub')
        await visit(dir + '/sample.pdf', 6)
        await sample('closed:' + dir + '/sample.pdf')
        await app.plugins.disablePlugin('abele')
        await sample('unloaded:' + cycle)
        await app.plugins.enablePlugin('abele')
        if (!await until(() => typeof window.__abeleTest?.reader === 'object', 15000)) throw Error('test reader API did not return')
        await sample('reloaded:' + cycle)
      }
      return { samples }
    } catch (error) { return { samples, error: String(error.stack || error) } }
    finally {
      customElements.define = originalDefine
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      if (!app.plugins.plugins.abele) await app.plugins.enablePlugin('abele')
      window.__abeleTest.AbeleConfig.getInstance().reader = savedReader
      const folder = app.vault.getAbstractFileByPath(dir)
      if (folder) await app.vault.delete(folder, true)
      await app.workspace.changeLayout(savedLayout)
      if (!attached && cdp.isAttached()) cdp.detach()
    }
  })()`,
      240000
    )
  )
  writeFileSync(join(shotDir('reader-retention'), 'samples.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  // Release the experiment's platform registry and development-module closures afterward.
  await reloadApp()
  expect(result.error).toBeUndefined()
  expect(
    result.samples.filter((s: { stage: string }) => s.stage.startsWith('closed:'))
  ).toHaveLength(6)
  for (const sample of result.samples.filter((s: { stage: string }) =>
    s.stage.startsWith('closed:')
  )) {
    expect(sample.readers).toBe(0)
    expect(sample.usedHeapBytes).toBeGreaterThan(0)
  }
}, 300000)
