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

  it('keeps Word operation helpers independent of the edit dispatcher', () => {
    expect(cyclicComponents(importGraph(resolve('src/word')))).toEqual([])
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
