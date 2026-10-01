import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Notice } from 'obsidian'
import dayjs from 'dayjs'
import { load } from 'js-yaml'
// Initialize the store dependency graph first, as plugin startup does; templates and entities
// have a pre-existing import cycle when GenericTemplate itself is the first entry point.
import '@/stores/GlobalStore'
import { GenericTemplate } from '@/templates/GenericTemplate'
import { TimeEntryNoteTemplate } from '@/templates/TimeEntryNoteTemplate'
import { TransactionNoteTemplate } from '@/templates/TransactionNoteTemplate'
import { AbeleConfig } from '@/services/AbeleConfig'
import { getNoteRawFrontmatter } from '@/helpers/notesUtils'
import { templateHarness } from '../helpers/templateHarness'

class SampleTemplate extends GenericTemplate<{ name: string; body: string }> {
  protected getFilename(params: { name: string }) {
    return params.name
  }
  createTemplate(params: { body: string }) {
    return params.body
  }
}
const props = (text: string) => load(getNoteRawFrontmatter(text)!) as Record<string, unknown>
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('TZ', 'America/Los_Angeles')
  vi.setSystemTime(new Date('2028-03-01T00:30:00-08:00'))
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Notice.shown.length = 0
  AbeleConfig.getInstance().transactionTemplatePath = ''
  AbeleConfig.getInstance().defaultCurrency = 'EUR'
  AbeleConfig.getInstance().transactionPathTemplate = 'Ledger/{{date:YYYY}}/{{title}}'
  AbeleConfig.getInstance().timeEntryPathTemplate =
    'Timers/{{date:YYYY}}/{{date}} {{groups}} {{start}} {{end}}'
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('GenericTemplate file creation', () => {
  it('uses the same safe path for existence checks and writing, opening rather than overwriting', async () => {
    const env = templateHarness()
    const template = new SampleTemplate(env.app)
    const params = { name: 'sample#part^block', body: 'first' }
    const path = template.getFullPath(params)
    expect(path).toBe('Notes/samplepartblock.md')
    await template.createNoteWithTemplate(params)
    expect(await env.app.vault.read(env.app.vault.getFileByPath(path)!)).toBe('first')
    await template.createNoteWithTemplate({ ...params, body: 'second' })
    expect(await env.app.vault.read(env.app.vault.getFileByPath(path)!)).toBe('first')
    expect(env.workspace.openLinkText).toHaveBeenLastCalledWith(path, '', false)
    await template.createNoteWithTemplate({ ...params, body: 'second' }, false, true)
    expect(await env.app.vault.read(env.app.vault.getFileByPath(path)!)).toBe('second')
    expect(env.workspace.openLinkText).toHaveBeenCalledTimes(2)
  })

  it('opens a newly created file in the active markdown leaf and honors focus=false', async () => {
    const env = templateHarness()
    const openFile = vi.fn()
    env.workspace.getActiveViewOfType.mockReturnValue({ leaf: { openFile } } as never)
    const template = new SampleTemplate(env.app)
    await template.createNoteWithTemplate({ name: 'one', body: 'body' })
    expect(openFile).toHaveBeenCalledWith(env.app.vault.getFileByPath('Notes/one.md'))
    await template.createNoteWithTemplate({ name: 'two', body: 'body' }, false)
    await template.createNoteWithTemplate({ name: 'two', body: 'ignored' }, false)
    expect(openFile).toHaveBeenCalledTimes(1)
    expect(env.workspace.openLinkText).not.toHaveBeenCalled()
  })

  it('notifies on a failed write and does not open a nonexistent note', async () => {
    const env = templateHarness()
    vi.spyOn(env.app.vault, 'create').mockRejectedValue(new Error('sample write failure'))
    await new SampleTemplate(env.app).createNoteWithTemplate({ name: 'sample', body: 'body' })
    expect(Notice.shown).toEqual(['Could not create Notes/sample.md: sample write failure'])
    expect(env.workspace.openLinkText).not.toHaveBeenCalled()
  })
})

describe('TimeEntryNoteTemplate', () => {
  it('formats local timestamps and link aliases in configured paths, with Timer as the empty-groups label', () => {
    const env = templateHarness()
    const template = new TimeEntryNoteTemplate(env.app)
    expect(template.getFullPath({})).toBe('Timers/2028/2028-03-01 Timer .md')
    const params = {
      start: dayjs('2028-02-29T23:15:00'),
      end: dayjs('2028-03-01T01:05:00'),
      groups: ['[[Areas/One|Alias]]', '[[Areas/Two]]'],
    }
    expect(template.getFullPath(params)).toBe('Timers/2028/2028-02-29 Alias, Two 23-15 01-05.md')
    expect(props(template.createTemplate(params))).toEqual({
      type: 'time-entry',
      start: '2028-02-29T23:15:00',
      end: '2028-03-01T01:05:00',
      groups: params.groups,
    })
    expect(props(template.createTemplate({}))).toEqual({
      type: 'time-entry',
      start: '2028-03-01T00:30:00',
      end: null,
    })
  })

  it('honors explicit root folder and filename rather than the configured path', () => {
    const env = templateHarness()
    const template = new TimeEntryNoteTemplate(env.app)
    expect(template.getFullPath({ entryFolder: '', entryName: 'sample' })).toBe('sample.md')
    expect(template.getFullPath({ entryFolder: 'Custom', entryName: 'sample' })).toBe(
      'Custom/sample.md'
    )
  })
})

describe('TransactionNoteTemplate', () => {
  it('keeps zero amounts, explicit nulls, existing properties and content, and supplies default currency/date', () => {
    const env = templateHarness()
    const template = new TransactionNoteTemplate(env.app)
    const text = template.createTemplate({
      oldProps: { custom: ['keep'], type: 'old', amount: 10 },
      amount: 0,
      foreignAmount: null,
      from: '',
      content: '\nBody',
    })
    expect(props(text)).toEqual({
      custom: ['keep'],
      type: 'transaction',
      amount: 0,
      foreignAmount: null,
      from: '',
      currency: 'EUR',
      date: '2028-03-01',
    })
    expect(text.endsWith('---\n\nBody')).toBe(true)
    expect(template.getFullPath({ transactionName: 'sample', transactionFolder: '' })).toBe(
      'Ledger/2028/sample.md'
    )
  })

  it('uses UserTemplate metadata and arrays, but caller amounts/currency win over template values', async () => {
    const env = templateHarness()
    await env.template(
      '---\ntype: template\ntemplate_for: transaction\ncurrency: GBP\namount: 9\n---\nTemplate {{date.format("YYYY")}}',
      {
        template_for: 'transaction',
        template_for_from: '{{from}}',
        template_for_groups: ['[[Areas/Sample]]'],
      }
    )
    AbeleConfig.getInstance().transactionTemplatePath = 'Templates/sample.md'
    const template = new TransactionNoteTemplate(env.app)
    await template.createNoteWithTemplate(
      {
        transactionName: 'sample',
        transactionFolder: 'Ledger',
        date: dayjs('2028-02-29'),
        from: '[[Wallets/Sample]]',
        amount: 0,
        currency: 'USD',
      },
      false
    )
    const text = await env.app.vault.read(env.app.vault.getFileByPath('Ledger/sample.md')!)
    expect(props(text)).toMatchObject({
      type: 'transaction',
      currency: 'USD',
      amount: 0,
      date: '2028-02-29',
      from: '[[Wallets/Sample]]',
    })
    expect(text).toContain('Template 2028')
    expect(props(template.createTemplate({ amount: 2 }))).toMatchObject({
      amount: 2,
      currency: 'EUR',
    })
  })

  // BUG: createNoteWithTemplate prepares _renderedTemplate before the existing-file check.
  // When creation is skipped, the next call with explicit content consumes that stale body.
  it(
    'does not reuse a prepared template after opening an already existing transaction',
    async () => {
      const env = templateHarness([{ path: 'Ledger/existing.md', content: 'Existing' }])
      await env.template('---\ntype: template\ntemplate_for: transaction\n---\nStale template', {
        template_for: 'transaction',
      })
      AbeleConfig.getInstance().transactionTemplatePath = 'Templates/sample.md'
      const template = new TransactionNoteTemplate(env.app)
      await template.createNoteWithTemplate(
        { transactionName: 'existing', transactionFolder: 'Ledger' },
        false
      )
      await template.createNoteWithTemplate(
        { transactionName: 'new', transactionFolder: 'Ledger', content: 'Explicit body' },
        false
      )
      expect(await env.app.vault.read(env.app.vault.getFileByPath('Ledger/new.md')!)).toContain(
        'Explicit body'
      )
    }
  )

  it.each(['skipped', 'failed'])(
    'clears prepared content after a %s creation, including direct rendering',
    async (outcome) => {
      const env = templateHarness([{ path: 'Ledger/existing.md', content: 'Existing' }])
      await env.template('---\ntype: template\ntemplate_for: transaction\n---\nStale template', {
        template_for: 'transaction',
      })
      AbeleConfig.getInstance().transactionTemplatePath = 'Templates/sample.md'
      const template = new TransactionNoteTemplate(env.app)
      if (outcome === 'failed')
        vi.spyOn(env.workspace, 'openLinkText').mockImplementation(() => {
          throw new Error('sample open failure')
        })
      const pending = template.createNoteWithTemplate({
        transactionName: 'existing', transactionFolder: 'Ledger',
      })
      if (outcome === 'failed') await expect(pending).rejects.toThrow('sample open failure')
      else await pending
      expect(template.createTemplate({ content: 'Explicit body' })).toContain('Explicit body')
      expect(await env.app.vault.read(env.app.vault.getFileByPath('Ledger/existing.md')!)).toBe(
        'Existing'
      )
    }
  )

  it('does not apply a configured template when explicit content is provided', async () => {
    const env = templateHarness()
    await env.template('---\ntype: template\ntemplate_for: transaction\n---\nIgnored', {
      template_for: 'transaction',
    })
    AbeleConfig.getInstance().transactionTemplatePath = 'Templates/sample.md'
    await new TransactionNoteTemplate(env.app).createNoteWithTemplate(
      { transactionName: 'sample', transactionFolder: 'Ledger', content: 'Explicit' },
      false
    )
    expect(await env.app.vault.read(env.app.vault.getFileByPath('Ledger/sample.md')!)).toContain(
      'Explicit'
    )
  })
})
