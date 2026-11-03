// @vitest-environment node
import { expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { flushExitEvidence, stopAtCommitCut } from './exit-evidence.mjs'
import { evaluationExpression, decodeEvaluationReply } from './observation.mjs'
import diagnostics from './diagnostics.cjs'

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

it('exports CPU evidence with a held acknowledgement before killing the renderer', async () => {
  const order: string[] = []
  let alive = true,
    held = true
  const pendingSync = new Promise(() => {})
  let saved: any
  const profiler = diagnostics.createStallProfiler({
    continuous: true,
    command: async () => ({ profile: { samples: [1], nodes: [] } }),
    save: async (profile: unknown) => {
      saved = profile
      order.push('CPU saved')
      return 'sample'
    },
    emit() {},
  })
  profiler.heartbeat(0)
  await profiler.poll(0)
  const device = {
    evaluate: async (body: string) => {
      if (!alive)
        throw Object.assign(new Error('Private details must not persist'), {
          scaleObservationError: { kind: 'Error', category: 'renderer-gone' },
        })
      const reply = await runInNewContext(evaluationExpression(body, 'sample'), {
        pendingSync,
        __scaleStopProfiles: async () => {
          expect(held).toBe(true)
          await profiler.close(100)
        },
      })
      return decodeEvaluationReply(JSON.parse(reply), 'sample')
    },
  }
  const appProcess = {
    kill: () => {
      order.push('kill')
      alive = false
    },
  }
  let result: any
  await stopAtCommitCut({
    appProcess,
    stop: async () => {
      result = await flushExitEvidence(device, true)
      appProcess.kill()
    },
    release: () => {
      order.push('ack released')
      held = false
    },
  })
  expect(result).toMatchObject({ flushed: true })
  expect(saved.samples).toEqual([1])
  expect(order).toEqual(['CPU saved', 'kill', 'ack released'])
})

it.each(['missing', 'rejected'])('records a controlled profiler failure (%s)', async (mode) => {
  const device = {
    evaluate: (body: string) =>
      runInNewContext(
        `(async()=>{${body}})()`,
        mode === 'missing'
          ? {}
          : {
              __scaleStopProfiles: async () => {
                throw new TypeError('secret sample-value')
              },
            }
      ),
  }
  const result = await flushExitEvidence(device, true)
  expect(result).toMatchObject({
    flushed: false,
    diagnostic: {
      category: mode === 'missing' ? 'profiler-hook-unavailable' : 'profiler-stop-failed',
    },
  })
  expect(JSON.stringify(result)).not.toMatch(/secret|sample-value|stack|message/)
})

it('allows an explicitly unprofiled control exit without claiming CPU export', async () => {
  const device = { evaluate: (body: string) => runInNewContext(`(async()=>{${body}})()`, {}) }
  expect(await flushExitEvidence(device, true, { requireProfiler: false })).toEqual({
    flushed: true,
    profilerExported: false,
  })
})

it('does not release a held acknowledgement if the stop operation cannot complete', async () => {
  let released = false
  await expect(
    stopAtCommitCut({
      stop: async () => {
        throw new Error('Controlled stop failure')
      },
      release: () => {
        released = true
      },
    })
  ).rejects.toThrow('Controlled stop failure')
  expect(released).toBe(false)
})

it('keeps only controlled failure kind/category on export rejection', async () => {
  const device = {
    evaluate: async () => {
      throw Object.assign(new Error('Bearer sample-private-value argv stderr'), {
        scaleObservationError: {
          kind: 'TimeoutError',
          category: 'cli-execution-failure',
          timedOut: true,
        },
      })
    },
  }
  const result = await flushExitEvidence(device, true)
  expect(result).toMatchObject({
    flushed: false,
    diagnostic: { kind: 'TimeoutError', category: 'timeout' },
  })
  expect(JSON.stringify(result)).not.toMatch(
    /Bearer|sample-private-value|argv|stderr|stack|message/
  )
})
