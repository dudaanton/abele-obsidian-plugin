// @vitest-environment node
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { metadataVersionProbe } from '../e2e/helpers/metadataVersionProbe'
import { withProbeFolder } from '../e2e/helpers/probeFolder'

const require = createRequire(import.meta.url)
describe('metadata probe folder ownership', () => {
  it.each(['already-present', 'failed-create'])(
    'does not delete a folder it did not successfully create: %s',
    async (mode) => {
      let lookups = 0
      const remove = vi.fn()
      const create = vi.fn(async () => {
        throw new Error('Create refused')
      })
      const app = {
        metadataCache: { work: () => {}, offref: () => {} },
        vault: {
          readBinary: () => {},
          createFolder: create,
          delete: remove,
          getAbstractFileByPath: (path: string) =>
            ++lookups === 1 && mode === 'failed-create' ? null : { path },
        },
        workspace: { getLayout: () => ({}), changeLayout: async () => {} },
      }
      await expect(runInNewContext(metadataVersionProbe, { app, require })).rejects.toThrow()
      expect(remove).not.toHaveBeenCalled()
    }
  )

  it.each(['failure', 'unacknowledged'])(
    'restart probe never cleans an unowned folder: %s',
    async (mode) => {
      const calls: string[] = []
      const cli = {
        evalAwait: <T>(code: string): T => {
          calls.push(code)
          if (mode === 'failure') throw new Error('Pre-existing folder')
          return false as T
        },
      }
      const run = vi.fn()
      await expect(withProbeFolder(cli, 'SampleRestart', run)).rejects.toThrow()
      expect(run).not.toHaveBeenCalled()
      expect(calls).toHaveLength(1)
      expect(calls.some((code) => code.includes('delete('))).toBe(false)
    }
  )

  it('uses distinct names and cleans only acknowledged creates, even if the body fails', async () => {
    const calls: string[] = []
    const cli = {
      evalAwait: <T>(code: string): T => {
        calls.push(code)
        return true as T
      },
    }
    let first = ''
    await expect(
      withProbeFolder(cli, 'SampleRestart', async (root) => {
        first = root
        throw new Error('Body failed')
      })
    ).rejects.toThrow('Body failed')
    const second = await withProbeFolder(cli, 'SampleRestart', async (root) => root)
    expect(first).toMatch(/^SampleRestart-[a-f0-9]{32}$/)
    expect(second).not.toBe(first)
    expect(calls.filter((code) => code.includes('delete('))).toHaveLength(2)
  })
})
