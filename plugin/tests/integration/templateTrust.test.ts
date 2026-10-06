import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Notice } from 'obsidian'
import { TemplateService } from '@/templates/TemplateService'
import {
  ScriptTrust,
  TEMPLATE_TRUST_KEY,
  noteLocalScriptWrite,
  sha256,
} from '@/scripting/ScriptTrust'
import { templateReviewSource } from '@/templates/TemplateTrust'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { createApplyTemplateTool } from '@/ai/tools/TemplateTool'
import { applyTemplateVariables, parseTemplateVariables } from '@/templates/TemplateParser'
import { UserTemplate } from '@/templates/UserTemplate'
import { TransactionNoteTemplate } from '@/templates/TransactionNoteTemplate'
import { confirmTemplate, templateHarness } from '../helpers/templateHarness'
import { useTemplates } from '@/composables/useTemplates'
import * as vaultUtils from '@/helpers/vaultUtils'

const review = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => true))
vi.mock('@/scripting/reviewScript', () => ({ reviewScript: review }))

beforeEach(() => {
  ScriptTrust.reset()
  Notice.shown.length = 0
  review.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.querySelectorAll('.notice').forEach((el) => el.remove())
})

const service = () => TemplateService.getInstance()
const reviewNotice = async (index = 0) => {
  const fragment = Notice.shown.filter((n) => typeof n !== 'string')[index] as DocumentFragment
  expect(fragment.textContent).toContain('not run')
  const calls = review.mock.calls.length
  fragment.querySelector('button')!.click()
  await vi.waitFor(() => expect(review).toHaveBeenCalledTimes(calls + 1))
  // The click handler confirms asynchronously after the dialog resolves.
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('template execution trust', () => {
  it('creates the note without callbacks, announces once, and uses the script review dialog', async () => {
    const env = templateHarness()
    const template = await env.template('Plain body', { callbacks: 'command:sample:run' })
    const first = await service().createNoteFromTemplate(template, new Map())
    await service().createNoteFromTemplate(template, new Map())
    expect(await env.app.vault.read(first)).toBe('Plain body')
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
    expect(Notice.shown).toHaveLength(1)
    expect(review).not.toHaveBeenCalled()
    await reviewNotice()
    expect(review.mock.calls[0][1]).toMatchObject({
      template: { path: template.file.path, source: expect.stringContaining('sample:run') },
    })
    // Reviewing does not replay commands or create another note.
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
    await service().createNoteFromTemplate(template, new Map())
    expect(env.commands.executeCommandById).toHaveBeenCalledOnce()
    await env.app.vault.modify(template.file, 'Edited body')
    await service().createNoteFromTemplate(template, new Map())
    expect(env.commands.executeCommandById).toHaveBeenCalledOnce()
    expect(Notice.shown).toHaveLength(2)
  })

  it('keeps both exact versions approved when their notices are confirmed out of order', async () => {
    const env = templateHarness()
    const storage = new Map<string, unknown>()
    Object.assign(env.app, {
      loadLocalStorage: (key: string) => storage.get(key),
      saveLocalStorage: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    })
    const template = await env.template('First body', { callbacks: 'command:sample:run' })
    await service().createNoteFromTemplate(template, new Map())
    await env.app.vault.modify(template.file, 'Second body')
    await service().createNoteFromTemplate(template, new Map())
    expect(Notice.shown).toHaveLength(2)
    await reviewNotice(1)
    await reviewNotice(0)
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()

    for (const reload of [false, true]) {
      if (reload) ScriptTrust.reset()
      for (const body of ['Second body', 'First body']) {
        await env.app.vault.modify(template.file, body)
        const before = env.commands.executeCommandById.mock.calls.length
        const file = await service().createNoteFromTemplate(template, new Map())
        expect(await env.app.vault.read(file)).toBe(body)
        expect(env.commands.executeCommandById).toHaveBeenCalledTimes(before + 1)
      }
    }
    expect(Notice.shown).toHaveLength(2)
    expect(review).toHaveBeenCalledTimes(2)
  })

  it('keeps an unchanged copy approved after confirming new content at the original path', async () => {
    const env = templateHarness()
    const properties = { callbacks: 'command:sample:run' }
    const original = await env.template('Shared body', properties)
    const copy = await env.template('Shared body', properties, 'Templates/copy.md')
    await service().createNoteFromTemplate(original, new Map())
    await reviewNotice()
    await service().createNoteFromTemplate(copy, new Map())
    expect(env.commands.executeCommandById).toHaveBeenCalledOnce()
    expect(Notice.shown).toHaveLength(1)
    await env.app.vault.modify(original.file, 'New body')
    await service().createNoteFromTemplate(original, new Map())
    await reviewNotice(1)
    await service().createNoteFromTemplate(copy, new Map())
    expect(env.commands.executeCommandById).toHaveBeenCalledTimes(2)
    expect(Notice.shown).toHaveLength(2)
  })

  it('preserves approvals loaded from the previous single-version storage format', async () => {
    const env = templateHarness()
    const template = await env.template('Saved body', { callbacks: 'command:sample:run' })
    const text = templateReviewSource(template, 'Saved body', await template.getBody('Saved body'))
    const storage = new Map<string, unknown>([
      [
        TEMPLATE_TRUST_KEY,
        {
          armed: true,
          declined: false,
          refused: [],
          scripts: { [template.file.path]: { hash: await sha256(text), text } },
        },
      ],
    ])
    Object.assign(env.app, {
      loadLocalStorage: (key: string) => storage.get(key),
      saveLocalStorage: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    })
    await service().createNoteFromTemplate(template, new Map())
    expect(env.commands.executeCommandById).toHaveBeenCalledOnce()
    expect(Notice.shown).toHaveLength(0)
    await env.app.vault.modify(template.file, 'New body')
    await service().createNoteFromTemplate(template, new Map())
    await reviewNotice()
    ScriptTrust.reset()
    await env.app.vault.modify(template.file, 'Saved body')
    await service().createNoteFromTemplate(template, new Map())
    expect(env.commands.executeCommandById).toHaveBeenCalledTimes(2)
    expect(Notice.shown).toHaveLength(1)
  })

  it('offers review again after the waiting notice is dismissed', async () => {
    const env = templateHarness()
    const template = await env.template('Body', { callbacks: 'command:sample:run' })
    await service().createNoteFromTemplate(template, new Map())
    const message = Notice.shown[0] as unknown as HTMLElement
    expect(message.closest('.notice')?.isConnected).toBe(true)
    message.closest('.notice')!.remove()
    await service().createNoteFromTemplate(template, new Map())
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
    expect(Notice.shown).toHaveLength(2)
    await reviewNotice(1)
    await service().createNoteFromTemplate(template, new Map())
    expect(env.commands.executeCommandById).toHaveBeenCalledOnce()
  })

  it.each(['body', 'property', 'folder', 'name'] as const)(
    'holds plugin methods in the %s and keeps plain input',
    async (location) => {
      const env = templateHarness()
      const method = vi.fn(async () => 'executed')
      Object.assign(env.app, { plugins: { plugins: { sample: { convert: method } } } })
      const token = '{{sample;convert;Input}}'
      const template = await env.template(location === 'body' ? token : 'Body', {
        ...(location === 'property' ? { template_for_topic: token } : {}),
        ...(location === 'folder' ? { target_folder: token } : {}),
        ...(location === 'name' ? { target_name: token } : {}),
      })
      const values = new Map([['Input', 'safe']])
      const file = await service().createNoteFromTemplate(template, values)
      expect(method).not.toHaveBeenCalled()
      if (location === 'folder') expect(file.path).toBe('safe/Untitled.md')
      else if (location === 'name') expect(file.path).toBe('safe.md')
      else expect(await env.app.vault.read(file)).toContain('safe')
      await reviewNotice()
      await service().createNoteFromTemplate(template, values)
      expect(method).toHaveBeenCalledOnce()
    }
  )

  it('holds callbacks in replace, insert and automatic defaults without blocking writes', async () => {
    const env = templateHarness([{ path: 'empty.md' }])
    const template = await env.template('Body', {
      template_for: 'default',
      callbacks: 'command:sample:run',
    })
    const file = env.app.vault.getFileByPath('empty.md')!
    await service().replaceNoteWithTemplate(template, file, new Map())
    expect(await service().insertTemplateAtCursor(template, new Map())).toBe('Body')
    expect(await service().applyDefaultTemplate(file)).toBe(true)
    expect(await env.app.vault.read(file)).toBe('Body')
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
  })

  it('does not ask for ordinary variables, dates or ignored callbacks', async () => {
    const env = templateHarness()
    const template = await env.template('Hello {{Name}} {{date}}', { callbacks: 'ignored' })
    const file = await service().createNoteFromTemplate(template, new Map([['Name', 'reader']]))
    expect(await env.app.vault.read(file)).toContain('Hello reader')
    expect(Notice.shown).toEqual([])
    expect(review).not.toHaveBeenCalled()
  })

  it('does not confirm a newer version that arrives while the review is open', async () => {
    const env = templateHarness()
    const template = await env.template('Body', { callbacks: 'command:sample:run' })
    await service().createNoteFromTemplate(template, new Map())
    review.mockImplementationOnce(async () => {
      await env.app.vault.modify(template.file, 'Changed during review')
      return true
    })
    await reviewNotice()
    await service().createNoteFromTemplate(template, new Map())
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
  })

  it('holds agent and direct script-tool applications even with script confirmation off', async () => {
    const env = templateHarness()
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, confirmForeignScripts: false }
    const template = await env.template('Body', { callbacks: 'command:sample:run' })
    // File tools use the same write recorder; writing a template must not approve it.
    await noteLocalScriptWrite(template.file.path, await template.getContent())
    for (const ctx of [undefined, { scope: { addFile: vi.fn() }, interactive: false }]) {
      const result = await createApplyTemplateTool().execute(
        'sample-call',
        {
          path: template.file.path,
        },
        undefined,
        ctx as never
      )
      expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('Created:') }])
    }
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
    expect(Notice.shown).toHaveLength(1)
  })

  it('does not reuse approval for different indexed commands while metadata catches up', async () => {
    const env = templateHarness()
    const template = await env.template('Body', { callbacks: 'command:sample:first' })
    await service().createNoteFromTemplate(template, new Map())
    await reviewNotice()
    const changed = new UserTemplate(template.file, {
      type: 'template',
      template_for: 'sample',
      callbacks: 'command:sample:second',
    })
    await service().createNoteFromTemplate(changed, new Map())
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
    expect(Notice.shown).toHaveLength(2)
  })

  it('rechecks the applied type when metadata catches up, but reuses an unchanged confirmation', async () => {
    const env = templateHarness()
    // The file already changed, but the metadata still supplies the previous output type.
    const source =
      '---\ntype: template\ntemplate_for: article\ncallbacks: command:sample:mark\n---\nBody'
    const properties = { template_for: 'draft', callbacks: 'command:sample:mark' }
    const template = await env.template(source, properties)
    await service().createNoteFromTemplate(template, new Map())
    await reviewNotice()
    const unchanged = await service().createNoteFromTemplate(template, new Map())
    expect(await env.app.vault.read(unchanged)).toContain('type: draft')
    expect(env.commands.executeCommandById).toHaveBeenCalledOnce()
    expect(Notice.shown).toHaveLength(1)

    env.app.setFrontmatter(template.file.path, {
      type: 'template',
      ...properties,
      template_for: 'article',
    })
    const updated = UserTemplate.fromFile(template.file)!
    const changed = await service().createNoteFromTemplate(updated, new Map())
    expect(await env.app.vault.read(changed)).toContain('type: article')
    expect(env.commands.executeCommandById).toHaveBeenCalledOnce()
    expect(Notice.shown).toHaveLength(2)
    expect(review.mock.calls[0][1]).toMatchObject({
      template: { source: expect.stringContaining('Prepared template body:\n---\ntype: draft') },
    })
  })

  it('checks the retained template type when the file is restored while its input form is open', async () => {
    const env = templateHarness()
    const method = vi.fn(async () => 'unreviewed result')
    Object.assign(env.app, { plugins: { plugins: { 'sample-transformer': { convert: method } } } })
    vi.spyOn(vaultUtils, 'openFile').mockResolvedValue(undefined)
    const original =
      '---\ntype: template\ntemplate_for: draft\ncallbacks: command:sample:mark\ntarget_name: Sample output\n---\nBody'
    const properties = {
      template_for: 'draft',
      callbacks: 'command:sample:mark',
      target_name: 'Sample output',
    }
    const template = await env.template(original, properties)
    await confirmTemplate(template)
    const injectedType = '{{sample-transformer;convert;Topic}}'
    await env.app.vault.modify(
      template.file,
      original.replace('template_for: draft', `template_for: "${injectedType}"`)
    )
    env.app.setFrontmatter(template.file.path, {
      type: 'template',
      ...properties,
      template_for: injectedType,
    })
    const flow = useTemplates()
    await flow.startCreateFlowWithTemplate(template.file.path)
    expect(flow.isVariablesModalOpen.value).toBe(true)
    expect(flow.selectedTemplate.value?.templateFor).toBe(injectedType)
    await env.app.vault.modify(template.file, original)
    env.app.setFrontmatter(template.file.path, { type: 'template', ...properties })
    await flow.onVariablesConfirmed(new Map([['Topic', 'safe']]))
    expect(method).not.toHaveBeenCalled()
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
    expect(await env.app.vault.read(env.app.vault.getFileByPath('Sample output.md')!)).toContain(
      'type: safe'
    )
    expect(Notice.shown).toHaveLength(1)
  })

  it.each(['create', 'replace', 'insert'] as const)(
    'checks the actual prepared body, not just file text, before %s',
    async (action) => {
      const env = templateHarness([{ path: 'target.md' }])
      const method = vi.fn(async () => 'unreviewed result')
      Object.assign(env.app, { plugins: { plugins: { sample: { convert: method } } } })
      const template = await env.template('Body', { callbacks: 'command:sample:mark' })
      await confirmTemplate(template)
      // A body transformation can inject executable variables without editing the source file.
      const read = vi.spyOn(template, 'getContent')
      const prepare = vi
        .spyOn(template, 'getBody')
        .mockResolvedValue('Prepared {{sample;convert;Topic}}')
      const values = new Map([['Topic', 'safe']])
      let text: string
      if (action === 'create') {
        const file = await service().createNoteFromTemplate(template, values)
        text = await env.app.vault.read(file)
      } else if (action === 'replace') {
        const file = env.app.vault.getFileByPath('target.md')!
        await service().replaceNoteWithTemplate(template, file, values)
        text = await env.app.vault.read(file)
      } else {
        text = await service().insertTemplateAtCursor(template, values)
      }
      expect(method).not.toHaveBeenCalled()
      expect(env.commands.executeCommandById).not.toHaveBeenCalled()
      expect(text).toBe('Prepared safe')
      expect(read).toHaveBeenCalledOnce()
      expect(prepare).toHaveBeenCalledExactlyOnceWith('Body')
      expect(Notice.shown).toHaveLength(1)
    }
  )

  it('executes only the checked settings snapshot if the indexed object changes during application', async () => {
    const env = templateHarness()
    const method = vi.fn(async () => 'resolved')
    const unreviewed = vi.fn(async () => 'unreviewed result')
    const template = await env.template('{{sample;convert;Topic}}', {
      callbacks: 'command:sample:mark',
      template_for_topic: 'original',
      target_name: 'Sample output',
      target_folder: 'Output',
    })
    Object.assign(env.app, { plugins: { plugins: { sample: { convert: method, unreviewed } } } })
    await confirmTemplate(template)
    method.mockImplementationOnce(async () => {
      template.callbacks.push('sample:unreviewed')
      template.targetProperties[0].value = '{{sample;unreviewed;Topic}}'
      Object.assign(template, { targetName: '{{sample;unreviewed;Topic}}', targetFolder: 'Other' })
      return 'resolved'
    })
    const file = await service().createNoteFromTemplate(template, new Map([['Topic', 'safe']]))
    expect(unreviewed).not.toHaveBeenCalled()
    expect(file.path).toBe('Output/Sample output.md')
    expect(await env.app.vault.read(file)).toContain('topic: original')
    expect(env.commands.executeCommandById.mock.calls).toEqual([['sample:mark']])
  })

  it('persists approvals only in device-local storage and rereads them on reload', async () => {
    const env = templateHarness()
    let storage = new Map<string, unknown>()
    Object.assign(env.app, {
      loadLocalStorage: (key: string) => storage.get(key),
      saveLocalStorage: (key: string, value: unknown) => storage.set(key, value),
    })
    const template = await env.template('Body', { callbacks: 'command:sample:run' })
    await service().createNoteFromTemplate(template, new Map())
    expect(storage.size).toBe(0)
    await reviewNotice()
    expect([...storage.keys()]).toEqual([TEMPLATE_TRUST_KEY])
    ScriptTrust.reset()
    await service().createNoteFromTemplate(template, new Map())
    expect(env.commands.executeCommandById).toHaveBeenCalledOnce()
    // Same vault and settings on a different device have no approvals.
    storage = new Map()
    ScriptTrust.reset()
    await service().createNoteFromTemplate(template, new Map())
    expect(env.commands.executeCommandById).toHaveBeenCalledOnce()
  })

  it('holds standalone plugin placeholders until their text is explicitly reviewed', async () => {
    const env = templateHarness()
    const method = vi.fn(async () => 'executed')
    Object.assign(env.app, { plugins: { plugins: { sample: { convert: method } } } })
    const text = '{{sample;convert;Input}}'
    const { variables } = parseTemplateVariables(text)
    expect(await applyTemplateVariables(text, variables, new Map([['Input', 'safe']]))).toBe('safe')
    expect(method).not.toHaveBeenCalled()
    await reviewNotice()
    expect(await applyTemplateVariables(text, variables, new Map())).toBe('executed')
    expect(method).toHaveBeenCalledOnce()
  })

  it('holds plugin methods in transaction template bodies as well', async () => {
    const env = templateHarness()
    const method = vi.fn(async () => 'executed')
    Object.assign(env.app, { plugins: { plugins: { sample: { convert: method } } } })
    const template = await env.template('{{sample;convert;Input}}')
    AbeleConfig.getInstance().transactionTemplatePath = template.file.path
    const transaction = new TransactionNoteTemplate(env.app)
    await transaction.createNoteWithTemplate(
      {
        transactionName: 'sample-transaction',
        transactionFolder: 'Output',
      },
      false
    )
    expect(env.app.vault.getFileByPath('Output/sample-transaction.md')).not.toBeNull()
    expect(method).not.toHaveBeenCalled()
    await reviewNotice()
    await transaction.createNoteWithTemplate(
      {
        transactionName: 'another-transaction',
        transactionFolder: 'Output',
      },
      false
    )
    expect(method).toHaveBeenCalledOnce()
  })

  it('leaving review waiting preserves the note and lets the same notice review it later', async () => {
    const hide = vi.spyOn(Notice.prototype, 'hide')
    const env = templateHarness()
    const template = await env.template('Body', { callbacks: 'command:sample:run' })
    review.mockResolvedValue(false)
    const file = await service().createNoteFromTemplate(template, new Map())
    await reviewNotice()
    await service().createNoteFromTemplate(template, new Map())
    expect(await env.app.vault.read(file)).toBe('Body')
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
    expect(hide).not.toHaveBeenCalled()
    review.mockResolvedValue(true)
    await reviewNotice()
    expect(hide).toHaveBeenCalledOnce()
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
    await service().createNoteFromTemplate(template, new Map())
    expect(env.commands.executeCommandById).toHaveBeenCalledOnce()
  })
})
