// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { mappedSyncCases } from '../e2e/helpers/syncLiveCases'
const files = [
  'sync',
  'syncJoin',
  'syncDevices',
  'syncDeletes',
  'syncSettings',
  'syncDialogs',
  'syncTransfer',
  'syncPhone',
  'personalBaseline',
]
it.each(files)('%s live tests use token connections rather than removed access flows', (name) => {
  const source = readFileSync(new URL('../e2e/' + name + '.e2e.test.ts', import.meta.url), 'utf8')
  expect(source).not.toMatch(/SyncService|createAccount|initDaemon|\/v1\/|chooseVault|enrolSibling/)
  expect(source).toContain('liveCase(')
})
it('maps every token live case including all eight phone scenarios', () => {
  const cases = mappedSyncCases()
  expect(cases.length).toBeGreaterThanOrEqual(32)
  expect(new Set(cases.map((one) => one.file + ':' + one.name)).size).toBe(cases.length)
  for (const one of cases)
    expect(one.scenarios.every((id) => Number.isInteger(id) && id >= 1 && id <= 124)).toBe(true)
  const phoneCases = cases.filter((one) => one.file === 'syncPhone')
  const phoneSource = readFileSync(new URL('../e2e/syncPhone.e2e.test.ts', import.meta.url), 'utf8')
  // The mapper omits empty ID arrays, so count declarations as well as mapped cases.
  expect(phoneCases).toHaveLength([...phoneSource.matchAll(/\bliveCase\s*\(/g)].length)
  for (const one of phoneCases) expect(one.scenarios.length, one.name).toBeGreaterThan(0)
  expect([...new Set(phoneCases.flatMap((one) => one.scenarios))].sort((a, b) => a - b)).toEqual([
    117, 118, 119, 120, 121, 122, 123, 124,
  ])
})
