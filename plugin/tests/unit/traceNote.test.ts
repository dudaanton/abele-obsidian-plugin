import { describe, expect, it } from 'vitest'
import { buildRunNote, traceLink } from '@/debugger/trace/note'
import { WireRunSchema } from '@/debugger/trace/wire'

const link = (t: { step?: string; name?: string; path?: string }) =>
  traceLink({ registrationId: 'node-a', projectId: 'project-a', runId: 'run-a', ...t })

function sampleRun(steps: number, marks: number) {
  return WireRunSchema.parse({
    run: {
      id: 'run-a',
      name: 'Sample | run',
      debug_session_id: 'debug-a',
      started_at: '2026-01-02T03:04:05.000Z',
      length_ms: 4000,
      state: 'done',
      steps,
      bytes: 1,
    },
    points: [
      {
        breakpoint_id: 'bp-1',
        file: 'src/sample.ts',
        line: 4,
        take: ['sample'],
        note: 'Sample read',
        hits: steps,
      },
      { breakpoint_id: 'bp-2', file: 'src/other.ts', line: 9, take: [], hits: 0, when: 'flag' },
    ],
    steps: Array.from({ length: steps }, (_, i) => ({
      id: `t${String(i + 1).padStart(4, '0')}`,
      kind: 'probe',
      ts: 'x',
      at: i * 100,
      label: 'Sample read',
      place: { file: 'src/sample.ts', line: 4, fn: 'readSample' },
      paused_ms: 12,
      values: [
        {
          name: 'sample',
          format: 'json',
          bytes: 2048,
          brief: '{ items: 2 }',
          ...(i % 3 === 2 ? { same: true } : {}),
        },
        ...(i === 0
          ? [{ name: 'gone', format: 'text', bytes: 0, brief: '', failed: 'gone is not defined' }]
          : []),
      ],
    })),
    marks: Array.from({ length: marks }, (_, i) => ({
      step: 't0001',
      name: 'sample',
      path: `$.items[${i}]`,
      comment: `look at item ${i}`,
      ...(i % 4 === 0 ? { tags: ['question'] } : {}),
    })),
    folder: '/runs',
  })
}

const values = (steps: number) =>
  new Map(
    Array.from({ length: steps }, (_, i) => [
      `t${String(i + 1).padStart(4, '0')}/sample`,
      {
        shape: {
          type: 'object',
          children: [
            {
              key: 'items',
              type: 'array',
              count: 2,
              children: [{ key: '[*]', type: 'number', example: '1' }],
            },
          ],
        },
        head: ['{', '  "items": [', '    1,', '    2', '  ]', '}'],
      },
    ])
  )

describe('a note about a run', () => {
  it('stays short for a run of twelve steps with eight marks, and says it the same way twice', () => {
    const input = { run: sampleRun(12, 8), values: values(12), link }
    const note = buildRunNote(input)
    expect(note.split('\n').length).toBeLessThan(400)
    expect(buildRunNote(input)).toBe(note)
  })

  it('links every value to the whole of it on the node and reads without the node', () => {
    const note = buildRunNote({ run: sampleRun(3, 1), values: values(3), link })
    expect(note).toContain(
      '[open](obsidian://abele-trace?node=node-a&project=project-a&run=run-a&step=t0001&name=sample)'
    )
    expect(note).toContain('>   items: array · 2')
    expect(note).toContain('>     1,')
    expect(note).toContain('> [!failure] gone: not taken')
    expect(note).toContain('> [!note] sample: the same as the last time')
    expect(note).toContain('| `src/other.ts:9` | nothing | `flag` |  | 0 |')
    expect(note).toContain('Recorded run [Sample \\| run]')
    expect(note).toContain('## Questions')
    expect(note).toContain('## What happens in this flow')
  })

  it('describes only the first steps of a long run and lists the rest in the timeline', () => {
    const note = buildRunNote({ run: sampleRun(80, 0), values: values(80), link })
    expect(note).toContain('### t0050 ·')
    expect(note).not.toContain('### t0051 ·')
    expect(note).toContain('| [t0080](')
    expect(note).toContain('The other 30 steps')
  })

  it('shows recorded text as written, never as markup of the note', () => {
    const run = sampleRun(1, 1)
    run.steps[0]!.values[0]!.brief = '![[secret note]] #tag [[link]]'
    run.steps[0]!.label = '<script>x</script> **bold**'
    run.marks[0]!.tags = ['question', 'bad tag]']
    const note = buildRunNote({
      run,
      values: new Map([
        ['t0001/sample', { head: ['````', 'inside\u2028> [!danger] escaped', 'a\rb'] }],
      ]),
      link,
    })
    expect(note).not.toContain('![[')
    expect(note).toContain('\\!\\[\\[secret note\\]\\] \\#tag')
    expect(note).toContain('&lt;script&gt;')
    expect(note).toContain('> `````json')
    expect(note).not.toContain('#bad')
    // Every line of a block stays inside its quote, whatever ended it.
    expect(note).toContain('> > [!danger] escaped')
    expect(note).toContain('> b')
  })
})

it('uses local time for the start time shown beside the run name', () => {
  const run = sampleRun(0, 0)
  expect(buildRunNote({ run, values: new Map(), link }).split('\n')[0]).toContain(
    `started ${new Date(run.run.started_at).toLocaleString()}`
  )
  expect(buildRunNote({ run, values: new Map(), link }).split('\n')[0]).not.toContain(' UTC')
})
