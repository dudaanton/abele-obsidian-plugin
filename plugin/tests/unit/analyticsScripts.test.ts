/**
 * `analytics` in a script: the analysis spec answering with objects, the plain functions, and a
 * script of its own that already calls something `analytics` still compiling.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

let service: ScriptService

function register(name: string, code: string): string {
  const path = `Scripts/${name}.js`
  const scripts = (service as unknown as { scripts: Map<string, unknown> }).scripts
  scripts.set(path, { path, code, commandId: '', meta: { name, description: '', params: [] } })
  return path
}

beforeEach(() => {
  useVault([
    { path: 'Daily/2026-09-01.md', frontmatter: { weight: 80 } },
    { path: 'Daily/2026-09-02.md', frontmatter: { weight: 79 } },
    { path: 'Daily/2026-09-03.md', frontmatter: { weight: 78.5 } },
  ])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, scriptsEnabled: true }
  // No scope at all: a script reaches the whole vault, as its file operations do.
  ScopeResolver.getInstance().fullVaultAccess.value = false
  ScriptRuns.destroy()
  ScriptService.destroy()
  service = ScriptService.getInstance()
})

describe('analytics in scripts', () => {
  it('analyses a source and returns objects', async () => {
    const path = register(
      'Weight',
      `const a = await analytics.analyze({ source: { kind: 'notes', folder: 'Daily' }, value: 'weight', analyses: ['describe'] })
       const t = await analytics.read({ kind: 'notes', folder: 'Daily' })
       return JSON.stringify({ mean: a.describe.mean, rows: t.rows.length, sd: analytics.describe([2, 4, 4, 4, 5, 5, 7, 9]).mean })`
    )
    const out = JSON.parse(await service.execute(path, {}))
    expect(out).toEqual({ mean: 79.1667, rows: 3, sd: 5 })
  })

  it('lets a script keep its own `analytics`', async () => {
    const path = register('Own', `const analytics = 42; return String(analytics)`)
    expect(await service.execute(path, {})).toBe('42')
  })
})
