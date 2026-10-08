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
  it('starts the first scan when layout becomes ready without another service lookup', async () => {
    const app = useVault([
      { path: 'Scripts/sample.js', content: '// @name Sample\nreturn "sample"' },
    ])
    const callbacks: Array<() => void> = []
    const workspace = Object.assign(app.workspace, {
      layoutReady: false,
      onLayoutReady: vi.fn((callback: () => void) => callbacks.push(callback)),
    })
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
    const discover = vi.spyOn(service, 'discover')
    let ready = false
    void service.ready.then(() => {
      ready = true
    })
    ScriptService.getInstance()
    ScriptService.getInstance()
    expect(discover).not.toHaveBeenCalled()
    workspace.layoutReady = true
    callbacks.forEach((callback) => callback())
    await vi.waitFor(() => expect(ready).toBe(true), { timeout: 200 })
    expect(workspace.onLayoutReady).toHaveBeenCalledOnce()
    expect(discover).toHaveBeenCalledOnce()
    expect(service.getAll().map((s) => s.path)).toEqual(['Scripts/sample.js'])
    expect(service.toolbar).toBeNull()
  })

  it('does not revive a standalone index destroyed before layout readiness', () => {
    const app = useVault([])
    const callbacks: Array<() => void> = []
    Object.assign(app.workspace, {
      layoutReady: false,
      onLayoutReady: (callback: () => void) => callbacks.push(callback),
    })
    ScriptService.destroy()
    const service = ScriptService.getInstance()
    const discover = vi.spyOn(service, 'discover')
    ScriptService.destroy()
    callbacks.forEach((callback) => callback())
    expect(discover).not.toHaveBeenCalled()
    expect(service.getAll()).toEqual([])
  })
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
