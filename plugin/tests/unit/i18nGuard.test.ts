import { expect, it } from 'vitest'
import { extract, checkMigrated, checkRatchet, areaFor } from '../../scripts/i18n-manifest.mjs'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

it('checks actual TypeScript key and placeholder errors', () => {
  const program = ts.createProgram([resolve('tests/fixtures/i18nTypes.ts')], {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ['node'],
  })
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  ).toEqual([])
})

it('requires translation review when source English changes', () => {
  const code = readFileSync(resolve('src/i18n/locales/en/pilot.ts'), 'utf8')
  const ast = ts.createSourceFile('pilot.ts', code, ts.ScriptTarget.Latest, true)
  const entries: Record<string, string> = {}
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'en') {
      const object = (node.initializer as ts.AsExpression).expression as ts.ObjectLiteralExpression
      for (const item of object.properties as ts.NodeArray<ts.PropertyAssignment>)
        entries[(item.name as ts.StringLiteral).text] = createHash('sha256')
          .update(item.initializer.getText(ast))
          .digest('hex')
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const ledger = JSON.parse(
    readFileSync(resolve('src/i18n/english-ledger.json'), 'utf8')
  ) as Record<string, { englishHash: string }>
  expect(entries).toEqual(
    Object.fromEntries(Object.entries(ledger).map(([key, entry]) => [key, entry.englishHash]))
  )
})

it('detects prose, attributes, defaults, bindings and imperative UI sinks', () => {
  const vue = `<template><div>New label</div><Icon tooltip="New tip" :text="ok ? 'Yes' : 'No'" /></template><script setup lang="ts">const props = withDefaults(defineProps<{label?:string}>(), { label: 'Default' })</script>`
  expect(extract('sample.vue', vue).map((v) => v.text)).toEqual(
    expect.arrayContaining(['New label', 'New tip', 'Yes', 'No', 'Default'])
  )
  expect(
    extract(
      'sample.ts',
      `new Notice('Visible'); menu.setTitle('Action'); el.createEl('div', { text: 'Hello' }); const id = 'stable-id'`
    ).map((v) => v.text)
  ).toEqual(expect.arrayContaining(['Visible', 'Action', 'Hello']))
  expect(
    extract(
      'sample.ts',
      `const id = 'stable-id'; const prompt = 'Agent instructions'; t('kit.cancel')`
    )
  ).toEqual([])
  expect(extract('sample.ts', `const KIT_COLOR_NAMES = { red: 'Red' }`).map((v) => v.text)).toEqual(
    ['Red']
  )
  expect(areaFor('components/ChatHeader.vue')).toBe('chat')
  expect(areaFor('components/settings/Settings.vue')).toBe('settings')
})

it('keeps migrated surfaces free of untranslated presentation literals', () => {
  expect(checkMigrated()).toEqual([])
})

it('ratchets legacy prose across all areas and detects new or moved strings', () => {
  expect(checkRatchet()).toEqual([])
  const changed = extract(
    'components/sample.vue',
    '<template><div>New presentation text</div></template>'
  )
  expect(checkRatchet(changed)).toHaveLength(1)
})
