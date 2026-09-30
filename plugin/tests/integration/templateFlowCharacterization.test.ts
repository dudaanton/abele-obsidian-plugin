import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTemplateComposable, useTemplates } from '@/composables/useTemplates'
import { TemplateService } from '@/templates/TemplateService'
import { templateHarness } from '../helpers/templateHarness'
import * as vaultUtils from '@/helpers/vaultUtils'

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('template selection flow', () => {
  it('collects variables in body/folder/name/property order, deduplicating target names', async () => {
    const env = templateHarness()
    const template = await env.template('{{body}}', {
      target_folder: '{{folder}}/{{body}}',
      target_name: '{{name}}',
      template_for_topic: '{{property}} {{name}}',
    })
    const flow = useTemplates()
    await flow.startCreateFlow('selected text')
    expect(flow.templates.value.map((t) => t.name)).toEqual(['sample'])
    expect(flow.isSelectModalOpen.value).toBe(true)
    await flow.onTemplateSelected(template)
    expect(flow.isSelectModalOpen.value).toBe(false)
    expect(flow.isVariablesModalOpen.value).toBe(true)
    expect(flow.userVariables.value.map((v) => v.name)).toEqual([
      'body',
      'folder',
      'name',
      'property',
    ])
    expect([...flow.initialValues.value]).toEqual([
      ['selection', 'selected text'],
      ['body', 'selected text'],
    ])
    flow.closeModals()
    expect(flow.isVariablesModalOpen.value).toBe(false)
    expect(flow.selectedTemplate.value?.name).toBe('sample')
    flow.resetState()
    expect(flow.selectedTemplate.value).toBeNull()
    expect(flow.templates.value).toEqual([])
    expect(flow.userVariables.value).toEqual([])
    expect(flow.initialValues.value.size).toBe(0)
    expect(flow.action.value).toBe('create')
  })

  it('auto-applies a single input from selection, then opens the created note and resets', async () => {
    const env = templateHarness()
    const template = await env.template('Hello {{name}}', { target_name: 'generated' })
    const open = vi.spyOn(vaultUtils, 'openFile').mockResolvedValue(undefined)
    const flow = useTemplates()
    await flow.startCreateFlow('sample reader')
    await flow.onTemplateSelected(template)
    expect(await env.app.vault.read(env.app.vault.getFileByPath('generated.md')!)).toBe(
      'Hello sample reader'
    )
    expect(open).toHaveBeenCalledWith('generated.md')
    expect(flow.isVariablesModalOpen.value).toBe(false)
    expect(flow.selectedTemplate.value).toBeNull()
  })

  it('replaces only an active note; confirms explicit values and does not rename', async () => {
    const env = templateHarness([{ path: 'Notes/sample.md', content: 'old' }])
    const template = await env.template('{{text}}', { target_name: 'ignored' })
    const flow = useTemplates()
    await flow.startReplaceFlow()
    expect(flow.action.value).toBe('replace')
    await flow.onTemplateSelected(template)
    await flow.onVariablesConfirmed(new Map([['text', 'new']]))
    expect(await env.app.vault.read(env.app.vault.getFileByPath('Notes/sample.md')!)).toBe('new')
    expect(flow.action.value).toBe('create')
    env.workspace.getActiveFile.mockReturnValue(null)
    await flow.startReplaceFlow()
    expect(flow.isSelectModalOpen.value).toBe(false)
  })

  it('does nothing if the target closes while variables are being entered', async () => {
    const env = templateHarness([{ path: 'Notes/sample.md', content: 'keep' }])
    const template = await env.template('{{text}}')
    const flow = useTemplates()
    await flow.startReplaceFlow()
    await flow.onTemplateSelected(template)
    env.workspace.getActiveFile.mockReturnValue(null)
    await flow.onVariablesConfirmed(new Map([['text', 'new']]))
    expect(await env.app.vault.read(env.app.vault.getFileByPath('Notes/sample.md')!)).toBe('keep')
    expect(flow.selectedTemplate.value).toBeNull()
  })

  it('inserts at the current cursor without a modal when there is no input', async () => {
    const env = templateHarness()
    const template = await env.template('inserted')
    const editor = { getCursor: () => ({ line: 2, ch: 3 }), replaceRange: vi.fn() }
    env.workspace.getActiveViewOfType.mockReturnValue({ editor } as never)
    const flow = useTemplates()
    await flow.startInsertFlow()
    await flow.onTemplateSelected(template)
    expect(editor.replaceRange).toHaveBeenCalledWith('inserted', { line: 2, ch: 3 })
    expect(flow.selectedTemplate.value).toBeNull()
    env.workspace.getActiveViewOfType.mockReturnValue(null)
    await flow.startInsertFlow()
    await flow.onTemplateSelected(template)
    expect(editor.replaceRange).toHaveBeenCalledTimes(1)
  })

  it('resets after a service error and ignores confirmation without a selected template', async () => {
    const env = templateHarness()
    const template = await env.template('body')
    const create = vi
      .spyOn(TemplateService.getInstance(), 'createNoteFromTemplate')
      .mockRejectedValue(new Error('sample failure'))
    const flow = useTemplates()
    await flow.startCreateFlow()
    await flow.onTemplateSelected(template)
    expect(console.error).toHaveBeenCalledWith('Failed to apply template:', expect.any(Error))
    expect(flow.templates.value).toEqual([])
    expect(flow.selectedTemplate.value).toBeNull()
    await flow.onVariablesConfirmed(new Map())
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('starts by exact path or omitted extension, rejects absent templates, and shares only the global instance', async () => {
    const env = templateHarness()
    await env.template('{{input}}')
    const flow = useTemplates()
    for (const path of ['Templates/sample', 'Templates/sample.md']) {
      await flow.startCreateFlowWithTemplate(path)
      expect(flow.isVariablesModalOpen.value).toBe(true)
      expect(flow.selectedTemplate.value?.file.path).toBe('Templates/sample.md')
      flow.resetState()
    }
    await expect(flow.startCreateFlowWithTemplate('missing')).rejects.toThrow(
      'Template not found: missing'
    )
    expect(getTemplateComposable()).toBe(getTemplateComposable())
    expect(useTemplates()).not.toBe(getTemplateComposable())
    getTemplateComposable().resetState()
  })
})
