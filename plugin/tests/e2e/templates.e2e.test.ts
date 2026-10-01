/** Real metadata, YAML parsing and the automatic create hook, using synthetic notes only. */
import { afterAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('templates')
let emulated = false
let size: number[] | undefined

const probe = (label: string) => String.raw`(async () => {
  const api = window.__abeleTest
  const config = api.AbeleConfig.getInstance()
  const service = api.TemplateService.getInstance()
  const folder = 'Sample template probe'
  if (app.vault.getAbstractFileByPath(folder)) throw Error('probe folder already exists')
  if (service.getDefaultTemplate()) throw Error('probe requires a vault without a default template')
  const previousTemplate = config.transactionTemplatePath
  const previousLeaf = app.workspace.activeLeaf
  const previousState = previousLeaf?.getViewState()
  const read = app.vault.read
  const apply = service.applyDefaultTemplate
  let leaf, release
  const report = {}
  const until = async (fn, label) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const value = fn()
      if (value) return value
      await new Promise(r => setTimeout(r, 50))
    }
    throw Error('not ready: ' + label)
  }
  const create = async (name, body) => {
    const file = await app.vault.create(folder + '/' + name + '.md', body)
    await until(() => app.metadataCache.getFileCache(file), name + ' metadata')
    return file
  }
  try {
    await app.vault.createFolder(folder)
    const required = await create('Sample required template', '---\ntype: template\ntemplate_for: default\ntemplate_for_topic: "{{Topic}}"\n---\nDefault body')
    const untouched = await create('Sample untouched', 'Untouched body')
    report.requiredApplied = await service.applyDefaultTemplate(untouched)
    report.untouched = await app.vault.read(untouched)
    await app.vault.delete(required)
    await until(() => !service.getDefaultTemplate(), 'required template removed')

    const merge = await create('Sample merge template', '---\ntype: template\ntemplate_for: sample\ntarget_folder: ' + folder + '\ntarget_name: Sample merged\nlabels:\n  - old\ntemplate_for_labels:\n  - new\n---\nSample merged body')
    const merged = await service.createNoteFromTemplate(api.UserTemplate.fromFile(merge), new Map())
    await until(() => app.metadataCache.getFileCache(merged)?.frontmatter, 'merged metadata')
    report.labels = app.metadataCache.getFileCache(merged).frontmatter.labels
    report.mergedText = await app.vault.read(merged)
    report.labelKeyCount = (report.mergedText.match(/^labels:/gm) || []).length

    const transaction = await create('Sample transaction template', '---\ntype: template\ntemplate_for: transaction\n---\nStale sample body')
    await create('Sample existing', 'Existing body')
    config.transactionTemplatePath = transaction.path
    const instance = new api.TransactionNoteTemplate(app)
    await instance.createNoteWithTemplate({ transactionName: 'Sample existing', transactionFolder: folder }, false)
    await instance.createNoteWithTemplate({ transactionName: 'Sample explicit', transactionFolder: folder, content: 'Explicit sample body' }, false)
    report.transaction = await app.vault.read(app.vault.getFileByPath(folder + '/Sample explicit.md'))

    const automatic = await create('Sample automatic template', '---\ntype: template\ntemplate_for: default\n---\nAutomatic body')
    const racePath = folder + '/Sample concurrent.md'
    if (config.isPathExcludedFromDefaultTemplate(racePath) || config.journals.some(j => j.checkIfNotePathIsJournal(racePath)))
      throw Error('probe path excluded from automatic defaults')
    let reading = false, done = false, inHook = false, hookError
    const held = new Promise(r => { release = r })
    app.vault.read = async function(file) {
      if (inHook && file.path === automatic.path) { reading = true; await held }
      return read.call(this, file)
    }
    service.applyDefaultTemplate = async function(file, ...args) {
      if (file.path === racePath) inHook = true
      try { return await apply.call(this, file, ...args) }
      catch (e) { hookError = String(e); throw e }
      finally { if (file.path === racePath) done = true }
    }
    const concurrent = await app.vault.create(racePath, '')
    await until(() => reading, 'automatic hook template read')
    await app.vault.modify(concurrent, 'Concurrent sample body')
    release()
    await until(() => done, 'automatic hook completion')
    if (hookError) throw Error(hookError)
    report.concurrent = await app.vault.read(concurrent)
    app.vault.read = read
    service.applyDefaultTemplate = apply

    leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(merged, { state: { mode: 'preview' } })
    app.workspace.setActiveLeaf(leaf, { focus: true })
    await until(() => leaf.view.containerEl.textContent.includes('Sample merged body'), 'merged note drawn')
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('window is not drawing')), 5000)
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); resolve() }))
    })
    const path = ${JSON.stringify(shots)} + '/' + ${JSON.stringify(label)} + '.png'
    if (window.__e2eHost) await window.__e2eHost.shot(path)
    else {
      const fs = require('fs')
      fs.mkdirSync(${JSON.stringify(shots)}, { recursive: true })
      const image = await require('@electron/remote').getCurrentWebContents().capturePage()
      fs.writeFileSync(path, image.toPNG())
    }
    return report
  } finally {
    release?.()
    app.vault.read = read
    service.applyDefaultTemplate = apply
    config.transactionTemplatePath = previousTemplate
    if (leaf === previousLeaf && previousState) await leaf.setViewState(previousState)
    else leaf?.detach()
    if (previousLeaf) app.workspace.setActiveLeaf(previousLeaf, { focus: true })
    const scratch = app.vault.getAbstractFileByPath(folder)
    if (scratch) await app.vault.delete(scratch, true)
  }
})()`

async function check(label: string) {
  const output = await evalLong(probe(label))
  if (output.startsWith('Error:')) throw new Error(output)
  const result = JSON.parse(output)
  expect(result.requiredApplied).toBe(false)
  expect(result.untouched).toBe('Untouched body')
  expect(result.labels).toEqual(['new'])
  expect(result.labelKeyCount).toBe(1)
  expect(result.mergedText).toContain('Sample merged body')
  expect(result.transaction).toContain('Explicit sample body')
  expect(result.transaction).not.toContain('Stale sample body')
  expect(result.concurrent).toBe('Concurrent sample body')
}

describe.skipIf(!available)('template regressions in the live vault', () => {
  afterAll(async () => {
    if (emulated) await reloadApp('app.emulateMobile(false)')
    if (size)
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
      )
  })

  it('preserves input and merges valid properties through the real vault', async () => {
    await check(onPhone() ? 'phone' : 'desktop')
  }, 90_000)

  it.skipIf(onPhone())(
    'shows the resulting note under phone emulation',
    async () => {
      size = evalJson<number[]>("require('@electron/remote').getCurrentWindow().getContentSize()")
      emulated = true
      await reloadApp('app.emulateMobile(true)')
      evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
      await check('emulated')
    },
    90_000
  )
})
