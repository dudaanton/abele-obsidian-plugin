// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { declaredTargets } from '../e2e/helpers/target'

it('schedules external-file server scenarios on desktop and phone', () => {
  const source = readFileSync('tests/e2e/syncExternalFiles.e2e.test.ts', 'utf8')
  expect(declaredTargets(source)).toEqual(['desktop', 'phone'])
  const registry = readFileSync('tests/e2e/helpers/syncLiveCases.ts', 'utf8')
  expect(registry).toContain("'syncExternalFiles'")
})
