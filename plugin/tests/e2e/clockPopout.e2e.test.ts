import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'

it('keeps an elapsed label ticking in a real popout document', () => {
  const result = evalAsync<{ popout: boolean; before: string; after: string }>(
    `(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const until = async fn => {
      const end = Date.now() + 10000
      while (Date.now() < end) { const value = fn(); if (value) return value; await wait(50) }
      throw new Error('The popout clock did not become ready')
    }
    const folder = 'SampleClockPopout'
    if (app.vault.getAbstractFileByPath(folder)) throw new Error('Fixture folder already exists')
    const layout = app.workspace.getLayout()
    const main = app.workspace.getLeaf('tab')
    let pop, file
    try {
      await app.vault.createFolder(folder)
      const start = new Date(Date.now() - 5000).toISOString()
      file = await app.vault.create(folder + '/sample-entry.md', '---\\ntype: time-entry\\nstart: "' + start + '"\\n---\\n')
      pop = app.workspace.openPopoutLeaf()
      await pop.setViewState({ type: 'abele-time-tracking-sidebar-view', active: true })
      app.workspace.setActiveLeaf(pop, { focus: true })
      const root = await until(() => pop.view.containerEl.querySelector('.abele-time-tracking-sidebar'))
      const label = await until(() => root.querySelector('.abele-time-tracking-sidebar__active-elapsed'))
      label.scrollIntoView({ block: 'center' })
      if (label.ownerDocument.hidden) throw new Error('The popout document is hidden')
      const before = label.textContent.trim()
      const after = await until(() => {
        const text = label.textContent.trim()
        return text !== before ? text : null
      })
      return { popout: label.ownerDocument !== document, before, after }
    } finally {
      app.workspace.setActiveLeaf(main, { focus: true })
      pop?.detach()
      main.detach()
      if (file && app.vault.getAbstractFileByPath(file.path) === file) await app.vault.delete(file)
      const fixture = app.vault.getAbstractFileByPath(folder)
      if (fixture) await app.vault.delete(fixture, true)
      await app.workspace.changeLayout(layout)
    }
  })()`,
    60_000
  )
  expect(result.popout).toBe(true)
  expect(result.before).toMatch(/^\d+:\d{2}:\d{2}$/)
  expect(result.after).not.toBe(result.before)
}, 70_000)
