/**
 * The gate in front of every run: with `ai.confirmForeignScripts` on, a script that changed
 * without being written on this device does not run until it is confirmed here.
 *
 * «для любой синхронизации должна быть возможность ограничить скрипты (или хотя бы отключать их
 * до подтверждения)» (2026-09-27). A sync writes through the same vault calls the plugin does,
 * so here it is a plain `vault.modify` that nothing on this device recorded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Notice } from 'obsidian'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptTrust, ScriptWaitingError, noteLocalScriptWrite } from '@/scripting/ScriptTrust'
import { runStartupScripts } from '@/scripting/startupRunner'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'
import type { TFile } from 'obsidian'

const review = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => true))
vi.mock('@/scripting/reviewScript', () => ({ reviewScript: review }))

const SCRIPT = (name: string, body = `return '${name} ran'`) => `// @name ${name}\n${body}\n`

let service: ScriptService

const fakePlugin = () => ({
  addCommand: () => {},
  removeCommand: () => {},
  addStatusBarItem: () => createDiv(),
})

async function setup(on: boolean) {
  useVault([
    { path: 'Scripts/one.js', content: SCRIPT('One') },
    { path: 'Scripts/two.js', content: SCRIPT('Two') },
  ])
  ScriptService.destroy()
  ScriptTrust.reset()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    scriptsFolder: 'Scripts',
    confirmForeignScripts: on,
  }
  ;(AbeleConfig.getInstance() as unknown as { plugin: unknown }).plugin = fakePlugin()
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  service = ScriptService.getInstance()
  await service.discover()
}

/** The file changed the way a sync changes it: through the vault, recorded by nobody here. */
async function arrive(path: string, content: string) {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path) as TFile | null
  if (file) await app.vault.modify(file, content)
  else await app.vault.create(path, content)
  await service.discover()
}

const one = () => service.getAll().find((s) => s.meta.name.startsWith('One'))!

beforeEach(async () => {
  review.mockReset()
  review.mockResolvedValue(true)
  Notice.shown.length = 0
  await setup(true)
})

describe('scripts from elsewhere', () => {
  it('runs everything as before while the setting is off', async () => {
    await setup(false)
    await arrive('Scripts/one.js', SCRIPT('One', "return 'changed'"))
    expect(await service.execute(one().path, {}, { source: 'automation' })).toBe('changed')
    expect(review).not.toHaveBeenCalled()
  })

  it('takes the scripts there when it was switched on as confirmed', async () => {
    expect(service.verdict(one())).toBe('confirmed')
    expect(await service.execute(one().path, {}, { source: 'automation' })).toBe('One ran')
  })

  it('holds a changed script back from automations, startup, agents and other scripts', async () => {
    await arrive('Scripts/one.js', SCRIPT('One', "return 'changed'"))
    expect(service.verdict(one())).toBe('waiting')
    for (const source of ['automation', 'startup', 'agent', 'script', 'view'] as const) {
      await expect(service.execute(one().path, {}, { source })).rejects.toBeInstanceOf(
        ScriptWaitingError
      )
    }
    expect(review).not.toHaveBeenCalled()
  })

  it('holds back a script whose header alone changed', async () => {
    await arrive('Scripts/one.js', `// @name One\n// @startup\nreturn 'One ran'\n`)
    expect(service.verdict(one())).toBe('waiting')
  })

  it('holds back a new script that arrived', async () => {
    await arrive('Scripts/three.js', SCRIPT('Three'))
    const three = service.getAll().find((s) => s.meta.name === 'Three')!
    expect(service.verdict(three)).toBe('waiting')
    expect(service.waitingScripts().map((s) => s.meta.name)).toEqual(['Three'])
  })

  it('says once that something arrived to confirm', async () => {
    await arrive('Scripts/one.js', SCRIPT('One', "return 'changed'"))
    await service.discover()
    const said = Notice.shown.filter((n) => typeof n !== 'string')
    expect(said).toHaveLength(1)
    expect((said[0] as unknown as DocumentFragment).textContent).toContain('"One"')
  })

  it('puts a changed script in front of a person who chose it, and runs it once confirmed', async () => {
    await arrive('Scripts/one.js', SCRIPT('One', "return 'changed'"))
    const result = await service.execute(one().path, {}, { source: 'note' })
    expect(review).toHaveBeenCalledTimes(1)
    const [, request] = review.mock.calls[0] as [
      unknown,
      { script: { source: string }; previous?: string },
    ]
    expect(request.script.source).toContain('changed')
    // The diff is against the version last confirmed here.
    expect(request.previous).toBe(SCRIPT('One'))
    expect(result).toBe('changed')
    // Confirmed now: an automation runs it without asking.
    expect(await service.execute(one().path, {}, { source: 'automation' })).toBe('changed')
  })

  it('does not run it when the person leaves it waiting', async () => {
    review.mockResolvedValue(false)
    await arrive('Scripts/one.js', SCRIPT('One', "return 'changed'"))
    await expect(service.execute(one().path, {}, { source: 'command' })).rejects.toBeInstanceOf(
      ScriptWaitingError
    )
    expect(service.verdict(one())).toBe('waiting')
  })

  it('asks from the command palette before the form, and says nothing more when left waiting', async () => {
    review.mockResolvedValue(false)
    await arrive('Scripts/one.js', SCRIPT('One', "return 'changed'"))
    Notice.shown.length = 0
    await service.executeFromCommand(one().path)
    expect(review).toHaveBeenCalledTimes(1)
    expect(Notice.shown).toEqual([])
  })

  it('checks again a version that changed while the dialog was open', async () => {
    await arrive('Scripts/one.js', SCRIPT('One', "return 'first'"))
    review.mockImplementationOnce(async () => {
      const { app } = GlobalStore.getInstance()
      await app.vault.modify(
        app.vault.getAbstractFileByPath('Scripts/one.js') as TFile,
        SCRIPT('One', "return 'second'")
      )
      await service.discover()
      return true
    })
    review.mockResolvedValueOnce(false)
    await expect(service.execute(one().path, {}, { source: 'note' })).rejects.toBeInstanceOf(
      ScriptWaitingError
    )
    expect(review).toHaveBeenCalledTimes(2)
  })

  it('counts a script written on this device as confirmed', async () => {
    const text = SCRIPT('One', "return 'mine'")
    await noteLocalScriptWrite('Scripts/one.js', text)
    await arrive('Scripts/one.js', text)
    expect(service.verdict(one())).toBe('confirmed')
  })

  it('counts a script the agent wrote or edited with its file tools as written here', async () => {
    const { createWriteFileTool } = await import('@/ai/tools/WriteFileTool')
    const { createEditFileTool } = await import('@/ai/tools/EditFileTool')
    await createWriteFileTool({ skipScope: true }).execute('w', {
      path: 'Scripts/one.js',
      content: SCRIPT('One', "return 'agent'"),
    })
    await service.discover()
    expect(service.verdict(one())).toBe('confirmed')
    await createEditFileTool({ skipScope: true }).execute('e', {
      path: 'Scripts/one.js',
      old_string: "'agent'",
      new_string: "'agent again'",
    })
    await service.discover()
    expect(one().source).toContain('agent again')
    expect(service.verdict(one())).toBe('confirmed')
  })

  it('keeps a renamed script confirmed', async () => {
    const { app } = GlobalStore.getInstance()
    const source = SCRIPT('One')
    await app.vault.delete(app.vault.getAbstractFileByPath('Scripts/one.js') as TFile)
    await arrive('Scripts/renamed.js', source)
    expect(service.verdict(one())).toBe('confirmed')
  })

  it('keeps a waiting script from the agent tools', async () => {
    await arrive('Scripts/one.js', SCRIPT('One', "return 'changed'"))
    expect(service.getEnabledToolScripts().map((s) => s.meta.name)).toEqual(['Two'])
  })

  it('does not arm from an index that was never read', async () => {
    useVault([{ path: 'Scripts/one.js', content: SCRIPT('One') }])
    ScriptService.destroy()
    ScriptTrust.reset()
    service = ScriptService.getInstance()
    const fake = { path: 'Scripts/one.js', hash: 'x', meta: { name: 'One' } } as never
    service.verdict(fake)
    expect(ScriptTrust.getInstance().active()).toBe(false)
  })

  it('stays off on a device where it was switched off, whatever the settings file says', async () => {
    service.setConfirmForeign(false)
    await arrive('Scripts/one.js', SCRIPT('One', "return 'changed'"))
    expect(AbeleConfig.getInstance().ai.confirmForeignScripts).toBe(true)
    expect(service.verdict(one())).toBe('confirmed')
  })

  it('stays on when the settings file arrives switched off', async () => {
    AbeleConfig.getInstance().ai.confirmForeignScripts = false
    await arrive('Scripts/one.js', SCRIPT('One', "return 'changed'"))
    expect(service.verdict(one())).toBe('waiting')
  })

  it('does not index a script beside the folder whose name only starts the same', async () => {
    await arrive('Scripts-old/stray.js', SCRIPT('Stray'))
    expect(service.getAll().map((s) => s.meta.name)).not.toContain('Stray')
  })
})

describe('startup', () => {
  it('skips a startup script that waits to be confirmed rather than calling it failed', async () => {
    const report = await runStartupScripts({
      queue: [one()],
      paused: false,
      execute: async () => {
        throw new ScriptWaitingError('One')
      },
      storage: { load: () => null, save: () => {} },
      notify: () => {},
    })
    expect(report).toEqual([{ name: 'One', outcome: 'skipped' }])
  })
})
