import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong } from './helpers/obsidianCli'
import { measureDesign, type DesignReport } from './helpers/designLint'
import { shotDir } from './helpers/shots'

import { DESIGN_CASES } from './helpers/designCatalogueCases'
const directory = process.env.DESIGN_LINT_OUT_DIR ?? shotDir('design-lint')
const referenceTarget = 'sample-design-reference-target.md'
const referenceSource = 'sample-design-reference-source.md'
const nativeSelector = '[data-design-lint-reference] .backlink-pane .tree-item-self'
type Element = DesignReport['snapshot']['elements'][number]
function matchesComposedSpacing(
  page: string,
  violation: DesignReport['violations'][number],
  element: Element,
  parent: Element | undefined,
  spacing: { arrow: number; thumbnail: number }
): boolean {
  if (violation.elements.length !== 1) return false
  if (
    page === 'navigation' &&
    violation.rule === 'spacing-scale' &&
    violation.metric === 'margin.3' &&
    element.selector.includes('.abele-fold-heading.is-collapsible')
  )
    return Math.abs(element.margin[3] + spacing.arrow) < 0.05
  if (
    page === 'previews' &&
    violation.rule === 'spacing-scale' &&
    violation.metric === 'padding.1' &&
    element.selector.includes('.abele-card_thumbed')
  )
    return Math.abs(element.padding[1] - spacing.thumbnail) < 0.05
  return (
    page === 'states' &&
    violation.rule === 'native-parity' &&
    violation.metric === 'padding.left' &&
    !!parent?.selector.includes('.abele-tree-item_flush') &&
    element.padding[3] === 0
  )
}
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
      let composedSpacing: { arrow: number; thumbnail: number }
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
        composedSpacing = evalJson(`(() => {
          const root = document.querySelector('.abele-design-catalogue, .modal')
          const probe = root.ownerDocument.createElement('div')
          root.appendChild(probe)
          const token = name => {
            probe.style.width = 'var(' + name + ')'
            return parseFloat(getComputedStyle(probe).width)
          }
          try { return {
            arrow: token('--icon-xs') + token('--size-4-1'),
            thumbnail: token('--size-4-16') + token('--size-4-4') + token('--size-4-3'),
          } } finally { probe.remove() }
        })()`)
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
      const assertClean = () => {
        const remaining = report.violations.filter((violation) => {
          const element = report.snapshot.elements.find((el) => el.id === violation.elements[0])
          if (!element || violation.elements.length !== 1) return true
          const parent = report.snapshot.elements.find((el) => el.id === element.parent)
          // Accepted composed geometry must equal its independent theme-token calculation.
          return !matchesComposedSpacing(page, violation, element, parent, composedSpacing)
        })
        expect(remaining, `See ${report.directory}/annotated.png and report.json`).toEqual([])
      }
      // An unexpected pass fails the batch: remove the BUG marker once the page is fixed.
      if (bug) it.fails(`BUG: ${page} — ${bug}`, assertClean)
      else it(`${page} has no measured design violations`, assertClean)
    })
})
