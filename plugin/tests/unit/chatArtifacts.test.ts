import { describe, expect, it } from 'vitest'
import { chatArtifacts, toolImage } from '@/ai/chatArtifacts'

const resolve = (path: string) => path.replace(/^\.\//, '')
const project = (touched: unknown[], messages: unknown[]) =>
  chatArtifacts({
    touched,
    messages,
    resolvePath: resolve,
    isScript: (path) => path.startsWith('Scripts/') && path.endsWith('.js'),
  })
const call = (toolName: string, toolResult: string, extra = {}) => ({
  id: 'call',
  role: 'tool-call',
  toolName,
  toolResult,
  toolStatus: 'approved',
  timestamp: 10,
  ...extra,
})

describe('chat artifacts', () => {
  it('partitions authoritative links, deduplicates resolved paths and never backfills detached files', () => {
    const result = project(
      [
        { path: 'Notes/sample.md', at: '2025-01-01' },
        { path: './Notes/sample.md', at: '2025-01-02' },
        { path: 'Scripts/sample.js' },
      ],
      [
        call('edit', 'Changed', {
          toolParams: { path: 'Notes/detached.md' },
          toolDiff: { old: 'a', new: 'b' },
        }),
      ]
    )
    expect(result.notes.map((a) => a.path)).toEqual(['Notes/sample.md'])
    expect(result.notes[0].at).toBe('2025-01-02')
    expect(result.notes[0].sources).toEqual([])
    expect(result.scripts.map((a) => a.path)).toEqual(['Scripts/sample.js'])
  })
  it('retains image origins and sources across all branches, excluding drafts', () => {
    const result = project(
      [],
      [
        {
          id: 'upload',
          role: 'user',
          timestamp: 1,
          attachments: ['Pictures/sample.png', 'paper.pdf'],
        },
        call('generate_image', 'Image saved: ./Pictures/sample.png', {
          id: 'generated',
          parentId: 'hidden-branch',
          toolImagePath: './Pictures/sample.png',
        }),
        call('edit_image', 'Edited image saved: Pictures/edited.png', {
          toolImagePath: 'Pictures/edited.png',
        }),
        { id: 'draft', draft: true, attachments: ['Pictures/unsent.png'] },
      ]
    )
    expect(result.images.map((a) => a.path)).toEqual(['Pictures/sample.png', 'Pictures/edited.png'])
    expect(result.images[0].sources).toEqual([
      { messageId: 'upload', origin: 'Uploaded', timestamp: 1 },
      { messageId: 'generated', origin: 'Generated', timestamp: 10 },
    ])
  })
  it('keeps only proven note and script provenance, without calling attachment creation', () => {
    const result = project(
      [{ path: 'Scripts/sample.js' }, { path: 'Notes/sample.md' }],
      [
        call(
          'create_script',
          'Script created: Scripts/sample.js. It will be available as a command after auto-discovery.'
        ),
        call('edit', 'Edited', {
          id: 'change',
          toolParams: { path: 'Scripts/sample.js' },
          toolDiff: { old: 'a', new: 'b' },
        }),
        call('read', 'Read', { toolParams: { path: 'Notes/sample.md' } }),
      ]
    )
    expect(result.scripts[0].sources.map((s) => s.origin)).toEqual(['Created', 'Changed'])
    expect(result.notes[0].sources).toEqual([])
  })
  it('uses template creation evidence and ignores malformed change evidence', () => {
    const result = project(
      [{ path: 'Notes/sample.md' }],
      [
        call('apply_template', 'Created: Notes/sample.md'),
        call('edit', 'Edited', {
          id: 'bad-diff',
          toolParams: { path: 'Notes/sample.md' },
          toolDiff: {},
        }),
        call('edit', 'Edited', {
          id: 'no-change',
          toolParams: { path: 'Notes/sample.md' },
          toolDiff: { old: 'same', new: 'same' },
        }),
      ]
    )
    expect(result.notes[0].sources.map((source) => source.origin)).toEqual(['Created'])
  })
  it('tolerates missing and malformed historical fields', () => {
    expect(
      project(
        [null, {}, { path: 3 }],
        [null, {}, { attachments: [null, 42] }, call('read_image', '', { toolParams: { path: 4 } })]
      )
    ).toEqual({ notes: [], images: [], scripts: [] })
  })
})

describe('persisted tool image evidence', () => {
  it.each([
    ['generate_image', 'Words\n\nImage saved: Pictures/new.png', 'Generated'],
    ['edit_image', 'Edited image saved: Pictures/new.png', 'Edited'],
    ['screenshot', 'Screenshot saved: Pictures/new.png', 'Screenshot'],
    ['download_image', 'Saved: Pictures/new.png', 'Downloaded'],
    ['read_image', 'Read', 'Viewed'],
    ['look_at_drawing', 'Read', 'Drawing'],
  ])('reads exact evidence for %s', (name, result, origin) => {
    expect(
      toolImage(
        call(name, result, {
          toolParams: { path: 'Pictures/new.png' },
          toolImagePath: 'Pictures/new.png',
        })
      )
    ).toEqual({
      path: 'Pictures/new.png',
      origin,
    })
  })
  it('uses the final saved-path line rather than an earlier model caption', () => {
    expect(
      toolImage(
        call(
          'generate_image',
          'Image saved: Pictures/caption.png\n\nImage saved: Pictures/new.png',
          { toolImagePath: 'Pictures/new.png' }
        )
      )
    ).toEqual({ path: 'Pictures/new.png', origin: 'Generated' })
  })
  it.each([
    call('generate_image', 'Image saved: Pictures/new.png', {
      toolStatus: 'pending',
      toolImagePath: 'Pictures/new.png',
    }),
    call('generate_image', 'Image saved: Pictures/new.png', {
      toolStatus: 'rejected',
      toolImagePath: 'Pictures/new.png',
    }),
    call('generate_image', 'Image saved: Pictures/new.png', {
      toolStatus: undefined,
      toolImagePath: 'Pictures/new.png',
    }),
    call('generate_image', 'No image generated'),
    call('generate_image', 'Example Image saved: Pictures/new.png', {
      toolImagePath: 'Pictures/new.png',
    }),
    call('generate_image', 'Edited image saved: Pictures/new.png', {
      toolImagePath: 'Pictures/new.png',
    }),
    call('generate_image', 'Image saved: Pictures/new.png'),
    call('edit_image', 'Edited image saved: Pictures/new.png'),
    call('generate_image', 'Image saved: Pictures/new.png', {
      toolImagePath: 'Pictures/other.png',
    }),
    call('edit', 'Saved: Pictures/new.png'),
    call('download_image', 'Saved: paper.pdf'),
  ])('rejects incomplete or unrelated evidence %#', (message) =>
    expect(toolImage(message)).toBeUndefined()
  )
})
