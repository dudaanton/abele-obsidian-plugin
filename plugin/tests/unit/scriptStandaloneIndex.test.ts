import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScriptService } from '@/scripting/ScriptService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

afterEach(() => {
  ScriptService.destroy()
  vi.restoreAllMocks()
})

describe('a direct script consumer after layout readiness', () => {
  it('gets a ready index without needing the optional background index or another settings save', async () => {
    const app = useVault([
      { path: 'Scripts/sample.js', content: '// @name Sample\nreturn "sample"' },
    ])
    Object.assign(app.workspace, { layoutReady: true })
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      enabled: false,
      scriptsEnabled: false,
      scriptsFolder: 'Scripts',
    }
    AbeleConfig.getInstance().plugin = {
      addCommand: vi.fn(),
      removeCommand: vi.fn(),
      addStatusBarItem: () => document.createElement('div'),
    } as never
    ScriptService.destroy()
    const service = ScriptService.getInstance()
    let ready = false
    void service.ready.then(() => {
      ready = true
    })
    await vi.waitFor(() => expect(ready).toBe(true), { timeout: 200 })
    expect(service.getAll().map((s) => s.path)).toEqual(['Scripts/sample.js'])
    expect(service.toolbar).toBeNull()
  })
})
