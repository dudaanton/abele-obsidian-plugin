import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()

/** Exercise actual metadata, local storage and the shared review dialog, not a test-only gate. */
describe.skipIf(!available)('template confirmation in the live vault', () => {
  it('creates notes without executing, confirms locally, and asks again after an edit', async () => {
    const output = await evalLong(String.raw`(async () => {
      const api = window.__abeleTest
      const service = api.TemplateService.getInstance()
      const folder = 'Sample template trust probe'
      const key = 'abele-template-trust'
      const saved = app.loadLocalStorage(key)
      const execute = app.commands.executeCommandById
      const plugins = app.plugins.plugins
      const pluginId = 'sample-template-trust-plugin'
      const commandId = 'sample-template-trust-command'
      const oldPlugin = plugins[pluginId]
      const report = { commands: 0, methods: 0 }
      const until = async (fn) => {
        const deadline = Date.now() + 10000
        while (Date.now() < deadline) {
          const value = fn()
          if (value) return value
          await new Promise(r => setTimeout(r, 50))
        }
        throw Error('template probe timed out')
      }
      const dialog = () => document.querySelector('.modal.abele-script-review')
      const notice = () => [...document.querySelectorAll('.notice')].find(n => n.textContent.includes('Sample trust template'))
      const press = (text) => {
        const button = [...dialog().querySelectorAll('button')].find(b => b.textContent === text)
        if (!button) throw Error('missing review action: ' + text)
        button.click()
      }
      let templateFile
      const reviewHash = async () => {
        const template = api.UserTemplate.fromFile(templateFile)
        const text = await template.getContent(), body = await template.getBody(text)
        const settings = {
          template_for: template.templateFor,
          callbacks: template.callbacks,
          target_folder: template.targetFolder,
          target_name: template.targetName,
          target_properties: template.targetProperties,
        }
        const source = 'Template execution settings:\n' + JSON.stringify(settings, null, 2) + '\n\nPrepared template body:\n' + body + '\n\nFull template:\n' + text
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
        return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
      }
      const apply = async () => {
        const file = await service.createNoteFromTemplate(api.UserTemplate.fromFile(templateFile), new Map([['Input', 'safe']]))
        return { path: file.path, text: await app.vault.read(file) }
      }
      if (app.vault.getAbstractFileByPath(folder)) throw Error('probe folder already exists')
      if (oldPlugin) throw Error('probe plugin already exists')
      try {
        app.saveLocalStorage(key, null)
        api.ScriptTrust.reset()
        plugins[pluginId] = { convert: async () => { report.methods++; return 'executed' } }
        app.commands.executeCommandById = function(id) {
          if (id === commandId) { report.commands++; return true }
          return execute.call(this, id)
        }
        await app.vault.createFolder(folder)
        const text = '---\ntype: template\ntemplate_for: sample\ncallbacks: command:' + commandId + '\ntarget_folder: ' + folder + '\ntarget_name: Sample output\n---\n{{' + pluginId + ';convert;Input}}'
        templateFile = await app.vault.create(folder + '/Sample trust template.md', text)
        await until(() => app.metadataCache.getFileCache(templateFile)?.frontmatter?.callbacks)
        report.first = await apply()
        report.before = [report.commands, report.methods]
        report.notice = !!notice()?.querySelector('button')
        notice().querySelector('button').click()
        await until(dialog)
        report.title = dialog().querySelector('.modal-title').textContent
        report.shown = dialog().querySelector('.cm-content').textContent
        const firstHash = await reviewHash()
        press('Confirm')
        await until(() => app.loadLocalStorage(key)?.scripts?.[templateFile.path]?.hash === firstHash)
        report.afterReview = [report.commands, report.methods]
        // Same device reload: approvals come from host-local storage, not session memory.
        api.ScriptTrust.reset()
        report.confirmed = await apply()
        report.afterConfirmed = [report.commands, report.methods]
        await app.vault.modify(templateFile, text + '\nChanged sample body')
        report.edited = await apply()
        report.afterEdit = [report.commands, report.methods]
        notice().querySelector('button').click()
        await until(dialog)
        report.diff = dialog().querySelector('.abele-script-review__code').textContent
        press('Not now')
        await until(() => !dialog())
        report.waiting = await apply()
        report.afterDeclined = [report.commands, report.methods]
        report.reviewStillAvailable = !!notice()?.querySelector('button')
        notice().querySelector('button').click()
        await until(dialog)
        const changedHash = await reviewHash()
        if (changedHash === firstHash) throw Error('template edit did not change the reviewed hash')
        press('Confirm')
        await until(() => app.loadLocalStorage(key)?.scripts?.[templateFile.path]?.hash === changedHash)
        await until(() => !notice())
        report.afterDeferredReview = [report.commands, report.methods]
        await apply()
        report.afterDeferredUse = [report.commands, report.methods]
        return report
      } finally {
        if (dialog()?.querySelector('.modal-title')?.textContent.includes('Sample trust template')) press('Not now')
        document.querySelectorAll('.notice').forEach(n => {
          if (n.textContent.includes('Sample trust template')) n.remove()
        })
        app.commands.executeCommandById = execute
        delete plugins[pluginId]
        app.saveLocalStorage(key, saved ?? null)
        api.ScriptTrust.reset()
        const scratch = app.vault.getAbstractFileByPath(folder)
        if (scratch) await app.vault.delete(scratch, true)
      }
    })()`)
    if (output.startsWith('Error:')) throw new Error(output)
    const report = JSON.parse(output)
    expect(report.first.text).toContain('safe')
    expect(report.before).toEqual([0, 0])
    expect(report.notice).toBe(true)
    expect(report.title).toContain('Confirm template')
    expect(report.shown).toContain('sample-template-trust-command')
    expect(report.afterReview).toEqual([0, 0])
    expect(report.confirmed.text).toContain('executed')
    expect(report.afterConfirmed).toEqual([1, 1])
    expect(report.edited.text).toContain('Changed sample body')
    expect(report.afterEdit).toEqual([1, 1])
    expect(report.diff).toContain('Changed sample body')
    expect(report.waiting.text).toContain('safe')
    expect(report.afterDeclined).toEqual([1, 1])
    expect(report.reviewStillAvailable).toBe(true)
    expect(report.afterDeferredReview).toEqual([1, 1])
    expect(report.afterDeferredUse).toEqual([2, 2])
  }, 90_000)
})
