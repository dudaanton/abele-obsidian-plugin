/**
 * Rebuilding the script index without a moment in which there are no scripts.
 *
 * Every save of a script rebuilds the index, and it used to be emptied first and filled back
 * file by file: the agent's tools, the command palette and every picker saw an empty folder
 * for as long as the reads took, and two rebuilds set off together pruned the tool modes
 * against a half-built index. «Они то видны в списке, то нет» (2026-09-05).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScriptService } from '@/scripting/ScriptService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

const SCRIPT = (name: string) => `// @name ${name}\nreturn '${name}'\n`

let service: ScriptService

/** The plugin as the service needs it: a place to hang commands, which it counts. */
const commands = new Map<string, unknown>()
const fakePlugin = () => ({
  addCommand: (command: { id: string }) => commands.set(command.id, command),
  removeCommand: (id: string) => commands.delete(id),
})

beforeEach(async () => {
  useVault([
    { path: 'Scripts/one.js', content: SCRIPT('One') },
    { path: 'Scripts/two.js', content: SCRIPT('Two') },
  ])
  ScriptService.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, scriptsFolder: 'Scripts' }
  commands.clear()
  ;(AbeleConfig.getInstance() as unknown as { plugin: unknown }).plugin = fakePlugin()
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  service = ScriptService.getInstance()
  await service.discover()
})

/** Makes every read take a tick, so a rebuild is observable while it runs. */
function slowReads() {
  const { app } = GlobalStore.getInstance()
  const read = app.vault.read.bind(app.vault)
  vi.spyOn(app.vault, 'read').mockImplementation(async (file) => {
    await new Promise((r) => setTimeout(r, 5))
    return read(file)
  })
}

describe('rebuilding the index', () => {
  it('keeps the old scripts in place until the new ones have all been read', async () => {
    slowReads()

    const rebuild = service.discover()
    const during = service.getAll().map((s) => s.meta.name)
    const commandsDuring = commands.size
    await new Promise((r) => setTimeout(r, 7))
    const midway = service.getAll().map((s) => s.meta.name)
    await rebuild

    expect(during).toEqual(['One', 'Two'])
    expect(commandsDuring).toBe(2)
    expect(midway).toEqual(['One', 'Two'])
    expect(service.getAll().map((s) => s.meta.name)).toEqual(['One', 'Two'])
    expect(commands.size).toBe(2)
  })

  it('runs one rebuild at a time, and once more for one asked for meanwhile', async () => {
    slowReads()
    const { app } = GlobalStore.getInstance()
    const reads = vi.mocked(app.vault.read)
    reads.mockClear()

    const first = service.discover()
    const second = service.discover()
    expect(second).toBe(first)
    await first
    // The second request is served after the first, not alongside it.
    await new Promise((r) => setTimeout(r, 30))

    expect(reads).toHaveBeenCalledTimes(4)
    expect(service.getAll()).toHaveLength(2)
  })

  it('keeps the tool modes of scripts that are still there through overlapping rebuilds', async () => {
    slowReads()
    const config = AbeleConfig.getInstance()
    config.ai.toolModes = { script_one: 'auto', script_two: 'ask' } as never

    void service.discover()
    await new Promise((r) => setTimeout(r, 2))
    await service.discover()
    await new Promise((r) => setTimeout(r, 30))

    expect(config.ai.toolModes).toEqual({ script_one: 'auto', script_two: 'ask' })
  })

  it('publishes the new list for the screens that show it', async () => {
    const { app } = GlobalStore.getInstance()
    ;(app as unknown as { addFile: (p: string, c: string) => void }).addFile?.(
      'Scripts/three.js',
      SCRIPT('Three')
    )
    await service.discover()

    expect(service.scriptList.value.map((s) => s.meta.name)).toContain('One')
    expect(service.scriptList.value).toEqual(service.getAll())
  })
})
