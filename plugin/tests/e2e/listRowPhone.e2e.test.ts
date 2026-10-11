import { expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { measureDesign } from './helpers/designLint'
import { shotDir } from './helpers/shots'

const directory = process.env.DESIGN_LINT_OUT_DIR ?? shotDir('design-lint')

it('keeps row glyphs on the title line inside phone-sized action hit boxes', async () => {
  const layout = evalJson<unknown>('app.workspace.getLayout()')
  const size = evalJson<[number, number]>(
    "require('@electron/remote').getCurrentWindow().getContentSize()"
  )
  const owned: string[] = []
  try {
    await reloadApp('app.emulateMobile(true)')
    evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
    for (const [path, text] of [
      ['sample-phone-row-target.md', 'Sample row target.'],
      ['sample-phone-row-source.md', '[[sample-phone-row-target]]'],
    ]) {
      expect(
        await evalLong(`(async () => {
          const path = ${JSON.stringify(path)}
          if (app.vault.getAbstractFileByPath(path)) throw Error('Row fixture already exists')
          await app.vault.create(path, ${JSON.stringify(text)})
          return 'created'
        })()`)
      ).toBe('created')
      owned.push(path)
    }
    expect(
      await evalLong(`(async () => {
        const leaf = app.workspace.getLeaf('tab')
        await leaf.setViewState({ type: 'backlink', state: { file: 'sample-phone-row-target.md' }, active: true })
        app.workspace.leftSplit.collapse()
        app.workspace.rightSplit.collapse()
        const deadline = Date.now() + 10000
        while (!leaf.view.containerEl.querySelector('.search-result-file-title')) {
          if (Date.now() > deadline) throw Error('Native row reference did not render')
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        window.__abeleTest.openDesignCatalogue('rows', 'disclosed')
        await new Promise(resolve => setTimeout(resolve, 500))
        await document.fonts.ready
        return 'opened'
      })()`)
    ).toBe('opened')
    const report = await measureDesign(
      '.abele-design-catalogue',
      `${directory}/phone-rows`,
      {
        nativeSelector:
          '.backlink-pane > .tree-item-self, .backlink-pane .search-result-file-title',
      },
      { requireNative: true }
    )
    expect(report.snapshot.viewport).toEqual({ width: 390, height: 844 })
    expect(report.snapshot.mobile).toBe(true)
    expect(report.violations, `See ${report.directory}/annotated.png and report.json`).toEqual([])
    const actions = report.snapshot.elements.filter(
      (element) =>
        element.role === 'control' &&
        !!element.row &&
        (element.selector.includes('abele-obsidian-icon') ||
          element.selector.includes('abele-disclosure__control'))
    )
    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) {
      expect(action.rect.width, action.selector).toBeGreaterThanOrEqual(44)
      expect(action.rect.height, action.selector).toBeGreaterThanOrEqual(44)
    }
  } finally {
    try {
      await evalLong(`(async () => {
        window.__abeleTest.closeDesignCatalogue()
        await app.workspace.changeLayout(${JSON.stringify(layout)})
        for (const path of ${JSON.stringify(owned)}) {
          const file = app.vault.getAbstractFileByPath(path)
          if (file) await app.vault.delete(file)
        }
        return 'restored'
      })()`)
    } finally {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
      )
      await reloadApp('app.emulateMobile(false)')
    }
  }
})
