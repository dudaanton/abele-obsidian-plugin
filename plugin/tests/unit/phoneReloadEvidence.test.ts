import { expect, it, vi } from 'vitest'
import { beginPhoneCase, endPhoneCase, phoneEval } from '../e2e/helpers/phone'

const command = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFileSync: command, default: { ...actual, execFileSync: command } }
})

it('includes the replacement page lifecycle packet in the reload failure', () => {
  const before = { timeOrigin: 100, loadId: 'sample-before' }
  const after = { timeOrigin: 2000, loadId: 'sample-after' }
  const lifecycle = {
    current: { navigation: 'reload' },
    previous: { action: 'cancel Share picker', events: [{ kind: 'pagehide' }] },
  }
  command.mockReturnValueOnce(JSON.stringify({ type: 'object', value: before }))
  command.mockReturnValueOnce(
    JSON.stringify({ type: 'object', value: { identity: after, lifecycle } })
  )
  try {
    beginPhoneCase()
    expect(() => phoneEval('throw new Error("must not run on replacement")', 10000)).toThrow(
      JSON.stringify({ before, after, lifecycle })
    )
    expect(command).toHaveBeenCalledTimes(2)
  } finally {
    endPhoneCase()
    command.mockReset()
  }
})
