import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  evalJson: vi.fn(() => ({})),
  evalLong: vi.fn(async () => '"sample"'),
  reloadPlugin: vi.fn(),
  reloadApp: vi.fn(),
  driver: vi.fn(),
  onPhone: vi.fn(() => false),
}))
vi.mock('../e2e/helpers/obsidianCli', () => mocks)
vi.mock('../e2e/helpers/phone', () => mocks)
vi.mock('../e2e/helpers/target', () => mocks)
import { liveScenarioHost } from '../e2e/helpers/scenarioHost'

it('awaits async Obsidian observations rather than serializing an unresolved promise', async () => {
  expect(await liveScenarioHost().read('sample.md')).toBe('sample')
  expect(mocks.evalLong).toHaveBeenCalled()
  expect(mocks.evalJson).not.toHaveBeenCalled()
})
it('uses the application reload driver for restart evidence', async () => {
  await liveScenarioHost().restart()
  expect(mocks.reloadApp).toHaveBeenCalled()
  expect(mocks.reloadPlugin).not.toHaveBeenCalled()
})
