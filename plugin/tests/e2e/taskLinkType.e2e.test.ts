import { afterAll, describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const folder = 'Sample checklist type probe'
const shots = shotDir('task-link-type')

describe.runIf(isObsidianRunning() && hasTestApi())('linked checklist target types', () => {
  afterAll(async () => {
    await evalLong(`(async () => {
      const folder = app.vault.getAbstractFileByPath(${JSON.stringify(folder)})
      if (folder) await app.vault.delete(folder, true)
      return 'ok'
    })()`)
  })

  it('keeps ordinary links native, preserves task cards, and updates indexed type changes', async () => {
    const report = JSON.parse(
      await evalLong(
        String.raw`(async () => {
      const folder = ${JSON.stringify(folder)}
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const until = async fn => {
        for (let i = 0; i < 100; i++) { if (fn()) return; await wait(100) }
        throw new Error('Checklist render did not settle')
      }
      await app.vault.createFolder(folder)
      const task = await app.vault.create(folder + '/Sample task.md', '---\ntype: task\n---\nSample task\n')
      const note = await app.vault.create(folder + '/Sample note.md', '---\ntype: note\n---\nSample note\n')
      const source = await app.vault.create(folder + '/Sample source.md',
        '- [ ] [[' + folder + '/Sample task]]\n- [ ] [[' + folder + '/Sample note]]\n\nEnd\n')
      await until(() => app.metadataCache.getFileCache(task)?.frontmatter?.type === 'task' &&
        app.metadataCache.getFileCache(note)?.frontmatter?.type === 'note')
      const leaf = app.workspace.getLeaf(false)
      await leaf.openFile(source, { state: { mode: 'source', source: false } })
      const view = leaf.view
      view.editor.setCursor({ line: 3, ch: 0 })
      const cards = () => view.containerEl.querySelectorAll('.abele-task-widget-container').length
      const native = () => [...view.containerEl.querySelectorAll('.HyperMD-task-line')].some(el => el.textContent.includes('Sample note'))
      await until(() => cards() === 1 && native())
      const capture = async label => {
        await wait(600)
        const path = ${JSON.stringify(shots)} + '/' + label + '.png'
        if (window.__e2eHost) await window.__e2eHost.shot(path)
        else {
          const win = require('@electron/remote').getCurrentWindow()
          require('fs').writeFileSync(path, (await win.webContents.capturePage()).toPNG())
        }
      }
      await capture(app.isMobile ? 'phone-links' : 'desktop-links')
      await app.fileManager.processFrontMatter(note, fm => { fm.type = 'task' })
      await until(() => cards() === 2)
      await app.fileManager.processFrontMatter(note, fm => { fm.type = 'note' })
      await until(() => cards() === 1 && native())
      await leaf.setViewState({ type: 'markdown', state: { file: source.path, mode: 'preview' } })
      await until(() => view.containerEl.querySelectorAll('li.task-list-item').length === 2)
      await capture(app.isMobile ? 'phone-reading' : 'desktop-reading')
      return JSON.stringify({ cards: true, ordinary: true, changed: true, reading: true })
    })()`,
        180_000
      )
    )
    expect(report).toEqual({ cards: true, ordinary: true, changed: true, reading: true })
  }, 240_000)
})
