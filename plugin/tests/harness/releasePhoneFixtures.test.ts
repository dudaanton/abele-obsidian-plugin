// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('uses durable slide decisions rather than clearing legacy mirrors', () => {
  for (const name of ['slidesLive', 'slidesAgent']) {
    const source = readFileSync(`tests/e2e/${name}.e2e.test.ts`, 'utf8')
    expect(source).toContain('DEVICE_INTENT_FIXTURE')
    expect(source).not.toMatch(/app\.(save|load)LocalStorage\((?:key|'abele-slide-network:')/)
  }
})
it('recovers verified media fixtures before setup and records the page phase', () => {
  const source = readFileSync('tests/e2e/mediaBulkSafety.e2e.test.ts', 'utf8')
  expect(source).toContain('await removeOwnedMediaFixture(root, sources)')
  expect(source).toContain('loadId')
  expect(source).toContain('phase')
})
