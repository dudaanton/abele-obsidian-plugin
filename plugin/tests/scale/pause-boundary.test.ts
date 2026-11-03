// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { capturePausedBoundary } from './pause-boundary.mjs'
import { classifyRecoveryRead, boundaryHasLaterWrites } from './recovery-receipts.mjs'
const { observeWrites } = createRequire(import.meta.url)('./writes.cjs')

const target = {
  target: 'Sample/note.md',
  stage: '.private/sample.tmp',
  sha: 'c'.repeat(64),
  pending: true,
  usableIdentityReceipt: false,
}
it('still invalidates an early snapshot followed by a matching write before interruption', () => {
  const receipt = {
    id: 'pause',
    device: '1',
    at: 1000,
    completedAt: 1005,
    interruptedAt: 2095,
    recoveryEndedAt: 3000,
    complete: true,
    targets: [target],
  }
  const writes = [
    { device: '1', event: 'write-start', source: 'abele', at: 1054, path: target.stage },
  ]
  expect(boundaryHasLaterWrites(receipt, receipt.interruptedAt, writes)).toBe(true)
  const read = { device: '1', at: 2500, ...target, stack: 'at nativeInstallBatch' }
  expect(
    classifyRecoveryRead(read, [
      {
        ...receipt,
        complete:
          receipt.complete && !boundaryHasLaterWrites(receipt, receipt.interruptedAt, writes),
      },
    ]).status
  ).toBe('FAIL')
  const late = { ...receipt, at: 2090, completedAt: 2094 }
  expect(boundaryHasLaterWrites(late, late.interruptedAt, writes)).toBe(false)
  expect(classifyRecoveryRead(read, [late]).status).toBe('RECOVERY')
})
it('captures after the pause acknowledgement and the last in-flight stage write', async () => {
  let now = 0
  const receipt = await capturePausedBoundary({
    now: () => now,
    delay: async (ms: number) => {
      now += ms
    },
    observe: async () => ({
      paused: now >= 1094,
      writes: {
        complete: true,
        generation: 'sample',
        active: now >= 54 && now < 58 ? 1 : 0,
        revision: now < 54 ? 0 : now < 58 ? 1 : 2,
      },
    }),
    capture: async () => ({
      id: 'pause',
      device: '1',
      at: now,
      completedAt: (now += 5),
      complete: true,
      targets: [target],
    }),
  })
  expect(receipt.at).toBeGreaterThanOrEqual(1094)
  expect(
    classifyRecoveryRead(
      { device: '1', at: now + 100, ...target, stack: 'at nativeInstallBatch' },
      [{ ...receipt, interruptedAt: now + 1, recoveryEndedAt: now + 200 }]
    ).status
  ).toBe('RECOVERY')
})

it('retakes a snapshot if writes change during capture', async () => {
  let now = 0,
    revision = 0,
    captures = 0
  const receipt = await capturePausedBoundary({
    now: () => now,
    delay: async (ms: number) => {
      now += ms
    },
    observe: async () => ({
      paused: true,
      writes: { complete: true, generation: 'sample', active: 0, revision },
    }),
    capture: async () => {
      captures++
      if (captures === 1) revision += 2
      return { at: now, completedAt: ++now, complete: true, targets: [target] }
    },
  })
  expect(captures).toBe(2)
  expect(receipt.quiescence.revision).toBe(2)
})

it('does not treat a pause request or an unavailable write observer as quiescence', async () => {
  let now = 0
  await expect(
    capturePausedBoundary({
      now: () => now,
      delay: async (ms: number) => {
        now += ms
      },
      timeoutMs: 200,
      observe: async () => ({ paused: false, writes: { complete: false } }),
      capture: async () => {
        throw new Error('Snapshot must not run')
      },
    })
  ).rejects.toThrow('quiescent')
})

it('tracks real pending writes until their completion without changing their result', async () => {
  let release: () => void = () => {}
  const native = {
    open: async () => ({}),
    rename: async () => {},
    writeFile: (_path: string, _body: string) =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  }
  const undo = observeWrites(
    { getBasePath: () => '/sample', fsPromises: native, writeBinary: async () => {} },
    () => {}
  )
  try {
    expect(undo.snapshot()).toMatchObject({ complete: true, active: 0, revision: 0 })
    const writing = native.writeFile('/sample/note.md', 'sample')
    expect(undo.snapshot().active).toBeGreaterThan(0)
    release()
    await expect(writing).resolves.toBeUndefined()
    expect(undo.snapshot()).toMatchObject({ active: 0 })
    expect(undo.snapshot().revision).toBeGreaterThan(0)
  } finally {
    undo()
  }
})
