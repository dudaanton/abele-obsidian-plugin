// @vitest-environment node
import { expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
  decodeEvaluationReply,
  decodeEvaluationOutput,
  evaluationExpression,
  observeStartup,
  observationError,
  cliObservationError,
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
  expect(reply.error).not.toHaveProperty('stack')
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

it('persists only controlled CLI diagnostics, never exec argv, stderr or credentials', async () => {
  const original = Object.assign(
    new Error('exec --token sample-token-value /private/sample --key sample-key-value'),
    {
      code: 124,
      signal: 'SIGTERM',
      stderr: 'Bearer sample-bearer-value',
    }
  )
  const failure = Object.assign(new Error('Vault CLI unavailable'), {
    scaleObservationError: cliObservationError(original),
    scaleCliFailure: {
      code: 124,
      signal: 'SIGTERM',
      argv: '--token sample-token-value',
      stderr: 'sample-bearer-value',
    },
  })
  const records: unknown[] = []
  await expect(
    observeStartup(
      async () => {
        throw failure
      },
      {
        maxAttempts: 1,
        record: async (entry: unknown) => {
          records.push(entry)
        },
      }
    )
  ).rejects.toThrow('Vault CLI unavailable')
  expect(observationError(failure)).toMatchObject({
    kind: 'Error',
    category: 'cli-execution-failure',
    exitCode: 124,
    signal: 'SIGTERM',
    timedOut: true,
  })
  const persisted = JSON.stringify({
    report: observationError(failure),
    failure: observationError(failure),
    records,
  })
  for (const value of [
    'sample-token-value',
    'sample-key-value',
    'sample-bearer-value',
    '--token',
    '/private/sample',
    'stack',
    'stderr',
  ])
    expect(persisted).not.toContain(value)
})

it('redacts renderer credentials, URL credentials/queries and external paths before persistence', () => {
  const original = {
    kind: 'TypeError',
    message:
      'index starting: Bearer sample-bearer-value token=sample-token-value secret="sample secret value" https://sample-user:sample-pass@example.invalid/read?key=sample-query /private/sample/data /sample/vault/note.md /sample/output/log.json',
    stack: 'at sample (/private/sample/source.js:3)',
  }
  let failure
  try {
    decodeEvaluationReply({ __abeleReply: 'sample', error: original }, 'sample', [
      '/sample/vault',
      '/sample/output',
    ])
  } catch (error) {
    failure = error
  }
  const safe = observationError(failure, ['/sample/vault', '/sample/output'])
  expect(safe).toMatchObject({ kind: 'TypeError', category: 'renderer-evaluation-failure' })
  expect(safe.message).toContain('index starting')
  expect(safe.message).toContain('/sample/vault/note.md')
  expect(safe.message).toContain('/sample/output/log.json')
  const persisted = JSON.stringify(safe)
  for (const value of [
    'sample-bearer-value',
    'sample-token-value',
    'sample secret value',
    'sample-user',
    'sample-pass',
    'sample-query',
    '/private/sample',
    'stack',
  ])
    expect(persisted).not.toContain(value)
  expect(
    observationError({ scaleObservationError: { ...original, message: 'sample '.repeat(1000) } })
      .message.length
  ).toBe(512)
  const paths = observationError(
    {
      scaleObservationError: {
        kind: 'Error',
        message:
          'path:/private/sample [C:\\private\\sample] `/private/sample` /sample/vault/../private/sample',
      },
    },
    ['/sample/vault']
  )
  expect(JSON.stringify(paths)).not.toContain('private')
})
