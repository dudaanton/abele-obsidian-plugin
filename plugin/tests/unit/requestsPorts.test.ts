import { beforeEach, describe, expect, it, vi } from 'vitest'

const scripts = vi.hoisted(() => new Map<string, { path: string; meta: Record<string, unknown> }>())
const forRequest = vi.hoisted(() => vi.fn(async () => ({ vars: { token: 7 } })))
vi.mock('@/scripting/runScript', () => ({ findScriptByName: (name: string) => scripts.get(name) }))
vi.mock('@/scripting/ScriptService', () => ({
  ScriptService: { getInstance: () => ({ forRequest }) },
}))

import { scriptPort } from '@/requests/RequestsService'

const input = {
  environment: 'local',
  vars: {},
  request: { method: 'GET' as const, url: 'http://localhost:4000/', headers: {} },
}

beforeEach(() => {
  scripts.clear()
  forRequest.mockClear()
})

describe('scripts around a saved request', () => {
  it('runs only a script made to run around requests', async () => {
    scripts.set('Any script', { path: 'Scripts/any.js', meta: { name: 'Any script' } })
    scripts.set('Interceptor', {
      path: 'Scripts/intercept.js',
      meta: { name: 'Interceptor', request: true, interceptor: 30 },
    })
    await expect(scriptPort.run('Any script', input, true)).rejects.toThrow(/@request/)
    await expect(scriptPort.run('Interceptor', input, true)).rejects.toThrow(/@request/)
    await expect(scriptPort.run('Missing', input, true)).rejects.toThrow(/no script named/)
    expect(forRequest).not.toHaveBeenCalled()
  })

  it('hands the script the request and takes back values as text', async () => {
    scripts.set('Keep token', {
      path: 'Scripts/token.js',
      meta: { name: 'Keep token', request: true },
    })
    expect(await scriptPort.run('Keep token', input, false)).toEqual({ vars: { token: '7' } })
    expect(forRequest).toHaveBeenCalledWith('Scripts/token.js', input, false, undefined)
  })
})
