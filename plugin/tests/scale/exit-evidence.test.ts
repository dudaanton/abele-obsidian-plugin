// @vitest-environment node
import { expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { flushExitEvidence } from './exit-evidence.mjs'

it.each([false, true])(
  'exports active CPU samples before permitting exit (minimal: %s)',
  async (minimal) => {
    const order = ['harness-stop-request']
    let release: () => void = () => {}
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const device = {
      evaluate: (body: string) =>
        runInNewContext(`(async()=>{${body}})()`, {
          __scalePrepareTeardown: () => order.push('ledger teardown'),
          __scaleFlushEntryLedger: () => order.push('ledger flush'),
          __scaleStopProfiles: async () => {
            order.push('profile stop')
            await blocked
            order.push('profile saved')
          },
          __scaleFlushEvidence: () => {
            order.push('evidence flush')
            return true
          },
        }),
    }
    const exiting = flushExitEvidence(device, minimal).then(() => {
      order.push('kill or quit')
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(order).toContain('profile stop')
    expect(order).not.toContain('kill or quit')
    release()
    await exiting
    expect(order.indexOf('profile saved')).toBeLessThan(order.indexOf('kill or quit'))
    expect(order.includes('ledger flush')).toBe(!minimal)
  }
)
