import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { resolve } from 'node:path'
import { checkedDiagnostics, validateFolders } from '../../scripts/check-strict-null.mjs'

function fixture() {
  const root = resolve('tests/fixtures/strict-null')
  const files = new Map([
    [resolve(root, 'checked/sample.ts'), 'export const name: string = null'],
    [resolve(root, 'checked-nested/sample.ts'), 'export const name: string = null'],
    [resolve(root, 'legacy/sample.ts'), 'export const name: string = null'],
  ])
  const options: ts.CompilerOptions = { strictNullChecks: true, noEmit: true, skipLibCheck: true }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host)
  const exists = host.fileExists.bind(host)
  host.readFile = (path) => files.get(path) ?? read(path)
  host.fileExists = (path) => files.has(path) || exists(path)
  const program = ts.createProgram([...files.keys()], options, host)
  return { root, program }
}

describe('incremental strict null gate', () => {
  it('reports null assignments in a checked folder, not unchecked dependencies or prefix siblings', () => {
    const { root, program } = fixture()
    const diagnostics = checkedDiagnostics(program, root, ['checked'])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].code).toBe(2322)
    expect(diagnostics[0].file?.fileName).toBe(resolve(root, 'checked/sample.ts'))
  })

  it('grows the enforced area without a diagnostic baseline or suppressions', () => {
    const { root, program } = fixture()
    expect(checkedDiagnostics(program, root, ['checked', 'legacy'])).toHaveLength(2)
  })

  it('keeps project-wide configuration errors visible', () => {
    const program = ts.createProgram([], {
      strictNullChecks: false,
      strictPropertyInitialization: true,
      noEmit: true,
    })
    expect(checkedDiagnostics(program, resolve('.'), ['checked']).length).toBeGreaterThan(0)
  })

  it('rejects empty, duplicate and escaping folder lists', () => {
    for (const list of [
      [],
      ['checked', 'checked'],
      ['../outside'],
      ['/absolute'],
      ['checked/'],
      ['checked', 'checked/nested'],
    ]) {
      expect(() => validateFolders(list)).toThrow()
    }
    expect(validateFolders(['checked', 'nested/core'])).toEqual(['checked', 'nested/core'])
  })
})
