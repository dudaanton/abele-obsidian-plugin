import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { load } from 'js-yaml'
import { UserTemplate } from '@/templates/UserTemplate'
import { TemplateService } from '@/templates/TemplateService'
import { getNoteRawFrontmatter } from '@/helpers/notesUtils'
import { templateHarness } from '../helpers/templateHarness'

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('TZ', 'America/Los_Angeles')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2028-03-01T00:30:00-08:00'))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
const service = () => TemplateService.getInstance()
const propertiesOf = (content: string) => load(getNoteRawFrontmatter(content)!)

describe('UserTemplate', () => {
  it('validates discovery from cached metadata, not the body', async () => {
    const { app } = templateHarness([
      { path: 'plain.md', content: '---\ntype: template\ntemplate_for: sample\n---' },
      { path: 'wrong.md', frontmatter: { type: 'task', template_for: 'sample' } },
      { path: 'empty.md', frontmatter: { type: 'template', template_for: '' } },
      { path: 'valid.md', frontmatter: { type: 'template', template_for: 'sample' } },
    ])
    expect(
      ['plain.md', 'wrong.md', 'empty.md'].map((p) =>
        UserTemplate.fromFile(app.vault.getFileByPath(p)!)
      )
    ).toEqual([null, null, null])
    expect(UserTemplate.fromFile(app.vault.getFileByPath('valid.md')!)?.name).toBe('valid')
  })

  it('extracts ordered target values, quoted arrays, callbacks and display directories', async () => {
    const env = templateHarness()
    const template = await env.template('body', {
      template_dir: '/Samples//Nested/',
      order: 0,
      callbacks: ' command:sample:first ;ignored; command:sample:second;command:',
      template_for_: 'ignored',
      template_for_absent: undefined,
      template_for_count: 0,
      template_for_tags: ['one', 'two "quoted"'],
      template_for_empty: [],
    })
    expect(template.displayPath).toBe('/Samples//Nested//sample')
    expect(template.dirSegments).toEqual(['Samples', 'Nested'])
    expect(template.order).toBe(0)
    expect(template.callbacks).toEqual(['sample:first', 'sample:second', ''])
    expect(template.targetProperties).toEqual([
      { name: 'count', value: '0' },
      { name: 'tags', value: '\n  - "one"\n  - "two \\"quoted\\""' },
      { name: 'empty', value: '' },
    ])
    expect(await template.getContent()).toBe('body')
    expect(await template.getBody()).toBe('body')
  })

  it('strips metadata and its continuation lines but keeps ordinary nested YAML and body spacing', async () => {
    const env = templateHarness()
    const text =
      '---\ntype: template\ntemplate_for: sample\ntemplate_dir: folder\norder: 2\ncallbacks: command:sample\ntarget_name: name\ntarget_folder: folder\ntemplate_for_labels:\n  - one\n  - two\nkeep:\n  nested: true\n# retained comment\n---\n\nBody\n'
    const template = await env.template(text)
    expect(await template.getBody()).toBe(
      '---\ntype: sample\nkeep:\n  nested: true\n# retained comment\n---\n\nBody\n'
    )
  })

  it('omits type for a default, removes an empty fence, and leaves unfenced content intact', async () => {
    const env = templateHarness()
    const template = await env.template('---\ntype: template\ntemplate_for: default\n---\n\nBody', {
      template_for: 'default',
    })
    expect(template.isDefault).toBe(true)
    expect(template.displayPath).toBe('sample')
    expect(template.dirSegments).toEqual([])
    expect(template.callbacks).toEqual([])
    expect(await template.getBody()).toBe('Body')
    await env.app.vault.modify(template.file, 'plain {{name}}')
    expect(await template.getBody()).toBe('plain {{name}}')
  })
})

describe('TemplateService discovery and hierarchy', () => {
  it('sorts ordered templates first, ties stably, then names; filters defaults and type', async () => {
    const env = templateHarness()
    for (const [name, properties] of [
      ['zeta', {}],
      ['beta', { order: 2 }],
      ['alpha', {}],
      ['first', { order: -1, template_for: 'default' }],
      ['tie', { order: 2 }],
    ] as const)
      await env.template('', properties, `Templates/${name}.md`)
    expect(service()).toBe(service())
    expect(
      service()
        .discoverTemplates()
        .map((t) => t.name)
    ).toEqual(['first', 'beta', 'tie', 'alpha', 'zeta'])
    expect(service().getDefaultTemplate()?.name).toBe('first')
    expect(
      service()
        .getNonDefaultTemplates()
        .map((t) => t.name)
    ).toEqual(['beta', 'tie', 'alpha', 'zeta'])
    expect(service().getTemplatesByType('sample')).toHaveLength(4)
    expect(service().getTemplatesByType('absent')).toEqual([])
  })

  it('rediscovers templates after metadata edits, moves, renames and deletion', async () => {
    const env = templateHarness()
    const template = await env.template('Body')
    expect(service().getTemplatesByType('sample')).toHaveLength(1)
    await env.app.fileManager.renameFile(template.file, 'Moved/renamed.md')
    expect(
      service()
        .discoverTemplates()
        .map((t) => [t.name, t.file.path])
    ).toEqual([['renamed', 'Moved/renamed.md']])
    env.app.setFrontmatter(template.file.path, { type: 'template', template_for: 'default' })
    expect(service().getNonDefaultTemplates()).toEqual([])
    expect(service().getDefaultTemplate()?.file).toBe(template.file)
    await env.app.vault.delete(template.file)
    expect(service().discoverTemplates()).toEqual([])
    expect(service().getDefaultTemplate()).toBeNull()
  })

  it('reuses directory nodes in encounter order, leaves root templates at root', async () => {
    const env = templateHarness()
    const root = await env.template('', {}, 'root.md')
    const nested = await env.template('', { template_dir: '/A//B/' }, 'nested.md')
    const sibling = await env.template('', { template_dir: 'A/C' }, 'sibling.md')
    const again = await env.template('', { template_dir: 'A/B' }, 'again.md')
    expect(service().buildTemplateHierarchy([root, nested, sibling, again])).toEqual({
      name: '',
      path: '',
      templates: [root],
      children: [
        {
          name: 'A',
          path: 'A',
          templates: [],
          children: [
            { name: 'B', path: 'A/B', templates: [nested, again], children: [] },
            { name: 'C', path: 'A/C', templates: [sibling], children: [] },
          ],
        },
      ],
    })
  })
})

describe('applying a template', () => {
  it('resolves body, target-only properties and paths; creates parents and avoids collisions', async () => {
    const env = templateHarness([{ path: 'Output/2028/sample.md', content: 'keep' }])
    const template = await env.template(
      '---\ntype: template\ntemplate_for: sample\nkeep: true\n---\nHello {{person}}',
      {
        target_folder: 'Output/{{date.format("YYYY")}}',
        target_name: '{{title}}',
        template_for_labels: ['alpha', 'beta'],
        template_for_link: '{{link::wikilink}}',
        template_for_description: '{{description}}',
        template_for_links: '"{{links::wiki_list}}"',
      }
    )
    const file = await service().createNoteFromTemplate(
      template,
      new Map(
        Object.entries({
          person: 'reader',
          title: 'sample',
          link: 'Notes/Sample.md',
          description: 'has: colon',
          links: '["Notes/Other.md"]',
        })
      )
    )
    expect(file.path).toBe('Output/2028/sample (1).md')
    expect(await env.app.vault.read(env.app.vault.getFileByPath('Output/2028/sample.md')!)).toBe(
      'keep'
    )
    const text = await env.app.vault.read(file)
    expect(propertiesOf(text)).toEqual({
      type: 'sample',
      keep: true,
      labels: ['alpha', 'beta'],
      link: '[[Notes/Sample|Sample]]',
      description: 'has: colon',
      links: ['[[Notes/Other|Other]]'],
    })
    expect(text).toContain('Hello reader')
  })

  it.each(['root', 'current', 'folder'])(
    'honors the host new-file location %s',
    async (location) => {
      const env = templateHarness([{ path: 'Notes/sample.md' }])
      Object.assign(env.app.vault, {
        getConfig: (key: string) => (key === 'newFileLocation' ? location : 'Chosen/Nested'),
      })
      const template = await env.template('body')
      const file = await service().createNoteFromTemplate(template, new Map())
      expect(file.path).toBe(
        { root: '', current: 'Notes/', folder: 'Chosen/Nested/' }[location] + 'Untitled.md'
      )
    }
  )

  it('falls back to root without an active file or host config and creates target frontmatter', async () => {
    const env = templateHarness()
    Object.assign(env.app.vault, { getConfig: () => 'current' })
    const template = await env.template('body', {
      template_for_note: ' padded "text" ',
      template_for_items: '[one, two]',
    })
    const file = await service().createNoteFromTemplate(template, new Map())
    expect(file.path).toBe('Untitled.md')
    expect(propertiesOf(await env.app.vault.read(file))).toEqual({
      note: ' padded "text" ',
      items: ['one', 'two'],
    })
  })

  it('replaces without moving the target and runs callbacks sequentially, continuing after failure', async () => {
    const env = templateHarness([{ path: 'Notes/sample.md', content: 'old body' }])
    const template = await env.template('{{text}}', {
      target_name: 'ignored',
      template_for_keep: 'true',
      callbacks: 'command:first;command:broken;command:last',
    })
    const seen: string[] = []
    env.commands.executeCommandById.mockImplementation(async (id) => {
      seen.push(id)
      expect(await env.app.vault.read(env.app.vault.getFileByPath('Notes/sample.md')!)).toContain(
        'new body'
      )
      if (id === 'broken') throw new Error('sample failure')
      return true
    })
    await service().replaceNoteWithTemplate(
      template,
      env.app.vault.getFileByPath('Notes/sample.md')!,
      new Map([['text', 'new body']])
    )
    expect(seen).toEqual(['first', 'broken', 'last'])
    expect(env.app.vault.getFileByPath('ignored.md')).toBeNull()
    expect(
      propertiesOf(await env.app.vault.read(env.app.vault.getFileByPath('Notes/sample.md')!))
    ).toEqual({ keep: true })
  })

  it('insert returns body only, runs callbacks, and does not apply target properties or create a note', async () => {
    const env = templateHarness()
    const template = await env.template('Hello {{name}}', {
      template_for_extra: 'value',
      callbacks: 'command:sample',
    })
    env.app.resetStats()
    expect(await service().insertTemplateAtCursor(template, new Map([['name', 'reader']]))).toBe(
      'Hello reader'
    )
    expect(env.app.stats.create).toBe(0)
    expect(env.app.stats.modify).toBe(0)
    expect(env.commands.executeCommandById).toHaveBeenCalledWith('sample')
  })

  it('applies a default date to an empty file; refuses a missing default or a body needing input', async () => {
    const env = templateHarness([{ path: 'empty.md' }])
    const file = env.app.vault.getFileByPath('empty.md')!
    expect(await service().applyDefaultTemplate(file)).toBe(false)
    const template = await env.template('{{name::default(sample)}}', {
      template_for: 'default',
      template_for_created: '{{date}}',
    })
    expect(await service().applyDefaultTemplate(file)).toBe(false)
    expect(await env.app.vault.read(file)).toBe('')
    await env.app.vault.modify(
      template.file,
      '---\ntype: template\ntemplate_for: default\n---\nBody'
    )
    expect(await service().applyDefaultTemplate(file)).toBe(true)
    expect(propertiesOf(await env.app.vault.read(file))).toEqual({
      created: new Date('2028-03-01T00:00:00Z'),
    })
  })

  it('guards automatic application without changing explicit default replacement', async () => {
    const env = templateHarness([{ path: 'sample.md', content: 'Existing' }])
    const file = env.app.vault.getFileByPath('sample.md')!
    await env.template('Default body', {
      template_for: 'default',
      callbacks: 'command:sample',
    })
    expect(await service().applyDefaultTemplate(file, true)).toBe(false)
    expect(await env.app.vault.read(file)).toBe('Existing')
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
    expect(await service().applyDefaultTemplate(file)).toBe(true)
    expect(await env.app.vault.read(file)).toBe('Default body')
    expect(env.commands.executeCommandById).toHaveBeenCalledOnce()
  })

  // BUG: only body variables are checked; a default with required input solely in a
  // template_for_* property is silently applied with that input erased.
  it('refuses a default whose target property still needs user input', async () => {
    const env = templateHarness([{ path: 'empty.md' }])
    await env.template('Body', { template_for: 'default', template_for_topic: '{{Topic}}' })
    expect(await service().applyDefaultTemplate(env.app.vault.getFileByPath('empty.md')!)).toBe(
      false
    )
  })

  it.each(['create', 'replace', 'default'])(
    'merges overlapping target properties for %s, preserving other values and body spacing',
    async (mode) => {
      const env = templateHarness([{ path: 'empty.md' }])
      const template = await env.template(
        '---\n"labels":\n  - old\nsummary: |\n  old text\nkeep:\n  nested: true\ncreated: 2028-03-01\n---\n\n\nBody\n',
        {
          template_for: 'default',
          template_for_labels: ['new'],
          template_for_summary: 'has: colon',
          template_for_extra: 'false',
        }
      )
      let file = env.app.vault.getFileByPath('empty.md')!
      if (mode === 'create') file = await service().createNoteFromTemplate(template, new Map())
      else if (mode === 'replace')
        await service().replaceNoteWithTemplate(template, file, new Map())
      else expect(await service().applyDefaultTemplate(file)).toBe(true)
      const text = await env.app.vault.read(file)
      expect(propertiesOf(text)).toEqual({
        labels: ['new'],
        summary: 'has: colon',
        keep: { nested: true },
        created: new Date('2028-03-01T00:00:00Z'),
        extra: false,
      })
      expect(text.endsWith('---\n\n\nBody\n')).toBe(true)
    }
  )

  // BUG: target properties are appended, not merged. Repeating a body key creates duplicate
  // YAML mapping keys and the resulting note cannot be read by front-matter/js-yaml.
  it('overrides a body property with a target property without producing invalid YAML', async () => {
    const env = templateHarness()
    const template = await env.template('---\nlabels: old\n---\nBody', {
      template_for_labels: ['new'],
    })
    const file = await service().createNoteFromTemplate(template, new Map())
    expect(propertiesOf(await env.app.vault.read(file))).toEqual({ labels: ['new'] })
  })
})
