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
import { OperationDelays } from '../helpers/deferred'
import { VaultWatcherWrapper, type FileChangeEvent } from '@/helpers/VaultWatcherWrapper'
import { ScriptToolbar } from '@/scripting/toolbarButtons'
import { createAgent } from '@/ai/agents/types'

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

/** Hold chosen reads explicitly; hashing between reads still runs on the host. */
function slowReads(count = 2) {
  const delays = new OperationDelays<'read'>()
  const gates = Array.from({ length: count }, () => delays.holdNext('read'))
  const { app } = GlobalStore.getInstance()
  const read = app.vault.read.bind(app.vault)
  vi.spyOn(app.vault, 'read').mockImplementation(async (file) => {
    const gate = delays.take('read')
    if (gate) await gate
    return read(file)
  })
  return gates
}

describe('rebuilding the index', () => {
  it('keeps the old scripts in place until the new ones have all been read', async () => {
    const [first, second] = slowReads()

    const rebuild = service.discover()
    const during = service.getAll().map((s) => s.meta.name)
    const commandsDuring = commands.size
    await first.entered
    first.release()
    await second.entered
    const midway = service.getAll().map((s) => s.meta.name)
    second.release()
    await rebuild

    expect(during).toEqual(['One', 'Two'])
    expect(commandsDuring).toBe(2)
    expect(midway).toEqual(['One', 'Two'])
    expect(service.getAll().map((s) => s.meta.name)).toEqual(['One', 'Two'])
    expect(commands.size).toBe(2)
  })

  it('runs one rebuild at a time, and once more for one asked for meanwhile', async () => {
    const gates = slowReads(4)
    const { app } = GlobalStore.getInstance()
    const reads = vi.mocked(app.vault.read)
    reads.mockClear()

    const first = service.discover()
    const second = service.discover()
    expect(second).toBe(first)
    for (const gate of gates.slice(0, 2)) {
      await gate.entered
      gate.release()
    }
    await first
    const published = service.scriptList.value
    // The follow-up must publish too, not merely start its last read.
    for (const gate of gates.slice(2)) {
      await gate.entered
      gate.release()
    }
    await vi.waitFor(() => expect(service.scriptList.value).not.toBe(published))

    expect(reads).toHaveBeenCalledTimes(4)
    expect(service.getAll()).toHaveLength(2)
  })

  it('keeps the tool modes of scripts that are still there through overlapping rebuilds', async () => {
    const [gate] = slowReads(1)
    const config = AbeleConfig.getInstance()
    config.ai.toolModes = { script_one: 'auto', script_two: 'ask' } as never

    void service.discover()
    await gate.entered
    const rebuilding = service.discover()
    gate.release()
    await rebuilding
    const published = service.scriptList.value
    await vi.waitFor(() => expect(service.scriptList.value).not.toBe(published))

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

describe('service lifetime', () => {
  it('registers one watcher and toolbar even when initialization is requested twice', async () => {
    const toolbar = vi.spyOn(ScriptToolbar.prototype, 'start').mockImplementation(() => {})
    const watching = vi.spyOn(VaultWatcherWrapper.getInstance(), 'registerCallback')
    service.init()
    service.init()
    await service.discover()
    expect(watching).toHaveBeenCalledOnce()
    expect(toolbar).toHaveBeenCalledOnce()
    ScriptService.destroy()
  })

  it('does not restore commands after being destroyed while reading a script', async () => {
    const [gate] = slowReads(1)
    const reading = service.discover()
    await gate.entered
    ScriptService.destroy()
    gate.release()
    await reading
    expect(commands.size).toBe(0)
  })
})

describe('settings preserved before scripts arrive', () => {
  it.each(['Scripts/Helpers', 'Archive/Helpers'])(
    'updates the index and keeps modes only for an internal folder move to %s',
    async (destination) => {
      const app = GlobalStore.getInstance().app
      await app.vault.create('Scripts/Utilities/sample.js', SCRIPT('Sample'))
      await service.discover()
      const config = AbeleConfig.getInstance()
      config.ai.toolModes = { script_sample: 'auto' } as never
      config.ai.agents = [createAgent({ id: 'sample-agent', toolModes: { script_sample: 'ask' } })]
      VaultWatcherWrapper.destroy()
      vi.spyOn(ScriptToolbar.prototype, 'start').mockImplementation(() => {})
      service.init()
      await vi.waitFor(() =>
        expect((service as unknown as { discovering: unknown }).discovering).toBeNull()
      )
      const folder = app.vault.getAbstractFileByPath('Scripts/Utilities')!
      await app.vault.rename(folder, destination)
      ;(app as unknown as { emit(scope: string, event: string, ...args: unknown[]): void }).emit(
        'vault',
        'rename',
        folder,
        'Scripts/Utilities'
      )
      const internal = destination.startsWith('Scripts/')
      expect(config.ai.toolModes.script_sample).toBe(internal ? 'auto' : undefined)
      expect(config.ai.agents[0].toolModes.script_sample).toBe(internal ? 'ask' : undefined)
      await vi.waitFor(() => {
        expect(service.getAll().some((script) => script.path === `${destination}/sample.js`)).toBe(
          internal
        )
        expect(
          service.getAll().some((script) => script.path === 'Scripts/Utilities/sample.js')
        ).toBe(false)
      })
      ScriptService.destroy()
      VaultWatcherWrapper.destroy()
    }
  )

  it('drops only a known removed script mode, including its agents', async () => {
    const config = AbeleConfig.getInstance()
    config.ai.toolModes = { script_one: 'auto', script_two: 'ask', script_later: 'ask' } as never
    let event!: (event: FileChangeEvent) => void
    vi.spyOn(ScriptToolbar.prototype, 'start').mockImplementation(() => {})
    vi.spyOn(VaultWatcherWrapper.getInstance(), 'registerCallback').mockImplementation(
      (callback) => {
        event = callback
        return Symbol()
      }
    )
    service.init()
    await service.discover()
    event({ type: 'delete', oldPath: 'Scripts/one.js' })
    expect(config.ai.toolModes).toEqual({ script_two: 'ask', script_later: 'ask' })
    ScriptService.destroy()
  })

  it('keeps unknown script modes when discovery sees an empty folder', async () => {
    const config = AbeleConfig.getInstance()
    config.ai.toolModes = { script_later: 'auto', script_api_docs: 'ask' } as never
    useVault([])
    await service.discover()
    expect(config.ai.toolModes).toEqual({ script_later: 'auto', script_api_docs: 'ask' })
  })
})

describe('scripts named in Cyrillic', () => {
  it('each get a command and a tool of their own', async () => {
    useVault([
      { path: 'Scripts/sort.js', content: SCRIPT('Сортировать задачи под курсором') },
      { path: 'Scripts/close.js', content: SCRIPT('Закрыть задачи') },
    ])
    ScriptService.destroy()
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, scriptsFolder: 'Scripts' }
    commands.clear()
    ;(AbeleConfig.getInstance() as unknown as { plugin: unknown }).plugin = fakePlugin()
    const service = ScriptService.getInstance()

    await service.discover()

    expect([...commands.keys()].sort()).toEqual([
      'abele:script-sortirovat-zadachi-pod-kursorom',
      'abele:script-zakryt-zadachi',
    ])
    const { createScriptTools } = await import('@/ai/tools/ScriptTool')
    expect(
      createScriptTools()
        .map((t) => t.name)
        .sort()
    ).toEqual(['script_sortirovat-zadachi-pod-kursorom', 'script_zakryt-zadachi'])
  })
})
