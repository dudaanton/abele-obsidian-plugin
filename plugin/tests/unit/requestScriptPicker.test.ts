import { describe, expect, it, vi } from 'vitest'
import { RequestScriptPicker } from '@/components/debugger/http/RequestScriptPicker'
import { assignRequestScript, requestScriptProblems } from '@/requests/scripts'
import { RequestsModel } from '@/requests/RequestsModel'
import { fakeNode, ports } from '../helpers/requestsFakeNode'
import { useVault } from '../helpers/testEnv'
import { ScriptService } from '@/scripting/ScriptService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

describe('request scripts', () => {
  it('creates a request script, opens it, and assigns its declared name', async () => {
    const app = useVault([])
    const openFile = vi.fn().mockResolvedValue(undefined)
    Object.assign(app.workspace, { getLeaf: () => ({ openFile }) })
    ScriptService.destroy()
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, scriptsFolder: 'Scripts' }
    ;(AbeleConfig.getInstance() as unknown as { plugin: unknown }).plugin = {
      addCommand: vi.fn(),
      removeCommand: vi.fn(),
    }
    const service = ScriptService.getInstance()
    const node = fakeNode()
    const model = new RequestsModel(node.rpc, 'sample-project', ports())
    const id = 'Samples/Create sample.http'
    await model.open(id)
    try {
      const name = await service.createRequestScript('New sample hook')
      await assignRequestScript(model, id, 'before', name)
      expect(service.getAll().find((s) => s.meta.name === name)?.meta.request).toBe(true)
      expect(openFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'Scripts/New sample hook.js' })
      )
      expect(node.files.get(id)?.scripts.before).toBe(name)
      await expect(service.createRequestScript(name)).rejects.toThrow('already')
      await expect(service.createRequestScript('../outside')).rejects.toThrow('script name')
    } finally {
      ScriptService.destroy()
    }
  })
  it('lists request scripts with descriptions and creates the typed name', () => {
    const create = vi.fn()
    const picker = new RequestScriptPicker(
      {} as never,
      [
        { name: 'Sample hook', description: 'Signs samples', request: true },
        { name: 'Other sample', request: false },
      ],
      'before',
      undefined,
      'Sample before',
      vi.fn(),
      create
    )
    expect(picker.getItems().filter((r) => r.kind === 'script')).toEqual([
      {
        kind: 'script',
        script: { name: 'Sample hook', description: 'Signs samples', request: true },
      },
    ])
    picker.inputEl.value = 'New sample hook'
    const row = picker.getItems().find((r) => r.kind === 'new')!
    picker.onChooseItem(row)
    expect(create).toHaveBeenCalledWith('New sample hook')
  })

  it('assigns, changes and removes scripts through the existing request save', async () => {
    const node = fakeNode()
    const model = new RequestsModel(node.rpc, 'sample-project', ports())
    const id = 'Samples/Create sample.http'
    await model.open(id)
    await assignRequestScript(model, id, 'before', 'Sample hook')
    expect(node.files.get(id)?.scripts).toEqual({ before: 'Sample hook' })
    await assignRequestScript(model, id, 'after', 'After sample')
    await assignRequestScript(model, id, 'before', 'Another sample')
    expect(node.files.get(id)?.scripts).toEqual({ before: 'Another sample', after: 'After sample' })
    await assignRequestScript(model, id, 'before', undefined)
    expect(node.files.get(id)?.scripts).toEqual({ after: 'After sample' })
  })

  it('distinguishes missing and ineligible scripts', () => {
    expect(
      requestScriptProblems({ before: 'Gone', after: 'Ordinary' }, [
        { name: 'Ordinary', request: false },
      ])
    ).toEqual({
      before: 'There is no script named Gone',
      after: 'Ordinary needs a // @request line',
    })
  })
})
