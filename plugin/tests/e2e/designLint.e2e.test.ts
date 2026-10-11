import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { measureDesign, type DesignReport } from './helpers/designLint'
import { shotDir } from './helpers/shots'

import { DESIGN_CASES } from './helpers/designCatalogueCases'
const directory = process.env.DESIGN_LINT_OUT_DIR ?? shotDir('design-lint')
const referenceTarget = 'sample-design-reference-target.md'
const referenceSource = 'sample-design-reference-source.md'
const nativeSelector = '[data-design-lint-reference] .backlink-pane .tree-item-self'
describe('kit catalogue live design contract', () => {
  beforeAll(async () => {
    const result = await evalLong(`(async () => {
      const paths = ${JSON.stringify([referenceTarget, referenceSource])}
      if (paths.some(path => app.vault.getAbstractFileByPath(path))) throw new Error('Design reference fixture already exists')
      const explorerLeaves = app.workspace.getLeavesOfType('file-explorer')
      const readyExplorer = async leaf => {
        await leaf.loadIfDeferred()
        const deadline = Date.now() + 10000
        while (!leaf.view.fileItems || !leaf.view.navFileContainerEl || !Object.keys(leaf.view.fileItems).length) {
          if (Date.now() > deadline) throw new Error('Native file explorer did not initialize')
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      for (const leaf of explorerLeaves) await readyExplorer(leaf)
      const explorers = explorerLeaves.map(leaf => ({
        id: leaf.id,
        folds: Object.values(leaf.view.fileItems).filter(item => item.file.children).map(item => [item.file.path, item.collapsed]),
        scrollTop: leaf.view.navFileContainerEl.scrollTop,
      }))
      const state = window.__designLintReference = { layout: app.workspace.getLayout(), explorers, owned: [] }
      for (const [path, text] of [[paths[0], 'Sample reference target.'], [paths[1], '[[sample-design-reference-target]]']]) {
        await app.vault.create(path, text)
        state.owned.push(path)
      }
      const leaf = app.workspace.getRightLeaf(true)
      await leaf.setViewState({ type: 'backlink', state: { file: paths[0], backlinkCollapsed: false, unlinkedCollapsed: true, collapseAll: false } })
      leaf.view.containerEl.setAttribute('data-design-lint-reference', '')
      app.workspace.rightSplit.expand()
      await app.workspace.revealLeaf(leaf)
      const deadline = Date.now() + 10000
      while (!leaf.view.containerEl.querySelector('.search-result-file-title')) {
        if (Date.now() > deadline) throw new Error('Native Backlinks fixture did not render')
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      return 'ready'
    })()`)
    expect(result).toBe('ready')
  })
  afterAll(async () => {
    const result = await evalLong(`(async () => {
      window.__abeleTest?.closeDesignCatalogue?.()
      const state = window.__designLintReference
      if (!state) return 'restored'
      document.querySelectorAll('[data-design-lint-reference]').forEach(el => el.removeAttribute('data-design-lint-reference'))
      await app.workspace.changeLayout(state.layout)
      for (const path of state.owned) {
        const file = app.vault.getAbstractFileByPath(path)
        if (file) await app.vault.delete(file)
      }
      for (const saved of state.explorers) {
        const leaf = app.workspace.getLeavesOfType('file-explorer').find(leaf => leaf.id === saved.id)
        if (!leaf) throw new Error('Original file explorer was not restored')
        await leaf.loadIfDeferred()
        const deadline = Date.now() + 10000
        while (!leaf.view.fileItems || !leaf.view.navFileContainerEl || !Object.keys(leaf.view.fileItems).length) {
          if (Date.now() > deadline) throw new Error('Restored file explorer did not initialize')
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        for (const [path, collapsed] of saved.folds) {
          const item = leaf.view.fileItems[path]
          if (item && item.collapsed !== collapsed) item.setCollapsed(collapsed)
        }
        leaf.view.navFileContainerEl.scrollTop = saved.scrollTop
        if (saved.folds.some(([path, collapsed]) => leaf.view.fileItems[path]?.collapsed !== collapsed))
          throw new Error('Original file explorer folds were not restored')
      }
      delete window.__designLintReference
      return 'restored'
    })()`)
    expect(result).toBe('restored')
  })
  for (const { page, bug } of DESIGN_CASES)
    describe(page, () => {
      let report: DesignReport
      // Suite-hook errors stay red; test-level hooks are also inverted by it.fails.
      beforeAll(async () => {
        expect(
          evalJson("typeof window.__abeleTest?.openDesignCatalogue === 'function'"),
          'Install a development build containing the catalogue before running this contract'
        ).toBe(true)
        const opened = await evalLong(`(async () => {
        window.__abeleTest.openDesignCatalogue(${JSON.stringify(page)}, 'disclosed')
        await new Promise(resolve => setTimeout(resolve, 500))
        await document.fonts.ready
        await new Promise(requestAnimationFrame)
        return 'opened'
      })()`)
        expect(opened).toBe('opened')
        report = await measureDesign(
          page === 'icon-picker' || page === 'confirm' ? '.modal' : '.abele-design-catalogue',
          `${directory}/${page}`,
          { nativeSelector },
          { requireNative: true }
        )
        expect(report.snapshot.elements.length).toBeGreaterThan(0)
        expect(report.snapshot.native, 'A visible native reference pane is required').toBeDefined()
        expect(report.snapshot.native?.kind).toBe('search-result')
      })
      afterAll(async () => {
        const result = await evalLong(
          `(() => { window.__abeleTest?.closeDesignCatalogue?.(); return 'closed' })()`
        )
        expect(result).toBe('closed')
      })
      const assertClean = () =>
        expect(report.violations, `See ${report.directory}/annotated.png and report.json`).toEqual(
          []
        )
      // An unexpected pass fails the batch: remove the BUG marker once the page is fixed.
      if (bug) it.fails(`BUG: ${page} — ${bug}`, assertClean)
      else it(`${page} has no measured design violations`, assertClean)
    })
})

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
