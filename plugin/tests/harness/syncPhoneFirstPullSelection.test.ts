// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { declaredTargets } from '../e2e/helpers/target'

it('schedules the first-pull benchmark on the real phone and registers its evidence', () => {
  const source = readFileSync('tests/e2e/syncPhoneFirstPull.e2e.test.ts', 'utf8')
  expect(declaredTargets(source)).toEqual(['phone'])
  const registry = readFileSync('tests/e2e/helpers/syncLiveCases.ts', 'utf8')
  expect(registry).toContain("'syncPhoneFirstPull'")
})
