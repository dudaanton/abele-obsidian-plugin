// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const stub = vi.hoisted(() => ({
  result: {
    status: 1,
    stdout: '',
    stderr: '',
    pid: 0,
    signal: null as string | null,
    error: undefined as Error | undefined,
  },
}))
vi.mock('node:child_process', () => ({ spawnSync: () => stub.result }))
import { vaultCli } from '../e2e/helpers/obsidianCli'
const secret = 'invented-private-password-marker'
beforeEach(() => {
  Object.assign(stub.result, {
    status: 1,
    stdout: '',
    stderr: '',
    pid: 0,
    signal: null,
    error: undefined,
  })
})
describe('sensitive native setup diagnostics', () => {
  it.each(['exit', 'spawn', 'parse'] as const)(
    'does not expose expression, output, stack or cause after %s failure',
    (mode) => {
      if (mode === 'exit') stub.result.stderr = secret
      if (mode === 'spawn') stub.result.error = new Error('spawn echoed ' + secret)
      if (mode === 'parse') {
        stub.result.status = 0
        stub.result.stdout = '=> invalid reply ' + secret
      }
      const cli = vaultCli('sample-vault') as ReturnType<typeof vaultCli> & {
        evalAwaitPrivate?: <T>(code: string) => T
      }
      const evaluate = cli.evalAwaitPrivate ?? cli.evalAwait
      let failure: unknown
      try {
        evaluate(`Promise.reject(new Error(${JSON.stringify(secret)}))`)
      } catch (e) {
        failure = e
      }
      expect(failure).toBeInstanceOf(Error)
      expect(String(failure)).not.toContain(secret)
      expect((failure as Error).stack).not.toContain(secret)
      expect(failure).not.toHaveProperty('cause')
      expect(failure).not.toHaveProperty('stdout')
      expect(failure).not.toHaveProperty('stderr')
    }
  )
})
