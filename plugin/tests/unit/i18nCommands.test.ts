import { expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import baseline from '../fixtures/i18nCommands.json'
import { catalogs, validateCatalogs } from '../../src/i18n/catalogs'
import { createTranslator } from '../../src/i18n/core'
import { defaultCommandLabel } from '../../src/i18n/commandLabels'
import { checkCommandLabels, checkMigrated, extract } from '../../scripts/i18n-manifest.mjs'

it('keeps all five catalogs complete and migrated settings free of presentation literals', () => {
  expect(validateCatalogs(catalogs)).toEqual([])
  expect(checkMigrated()).toEqual([])
})

it('keeps persisted default button labels independent of translated command names', () => {
  expect(defaultCommandLabel({ id: 'abele:new-canvas', name: 'Новый холст' })).toBe('New canvas')
  expect(defaultCommandLabel({ id: 'abele:review-waiting-scripts', name: 'Prüfen' })).toBe(
    'Review scripts waiting for confirmation'
  )
  expect(
    defaultCommandLabel({ id: 'abele:script-sample', name: 'Skripts: sample' }, [
      { commandId: 'abele:script-sample', meta: { name: 'sample $& {name}' } },
    ])
  ).toBe('Script: sample $& {name}')
  expect(defaultCommandLabel({ id: 'external:sample', name: 'Custom label' })).toBe('Custom label')
})

it('guards indirect command names and ribbon tooltips as well as fixed names', () => {
  expect(checkCommandLabels()).toEqual([])
})

it('keeps the live agents ribbon tooltip translated when its badge updates', () => {
  const translate = createTranslator('en', catalogs)
  expect(translate('ribbon.agentsStatus', { attention: 2, running: 3 })).toBe(
    'Agents · Needs attention: 2. Working: 3'
  )
  expect(translate('ribbon.agentsStatusIncomplete', { attention: 2, running: 3 })).toBe(
    'Agents · Needs attention: 2. Working: 3 · Some conversations could not be checked'
  )
  const source = readFileSync(resolve('src/startup/registerAiFeatures.ts'), 'utf8')
  expect(source).not.toContain("ribbon.setAttribute('aria-label', tooltip)")
})

it('translates node settings without changing the saved local node default or endpoint', () => {
  const source = readFileSync(resolve('src/components/settings/NodesSettings.vue'), 'utf8')
  expect(
    extract('components/settings/NodesSettings.vue', source).filter(
      (entry) => entry.text !== 'http://127.0.0.1:7777'
    )
  ).toEqual([])
  expect(source).toContain("const label = ref('Local node')")
  expect(source).toContain("const url = ref('http://127.0.0.1:7777')")
  expect(source).toContain(
    'await service.add(label.value.trim(), url.value.trim(), token.value.trim())'
  )
  expect(createTranslator('ru', catalogs)('settings.tabs.nodes')).toBe('Ноды')
})

it('preserves fixed command IDs and English names while translating at registration time', () => {
  for (const [file, expected] of Object.entries(baseline)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(resolve('src', file), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    )
    const found: Record<string, string> = {}
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'addCommand'
      ) {
        const command = node.arguments[0]
        if (command && ts.isObjectLiteralExpression(command)) {
          const property = (key: string) =>
            command.properties.find((p) => p.name?.getText(source) === key)
          const id = property('id')
          const name = property('name')
          if (
            id &&
            ts.isPropertyAssignment(id) &&
            ts.isStringLiteral(id.initializer) &&
            Object.hasOwn(expected, id.initializer.text)
          ) {
            expect(name && ts.isPropertyAssignment(name)).toBe(true)
            if (!name || !ts.isPropertyAssignment(name)) return
            const call = name.initializer
            expect(
              ts.isCallExpression(call),
              `${file}/${id.initializer.text} must translate when registered`
            ).toBe(true)
            if (!ts.isCallExpression(call)) return
            expect(call.expression.getText(source)).toBe('t')
            const key = call.arguments[0]
            expect(ts.isStringLiteral(key)).toBe(true)
            if (!ts.isStringLiteral(key)) return
            found[id.initializer.text] = createTranslator('en', catalogs)(key.text)
            for (const locale of ['ru', 'lv', 'es', 'de'] as const) {
              expect(Object.hasOwn(catalogs[locale], key.text)).toBe(true)
              expect(createTranslator(locale, catalogs)(key.text)).not.toBe(
                found[id.initializer.text]
              )
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(found, file).toEqual(expected)
  }
})
