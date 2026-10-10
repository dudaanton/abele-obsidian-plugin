import { expect, it, vi } from 'vitest'
import { DRIVER, phoneHome } from '../e2e/helpers/phone'

const command = vi.hoisted(() => vi.fn(() => ''))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFileSync: command, default: { ...actual, execFileSync: command } }
})
it('uses the phone driver Home command with a bounded timeout', () => {
  phoneHome()
  expect(command).toHaveBeenCalledWith(
    DRIVER,
    ['press', 'home'],
    expect.objectContaining({ timeout: 30000 })
  )
})
