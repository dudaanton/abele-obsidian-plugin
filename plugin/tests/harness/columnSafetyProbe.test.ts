import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { transformSync } from 'esbuild'

it('reports the column probe error without replacing it with a JSON syntax error', () => {
  const source = readFileSync('tests/e2e/columnSafety.e2e.test.ts', 'utf8')
  const declaration = source.slice(
    source.indexOf('const evaluate ='),
    source.indexOf('\nfunction show')
  )
  const evaluate = new Function(
    'evalRaw',
    'prelude',
    transformSync(declaration + '\nreturn evaluate', { loader: 'ts' }).code
  )(() => 'Error: sample driver failure', '')
  expect(() => evaluate('return true')).toThrow('sample driver failure')
  try {
    evaluate('return true')
  } catch (error) {
    expect(error).not.toBeInstanceOf(SyntaxError)
  }
})
