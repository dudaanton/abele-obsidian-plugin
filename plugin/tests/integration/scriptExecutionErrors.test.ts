import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { scriptForExecution } from '@/scripting/trust/scriptExecutionGate'

const path = 'Scripts/local-sample.js'
let app: App
beforeEach(() => {
  app = useVault([{ path, content: '// @name Local sample\nreturn "local"' }]) as unknown as App
})
afterEach(() => vi.restoreAllMocks())

describe('readable execution failures on engines with frame-only stacks', () => {
  it('does not lose a rejection reason when a consumer prints the Safari-style stack', async () => {
    const error = new Error('Script source could not be read')
    error.stack = 'scriptForExecution@\n@'
    vi.spyOn(app.vault.adapter, 'readBinary').mockRejectedValue(error)
    const failure = await scriptForExecution(app, path).catch((e: Error) => e)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).stack).toContain('Script source could not be read')
  })
  it('supplies a readable fallback when a native rejection has no message at all', async () => {
    const error = new Error('')
    error.stack = 'scriptForExecution@'
    vi.spyOn(app.vault.adapter, 'readBinary').mockRejectedValue(error)
    const failure = await scriptForExecution(app, path).catch((e: Error) => e)
    expect((failure as Error).message).toMatch(/script.*check.*failed|could not/i)
    expect((failure as Error).stack).toContain((failure as Error).message)
    expect((failure as Error).message).toContain(path)
    expect((failure as Error).cause).toBe(error)
  })
})
