import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fm from 'front-matter'
import { load } from 'js-yaml'
import { TFile, stringifyYaml } from 'obsidian'
import {
  getFrontmatterFromCache,
  getNoteBody,
  getNoteData,
  getNoteRawFrontmatter,
  parseNoteContent,
  replaceNoteBody,
  updateNoteFrontmatter,
  renderTemplate,
  createNoteFromTemplate,
} from '@/helpers/notesUtils'
import { templateHarness } from '../helpers/templateHarness'
import { createNoteInGroup } from '@/commands/createNoteInGroup'
import { AbeleConfig, DEFAULT_SETTINGS, type AbeleSettings } from '@/services/AbeleConfig'

// Assert the object handed to the host serializer, not JSON masquerading as host YAML.
// Actual host formatting/cache timestamp coercion remains an Obsidian integration concern.
vi.mock('obsidian', async (importOriginal) => {
  const original = await importOriginal<typeof import('obsidian')>()
  const { dump } = await import('js-yaml')
  return { ...original, stringifyYaml: vi.fn((value: unknown) => dump(value)) }
})

beforeEach(() => {
  vi.stubEnv('TZ', 'America/Los_Angeles')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2028-03-01T00:30:00-08:00'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(stringifyYaml).mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
const parse = (text: string) => parseNoteContent(new TFile(), text)

describe('the installed front-matter package and note parser', () => {
  it('exposes unquoted timestamps as Dates, quoted timestamps as strings, converting only top-level Dates locally', async () => {
    const text = `---
day: 2028-03-01
quoted: '2028-03-01'
time: 2028-03-01T18:45:12Z
midnight: 2028-03-01T08:00:00Z
quotedTime: "2028-03-01T18:45:12Z"
nested:
  day: 2028-03-01
list: [2028-03-01, '2028-03-01']
---

Body`
    const raw = fm<Record<string, unknown>>(text)
    expect(raw.attributes.day).toEqual(new Date('2028-03-01T00:00:00Z'))
    expect(raw.attributes.quoted).toBe('2028-03-01')
    expect(raw.body).toBe('Body')
    expect(await parse(text)).toEqual({
      day: '2028-02-29T16:00:00',
      quoted: '2028-03-01',
      time: '2028-03-01T10:45:12',
      midnight: '2028-03-01',
      quotedTime: '2028-03-01T18:45:12Z',
      nested: { day: new Date('2028-03-01T00:00:00Z') },
      list: [new Date('2028-03-01T00:00:00Z'), '2028-03-01'],
      content: '\nBody',
    })
  })

  it('pins YAML 1.1 octal versus the direct js-yaml reader, booleans, empty values, comments and links', async () => {
    const yaml = `octal: 012
quotedNumber: "012"
yes: yes
on: on
boolean: true
empty:
nullValue: null
emptyText: ''
comment: kept # discarded
quotedComment: "kept # intact"
links:
  - "[[Notes/Sample|Label]]"
  - [[Notes/Other]]
inline: [one, 2, false]
nested:
  child: value
literal: |
  first
  second
folded: >
  first
  second`
    const parsed = await parse(`---\n${yaml}\n---\nBody`)
    expect(parsed).toEqual({
      octal: 10,
      quotedNumber: '012',
      yes: 'yes',
      on: 'on',
      boolean: true,
      empty: null,
      nullValue: null,
      emptyText: '',
      comment: 'kept',
      quotedComment: 'kept # intact',
      links: ['[[Notes/Sample|Label]]', [['Notes/Other']]],
      inline: ['one', 2, false],
      nested: { child: 'value' },
      literal: 'first\nsecond\n',
      folded: 'first second\n',
      content: 'Body',
    })
    expect((load(yaml) as Record<string, unknown>).octal).toBe(12)
  })

  it('supports anchors and merges, rejects duplicate keys and malformed YAML rather than discarding them', async () => {
    expect(
      await parse('---\nbase: &base\n  keep: true\ncopy:\n  <<: *base\n  extra: 2\n---\nBody')
    ).toMatchObject({ base: { keep: true }, copy: { keep: true, extra: 2 } })
    for (const yaml of ['key: one\nkey: two', 'key: [unfinished']) {
      await expect(parse(`---\n${yaml}\n---\nBody`)).rejects.toThrow()
    }
  })

  it.each(['', '\n', '\n\n', '\r\n\r\n'])(
    'preserves body separator %j in the ordinary fence path',
    async (gap) => {
      const text = `---\nkey: value\n---\n${gap}Body\n`
      expect((await parse(text)).content).toBe(`${gap}Body\n`)
      expect(getNoteBody(text)).toBe(`${gap}Body\n`)
      expect(getNoteRawFrontmatter(text)).toBe('key: value')
    }
  )

  it('pins extended package fences and nonmapping documents without claiming they are the same as regex extraction', async () => {
    for (const text of ['\ufeff---\na: 1\n---\n\nBody', '---\na: 1\n...\n\nBody']) {
      expect(await parse(text)).toEqual({ a: 1, content: 'Body' })
      expect(getNoteRawFrontmatter(text)).toBeNull()
      expect(getNoteBody(text)).toBe(text)
    }
    expect(await parse('---\n- one\n- two\n---\nBody')).toEqual({
      0: 'one',
      1: 'two',
      content: 'Body',
    })
    expect(await parse('---\n---\nBody')).toEqual({ content: 'Body' })
    expect(await parse('---\ncontent: property\n---\nBody')).toEqual({ content: 'Body' })
    expect(await parse('plain\n---\nkey: value\n---')).toEqual({
      content: 'plain\n---\nkey: value\n---',
    })
  })

  it('replaces body verbatim, preserving raw property comments but normalizing fence line endings', () => {
    expect(replaceNoteBody('---\r\nkey: value # comment\r\n---\r\nOld', '\nNew')).toBe(
      '---\nkey: value # comment\n---\n\nNew'
    )
    expect(replaceNoteBody('plain', 'New')).toBe('New')
    expect(replaceNoteBody('---\n\n---\nOld', 'New')).toBe('New')
  })
})

describe('frontmatter read and write surfaces', () => {
  it('cache access returns the cached object unchanged; getNoteData reads disk, not the open editor', async () => {
    const cached = { day: '2028-03-01', list: ['one'], position: { start: 0 } }
    const env = templateHarness([
      { path: 'Notes/sample.md', frontmatter: cached, raw: '---\nday: 2028-03-01\n---\nDisk' },
    ])
    env.workspace.getLeavesOfType.mockReturnValue([
      {
        view: {
          file: env.app.vault.getFileByPath('Notes/sample.md'),
          editor: { getValue: () => 'Unsaved' },
        },
      },
    ] as never)
    expect(getFrontmatterFromCache('Notes/sample.md')).toBe(cached)
    expect(getFrontmatterFromCache('missing.md')).toBeNull()
    expect(await getNoteData('Notes/sample.md')).toEqual({
      day: '2028-02-29T16:00:00',
      content: 'Disk',
    })
    expect(await getNoteData('missing.md')).toBeNull()
  })

  it('updates from unsaved text, shallow-merges keys, omits name from YAML and renames in the same folder', async () => {
    const env = templateHarness([{ path: 'Notes/sample.md', content: 'Disk' }])
    const file = env.app.vault.getFileByPath('Notes/sample.md')!
    env.workspace.getLeavesOfType.mockReturnValue([
      {
        view: {
          file,
          editor: {
            getValue: () => '---\nkeep: old\nnested:\n  lost: true\nname: old\n---\n\nBody',
          },
        },
      },
    ] as never)
    await updateNoteFrontmatter(
      file.path,
      { keep: 'new', nested: { fresh: true }, name: 'renamed' },
      true
    )
    expect(stringifyYaml).toHaveBeenLastCalledWith({
      keep: 'new',
      nested: { fresh: true },
      name: undefined,
      created: '2028-03-01',
    })
    expect(file.path).toBe('Notes/renamed.md')
    expect(await env.app.vault.read(file)).toContain('---\n\nBody')
    expect(await parse(await env.app.vault.read(file))).toMatchObject({
      keep: 'new',
      created: '2028-03-01',
    })
  })

  it('preserves a truthy created value, only generates one when requested, and errors for missing files', async () => {
    const env = templateHarness([
      { path: 'Notes/sample.md', raw: '---\ncreated: "2027-01-01"\n---\nBody' },
    ])
    await updateNoteFrontmatter('Notes/sample.md', { extra: 1 }, true)
    expect(vi.mocked(stringifyYaml).mock.lastCall?.[0]).toMatchObject({ created: '2027-01-01' })
    await updateNoteFrontmatter('Notes/sample.md', { created: null })
    expect(vi.mocked(stringifyYaml).mock.lastCall?.[0]).toMatchObject({ created: null })
    await expect(updateNoteFrontmatter('missing.md', {})).rejects.toThrow(
      'File not found: missing.md'
    )
    expect(env.app.stats.modify).toBe(2)
  })

  // BUG: updateNoteFrontmatter formats every parsed Date with DATE_FORMAT, unlike the
  // fixed parseNoteContent path. Editing an unrelated field deletes a timestamp's time.
  it('preserves an unquoted datetime when updating an unrelated property', async () => {
    const env = templateHarness([
      { path: 'Notes/sample.md', raw: '---\nstart: 2028-03-01T18:45:12Z\n---\nBody' },
    ])
    await updateNoteFrontmatter('Notes/sample.md', { extra: true })
    expect(
      (await parse(await env.app.vault.read(env.app.vault.getFileByPath('Notes/sample.md')!))).start
    ).toBe('2028-03-01T10:45:12')
  })

  // BUG: this writer uses front-matter.body directly and inserts one blank line; changing
  // a property destroys additional leading body blank lines despite the parser's spacing fix.
  it('preserves body spacing when updating frontmatter', async () => {
    const env = templateHarness([
      { path: 'Notes/sample.md', raw: '---\nkey: old\n---\n\n\n\nBody' },
    ])
    await updateNoteFrontmatter('Notes/sample.md', { key: 'new' })
    expect(
      getNoteBody(await env.app.vault.read(env.app.vault.getFileByPath('Notes/sample.md')!))
    ).toBe('\n\n\nBody')
  })
})

describe('core note settings loaded from saved data', () => {
  const supplied = {
    refreshDelay: 0,
    busyDayThreshold: 0,
    tasksFolder: '',
    accountsFolder: '',
    financeCategoriesFolder: '',
    transactionPathTemplate: '',
    defaultCurrency: '',
  }

  // BUG: truthy fallbacks silently replace explicit zero and empty-string settings.
  it('keeps explicitly configured zero thresholds and empty text values', () => {
    const config = AbeleConfig.getInstance()
    config.applySettings(supplied)
    expect(config).toMatchObject(supplied)
  })

  it.each([undefined, null])(
    'defaults missing settings %s without defaulting falsy values',
    (value) => {
      const config = AbeleConfig.getInstance()
      config.applySettings(
        Object.fromEntries(
          Object.keys(supplied).map((key) => [key, value])
        ) as unknown as AbeleSettings
      )
      expect(config).toMatchObject(
        Object.fromEntries(Object.keys(supplied).map((key) => [key, DEFAULT_SETTINGS[key]]))
      )
    }
  )
})

describe('notes created in a group', () => {
  // BUG: the generic frontmatter updater treats name as a rename instruction and removes it.
  it('retains default-template properties while adding group membership', async () => {
    const env = templateHarness([{ path: 'Notes/Sample group.md' }])
    await env.template(
      '---\nname: Sample display name\ncustom:\n  keep: true\nstart: 2028-03-01T18:45:12Z\n---\n\nBody\n',
      { template_for: 'default' }
    )
    await createNoteInGroup(env.app.vault.getFileByPath('Notes/Sample group.md')!)
    const file = env.app.vault.getFileByPath('Notes/Untitled.md')!
    expect(await parse(await env.app.vault.read(file))).toMatchObject({
      name: 'Sample display name',
      custom: { keep: true },
      start: '2028-03-01T10:45:12',
      groups: ['[[Sample group]]'],
      content: '\nBody\n',
    })
    expect(env.workspace.openLinkText).toHaveBeenLastCalledWith(file.path, '', false)
  })
})

describe('legacy template helper', () => {
  it('renders named/date fields but not the user-template expression language', () => {
    expect(
      renderTemplate('{{ name }} {{date:YYYY/MM}} {{missing}} {{date.offset(1)}}', {
        name: '$&',
        date: '2028-03-01',
      })
    ).toBe('$& 2028/03  ')
  })

  it('creates missing parent folders, renders a template, and opens existing notes without overwriting', async () => {
    const env = templateHarness([{ path: 'Templates/legacy.md', content: 'Day {{date}}' }])
    const folders = vi.spyOn(env.app.vault, 'createFolder')
    const file = await createNoteFromTemplate(
      { date: '2028-03-01' },
      'New/Nested/{{date}}',
      'Templates/legacy.md'
    )
    expect(file?.path).toBe('New/Nested/2028-03-01.md')
    expect(folders).toHaveBeenCalledWith('New/Nested')
    expect(await env.app.vault.read(file!)).toBe('Day 2028-03-01')
    expect(await createNoteFromTemplate({}, file!.path)).toBeNull()
    expect(await env.app.vault.read(file!)).toBe('Day 2028-03-01')
    expect(env.workspace.openLinkText).toHaveBeenLastCalledWith(file!.path, '', false)
  })

  it('uses Untitled for an empty rendered name and an empty body for a missing template', async () => {
    const env = templateHarness()
    const file = await createNoteFromTemplate({}, '{{missing}}', 'missing.md')
    expect(file?.path).toBe('Untitled.md')
    expect(await env.app.vault.read(file!)).toBe('')
  })
})
