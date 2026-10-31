// @vitest-environment node
import { expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
  decodeEvaluationReply,
  decodeEvaluationOutput,
  evaluationExpression,
  observeStartup,
} from './observation.mjs'

function startupError() {
  try {
    decodeEvaluationReply(
      { __abeleReply: 'sample', error: { kind: 'TypeError', message: 'sample index is starting' } },
      'sample'
    )
  } catch (error) {
    return error
  }
  throw new Error('Expected evaluation failure')
}

it('keeps the renderer exception kind and message across the CLI frame', async () => {
  const reply = JSON.parse(
    await runInNewContext(
      evaluationExpression('throw new TypeError("sample index is starting")', 'sample')
    )
  )
  expect(reply.error).toMatchObject({ kind: 'TypeError', message: 'sample index is starting' })
  expect(() => decodeEvaluationReply(reply, 'sample')).toThrow('sample index is starting')
  let captured
  try {
    decodeEvaluationReply(reply, 'sample')
  } catch (error) {
    captured = error
  }
  expect(captured).toMatchObject({ scaleObservationError: reply.error })
})

it('does not mistake an arrow inside the original error for the CLI reply delimiter', () => {
  const error = { kind: 'TypeError', message: 'sample => failure' }
  const output = 'sample log\n=> ' + JSON.stringify({ __abeleReply: 'sample', error }) + '\n'
  expect(() => decodeEvaluationOutput(output, 'sample')).toThrow('sample => failure')
})

it('records transient observation failures and retries before returning the snapshot', async () => {
  let calls = 0
  const records: unknown[] = []
  const result = await observeStartup(
    async () => {
      if (++calls < 3) throw startupError()
      return { rows: [{ status: 'idle' }] }
    },
    {
      record: async (entry: unknown) => {
        records.push(entry)
      },
      delay: async () => {},
    }
  )
  expect(result.rows[0].status).toBe('idle')
  expect(records).toMatchObject([
    {
      attempt: 1,
      retrying: true,
      error: { kind: 'TypeError', message: 'sample index is starting' },
    },
    { attempt: 2, retrying: true },
  ])
})

it('bounds repeated observation failures and retains the last underlying error', async () => {
  const records: unknown[] = []
  let calls = 0
  await expect(
    observeStartup(
      async () => {
        calls++
        throw startupError()
      },
      {
        maxAttempts: 3,
        record: async (entry: unknown) => {
          records.push(entry)
        },
        delay: async () => {},
      }
    )
  ).rejects.toMatchObject({
    scaleObservationError: { kind: 'TypeError', message: 'sample index is starting' },
  })
  expect(calls).toBe(3)
  expect(records.at(-1)).toMatchObject({ attempt: 3, retrying: false })
})

it('does not retry a product error or a run deadline', async () => {
  for (const message of ['Vault entered an error state', 'Run deadline reached']) {
    let calls = 0
    await expect(
      observeStartup(async () => {
        calls++
        throw new Error(message)
      })
    ).rejects.toThrow(message)
    expect(calls).toBe(1)
  }
  let calls = 0
  const state = { rows: [{ status: 'error' }] }
  expect(
    await observeStartup(async () => {
      calls++
      return state
    })
  ).toBe(state)
  expect(calls).toBe(1)
})

it('caps retries by elapsed time as well as count', async () => {
  let time = 0
  const allowances: number[] = []
  await expect(
    observeStartup(
      async (remaining: number) => {
        allowances.push(remaining)
        time += 10
        throw startupError()
      },
      { timeoutMs: 10, now: () => time, record: async () => {}, delay: async () => {} }
    )
  ).rejects.toThrow('sample index is starting')
  expect(allowances).toEqual([10])
})
