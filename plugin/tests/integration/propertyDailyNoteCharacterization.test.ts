import { beforeEach, describe, expect, it } from 'vitest'
import { Notice } from 'obsidian'
import { openDailyNote } from '@/properties/dailyNote'
import { configureAbele, dailyJournal } from '../helpers/testEnv'
import { templateHarness } from '../helpers/templateHarness'

beforeEach(() => {
  configureAbele()
  Notice.shown.length = 0
})

describe('a date property opens its daily note', () => {
  it('prefers the configured daily journal and opens existing notes with the requested leaf', async () => {
    const env = templateHarness([{ path: 'Journals/2028/2028-02-29.md', content: 'keep' }])
    configureAbele({ journals: [dailyJournal()] })
    await openDailyNote(env.app, '2028-02-29', 'tab')
    expect(env.workspace.openLinkText).toHaveBeenCalledWith(
      'Journals/2028/2028-02-29.md',
      '',
      'tab'
    )
    expect(env.app.stats.create).toBe(0)
    expect(env.app.stats.modify).toBe(0)
  })

  it('creates a configured journal from its own template', async () => {
    const env = templateHarness([{ path: 'Templates/daily.md', content: 'Day {{date}}' }])
    configureAbele({ journals: [dailyJournal({ templatePath: 'Templates/daily.md' })] })
    await openDailyNote(env.app, '2028-02-29')
    const file = env.app.vault.getFileByPath('Journals/2028/2028-02-29.md')!
    expect(await env.app.vault.read(file)).toBe('Day 2028-02-29')
    expect(env.workspace.openLinkText).toHaveBeenCalledWith(file.path, '', false)
  })

  it('uses core Daily notes folder, format and template substitutions when no journal is configured', async () => {
    const env = templateHarness([
      {
        path: 'Templates/core.md',
        content: '{{title}} {{ DATE:YYYY-MM-DD }} {{date}} {{unknown}}',
      },
    ])
    Object.assign(env.app, {
      internalPlugins: {
        getPluginById: () => ({
          enabled: true,
          instance: {
            options: { folder: ' Daily/// ', format: 'YYYY/MM/DD', template: ' Templates/core ' },
          },
        }),
      },
    })
    await openDailyNote(env.app, '2028-02-29', 'tab')
    const file = env.app.vault.getFileByPath('Daily/2028/02/29.md')!
    expect(await env.app.vault.read(file)).toBe('29 2028-02-29 2028/02/29 {{unknown}}')
    expect(env.workspace.openLinkText).toHaveBeenCalledWith(file.path, '', 'tab')
    await openDailyNote(env.app, '2028-02-29', true)
    expect(env.app.stats.create).toBe(1)
    expect(env.workspace.openLinkText).toHaveBeenLastCalledWith(file.path, '', true)
  })

  it('uses default core options, tolerates a missing core template and reports no enabled provider', async () => {
    const env = templateHarness()
    await openDailyNote(env.app, '2028-03-01')
    expect(Notice.shown).toEqual(['No daily journal found. Please check your settings.'])
    Object.assign(env.app, { internalPlugins: { getPluginById: () => ({ enabled: false }) } })
    await openDailyNote(env.app, '2028-03-01')
    expect(env.app.stats.create).toBe(0)
    Object.assign(env.app, {
      internalPlugins: {
        getPluginById: () => ({
          enabled: true,
          instance: { options: { template: 'missing', format: ' ' } },
        }),
      },
    })
    await openDailyNote(env.app, '2028-03-01')
    expect(await env.app.vault.read(env.app.vault.getFileByPath('2028-03-01.md')!)).toBe('')
  })
})
