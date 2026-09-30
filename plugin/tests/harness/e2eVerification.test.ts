import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../e2e/helpers/target', () => ({ onPhone: () => false }))
vi.mock('../e2e/helpers/obsidianCli', () => ({
  isObsidianRunning: vi.fn(() => false),
  hasTestApi: vi.fn(() => false),
  restoreDesktopWindow: vi.fn(),
  evalJson: vi.fn(() => ({})),
}))

import { setup } from '../e2e/helpers/globalSetup'
import * as cli from '../e2e/helpers/obsidianCli'
import { assertTestsRan } from '../e2e/helpers/requireTests'

afterEach(() => vi.clearAllMocks())

describe('explicit e2e verification', () => {
  it('fails before changing app state when Obsidian is unavailable', async () => {
    vi.mocked(cli.isObsidianRunning).mockReturnValue(false)
    await expect(setup()).rejects.toThrow('Obsidian is not running')
    expect(cli.restoreDesktopWindow).not.toHaveBeenCalled()
  })
  it('requires the development test API', async () => {
    vi.mocked(cli.isObsidianRunning).mockReturnValue(true)
    await expect(setup()).rejects.toThrow('development build')
    expect(cli.restoreDesktopWindow).not.toHaveBeenCalled()
  })
  it('rejects an empty or entirely skipped run, including nested suites', () => {
    expect(() => assertTestsRan([])).toThrow('No e2e tests ran')
    expect(() => assertTestsRan([{ type: 'suite', tasks: [
      { type: 'test', result: { state: 'skip' } },
      { type: 'test' },
    ] }])).toThrow('No e2e tests ran')
  })
  it.each(['pass', 'fail'])('counts an executed %s test, not just collected files', (state) => {
    expect(() => assertTestsRan([{ type: 'suite', tasks: [
      { type: 'test', result: { state } },
    ] }])).not.toThrow()
  })
})
