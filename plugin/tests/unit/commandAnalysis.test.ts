// @vitest-environment node
import { expect, it } from 'vitest'
import ts from 'typescript'
import { analyzeCommands } from '../helpers/commandAnalysis'

function program(text: string) {
  const file = ts.createSourceFile('/sample/src/commands.ts', text, ts.ScriptTarget.Latest, true)
  return ts.createProgram(
    [file.fileName],
    { noLib: true },
    {
      ...ts.createCompilerHost({ noLib: true }),
      getSourceFile: (name) => (name === file.fileName ? file : undefined),
      fileExists: (name) => name === file.fileName,
      readFile: (name) => (name === file.fileName ? text : undefined),
    }
  )
}
it('shares immutable analysis while resolving computed names and escaped identifiers', () => {
  const source = program(
    'declare const plugin: any; declare const selected: boolean; const title = selected ? "Sample one" : "Sample two"; plugin.addCommand({name: title}); plugin.add\\u0043ommand({name: "Sample three"});'
  )
  const first = analyzeCommands(source, '/sample/src/')
  expect(analyzeCommands(source, '/sample/src/')).toBe(first)
  expect(Object.isFrozen(first)).toBe(true)
  expect(first).toHaveLength(2)
  expect(first.flatMap((entry) => entry.names.map((name) => name.value)).sort()).toEqual([
    'Sample one',
    'Sample three',
    'Sample two',
  ])
  expect(first.every((entry) => entry.names.every((name) => name.literal))).toBe(true)
})
it('preserves unresolved, missing-name and nonliteral-object failures', () => {
  const source = program(
    'declare const plugin: any; declare const arbitrary: string; plugin.addCommand({name: arbitrary}); plugin.addCommand({}); plugin.addCommand(arbitrary);'
  )
  const entries = analyzeCommands(source, '/sample/src/')
  expect(entries[0].names[0].literal).toBe(false)
  expect(entries[1].hasName).toBe(false)
  expect(entries[2].objectLiteral).toBe(false)
})

it('resolves English catalog names and rejects unknown keys without skipping commands', () => {
  const entries = analyzeCommands(
    program(`declare const plugin: any;
    declare function t(key: string): string;
    plugin.addCommand({ name: t('commands.new-canvas') });
    plugin.addCommand({ name: t('commands.missing') });
    plugin.addCommand({ name: t('commands.script') });`),
    '/sample/src/'
  )
  expect(entries.map((entry) => entry.names)).toEqual([
    [{ literal: true, value: 'New canvas' }],
    [{ literal: false, value: '' }],
    [{ literal: true, value: 'Script: <name>' }],
  ])
})
