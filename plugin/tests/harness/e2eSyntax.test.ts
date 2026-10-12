// @vitest-environment node
import { readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
import ts from 'typescript'

// The e2e tier is compiled only when a live batch starts, so a broken file used to surface
// first in a release run. Grammar errors (await outside async included) are caught here.
it('keeps every e2e file free of grammar errors', () => {
  const files = readdirSync('tests/e2e', { recursive: true })
    .filter((file): file is string => typeof file === 'string' && file.endsWith('.ts'))
    .map((file) => 'tests/e2e/' + file)
  expect(files.length).toBeGreaterThan(0)
  const program = ts.createProgram(files, {
    noLib: true,
    noResolve: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  })
  const errors = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
    .filter((d) => d.file && d.category === ts.DiagnosticCategory.Error && d.code < 2000)
    .map((d) => {
      const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0)
      return `${d.file!.fileName}:${line + 1} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
    })
  expect(errors).toEqual([])
}, 60_000)
