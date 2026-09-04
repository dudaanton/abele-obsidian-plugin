/**
 * The prelude hands a script fifty-odd names, and a script that declares one of them itself
 * cannot be compiled. Left alone, the engine's message is a bare `Identifier 'view' has
 * already been declared` with no hint of where `view` came from; the service says whose name
 * it is and what to do.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

let service: ScriptService

/** Puts a script in the index without a vault folder to discover it from. */
function register(name: string, code: string): string {
  const path = `Scripts/${name}.js`
  const scripts = (service as unknown as { scripts: Map<string, unknown> }).scripts
  scripts.set(path, { path, code, commandId: '', meta: { name, description: '', params: [] } })
  return path
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  ScriptRuns.destroy()
  ScriptService.destroy()
  service = ScriptService.getInstance()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('a script that declares a name the API already gave it', () => {
  it('is told whose name it is, and to rename', async () => {
    const path = register('Mine', 'const view = 1\nreturn view')

    await expect(service.execute(path, {}, { source: 'command' })).rejects.toThrow(
      '"view" is a name the script API reserves; rename it in this script'
    )
  })

  it('is told the same for a component class', async () => {
    const path = register('Mine', 'function Table() {}\nlet Search = 2')

    await expect(service.execute(path, {}, { source: 'command' })).rejects.toThrow(
      /"(Table|Search)" is a name the script API reserves/
    )
  })

  it('still gets the engine own message for a name of its own declared twice', async () => {
    const path = register('Mine', 'const mine = 1\nconst mine = 2')

    await expect(service.execute(path, {}, { source: 'command' })).rejects.toThrow(
      "Identifier 'mine' has already been declared"
    )
  })

  it('runs a script that shadows nothing', async () => {
    const path = register('Mine', 'const mine = 1\nreturn mine + 1')

    await expect(service.execute(path, {}, { source: 'command' })).resolves.toBe('2')
  })
})
