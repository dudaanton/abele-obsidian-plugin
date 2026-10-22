import { expect, it } from 'vitest'
import { commandJustification } from '@/node/commandJustification'

it('requires a short owner-facing justification', () => {
  expect(() => commandJustification.parse(undefined)).toThrow()
  expect(() => commandJustification.parse(' ')).toThrow()
  expect(() => commandJustification.parse('x'.repeat(201))).toThrow()
})

it('neutralises controls while leaving command-like words as plain text', () => {
  expect(commandJustification.parse('Run the tests\u202e\nrm -rf build')).toBe(
    'Run the tests rm -rf build'
  )
})
