import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { cyclicComponents, importGraph, runtimeImports } from '../../scripts/import-cycles.mjs'

describe('runtime import graph', () => {
  it('excludes type-only, elided and dynamic imports but retains value re-exports', () => {
    expect(
      runtimeImports(
        `
      import type { A } from './types'
      import { B } from './inferred-type'
      import { value } from './value'
      import './side-effect'
      export { other } from './re-export'
      const typed: B = value
      export const later = () => import('./lazy')
      export { typed }
    `,
        'sample.ts'
      )
    ).toEqual(['./value', './side-effect', './re-export'])
  })

  it('retains Vue components used only by the template', () => {
    expect(
      runtimeImports(
        `
      <script setup lang="ts">
      import Sample from './Sample.vue'
      import type { Props } from './types'
      </script>
      <template><Sample /></template>
    `,
        'Example.vue'
      )
    ).toContain('./Sample.vue')
  })

  it('finds indirect and self cycles without grouping unrelated modules', () => {
    expect(
      cyclicComponents(
        new Map([
          ['a', ['b']],
          ['b', ['c']],
          ['c', ['a', 'd']],
          ['d', []],
          ['e', ['e']],
        ])
      )
    ).toEqual([['a', 'b', 'c'], ['e']])
  })

  it('resolves aliases from the source root even when reporting a nested folder', () => {
    const root = resolve('tests/fixtures/import-graph')
    expect(cyclicComponents(importGraph(resolve(root, 'nested'), root))).toEqual([
      ['first.ts', 'second.ts'],
    ])
  })

  it('keeps Word operation helpers independent of the edit dispatcher', () => {
    expect(cyclicComponents(importGraph(resolve('src/word')))).toEqual([])
  })

  it('keeps Canvas core parsing independent of ink geometry and visibility', () => {
    expect(cyclicComponents(importGraph(resolve('src/canvas/core')))).toEqual([])
  })

  it('keeps finance sources and their balance reader acyclic', () => {
    expect(cyclicComponents(importGraph(resolve('src/analytics/sources')))).toEqual([])
  })

  it('keeps the design catalogue registry independent of its component', () => {
    expect(cyclicComponents(importGraph(resolve('src/testing')))).toEqual([])
  })

  it('does not load the concrete script view just to get its view type', () => {
    const file = resolve('src/scripting/view/ScriptViewService.ts')
    expect(runtimeImports(readFileSync(file, 'utf8'), file)).not.toContain('@/views/ScriptView')
  })

  it('keeps the plugin entry point a type-only dependency of settings', () => {
    for (const file of ['services/AbeleConfig.ts', 'settings.ts']) {
      const source = ts.createSourceFile(
        file,
        readFileSync(resolve('src', file), 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      const entry = source.statements.find(
        (node): node is ts.ImportDeclaration =>
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          ['@/main', './main'].includes(node.moduleSpecifier.text)
      )
      expect(entry?.importClause?.isTypeOnly, file).toBe(true)
    }
  })
})
