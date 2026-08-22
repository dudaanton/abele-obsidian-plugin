/**
 * Behavioural contract for journal log filtering through the group tree.
 *
 * A journal note is shown against a target note when its paragraphs mention that note — or
 * mention anything that belongs to it through the `groups` chain, at any depth. This is the
 * mechanism behind "the logs I wrote about a subtask show up on the project note", and it
 * shares its link-resolution primitives with group scope resolution, so it has to be pinned
 * before those primitives are touched.
 *
 * Only `loadContent()` is exercised. `load()` additionally installs file watchers, which
 * these tests neither need nor want.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Log } from '@/entities/Log'
import { GlobalStore } from '@/stores/GlobalStore'
import { buildFakeVault, type FakeFileSpec } from '../helpers/fakeVault'

function useVault(specs: FakeFileSpec[]): void {
  const app = buildFakeVault(specs)
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
}

const JOURNAL = 'Journals/2026/2026-08-22.md'

// Group tree, arrows pointing from a member to the group it belongs to:
//   Notes/Projects.md              (root)
//     Notes/Website.md      -> [[Projects]]
//       Notes/Login Page.md -> [[Website]]     (depth 2 below the root)
//   Notes/Kitchen.md               (separate root, must never leak in)
const GROUPED_NOTES: FakeFileSpec[] = [
  { path: 'Notes/Projects.md', content: 'Projects\n' },
  { path: 'Notes/Website.md', frontmatter: { groups: ['[[Projects]]'] }, content: 'Website\n' },
  {
    path: 'Notes/Login Page.md',
    frontmatter: { groups: ['[[Website]]'] },
    content: 'Login Page\n',
  },
  { path: 'Notes/Kitchen.md', content: 'Kitchen\n' },
]

function journal(body: string): FakeFileSpec {
  return { path: JOURNAL, frontmatter: { type: 'journal' }, content: body }
}

async function contentFor(target: string): Promise<string> {
  const log = new Log(JOURNAL, target)
  await log.loadContent()
  return log.content
}

describe('Log — journal paragraphs selected through the group tree', () => {
  beforeEach(() => {
    useVault([
      ...GROUPED_NOTES,
      journal(
        [
          'Met with the team about [[Projects]] today.',
          'Fixed the header on [[Website]].',
          'Rewrote validation on [[Login Page]].',
          'Bought a new kettle for the [[Kitchen]].',
        ].join('\n\n')
      ),
    ])
  })

  it('keeps a paragraph naming the target note itself', async () => {
    const content = await contentFor('Notes/Projects.md')
    expect(content).toContain('Met with the team about [[Projects]]')
  })

  it('keeps a paragraph naming a direct member of the target group', async () => {
    const content = await contentFor('Notes/Projects.md')
    expect(content).toContain('Fixed the header on [[Website]]')
  })

  it('keeps a paragraph naming a member of a subgroup, two levels down', async () => {
    const content = await contentFor('Notes/Projects.md')
    expect(content).toContain('Rewrote validation on [[Login Page]]')
  })

  it('drops a paragraph naming a note from an unrelated group', async () => {
    const content = await contentFor('Notes/Projects.md')
    expect(content).not.toContain('Kitchen')
  })

  it('narrows to the subtree when the target is a subgroup', async () => {
    const content = await contentFor('Notes/Website.md')
    expect(content).toContain('Fixed the header on [[Website]]')
    expect(content).toContain('Rewrote validation on [[Login Page]]')
    // Projects sits above Website, so it is not a member of it.
    expect(content).not.toContain('Met with the team')
  })

  it('keeps only the leaf paragraph when the target is a leaf note', async () => {
    const content = await contentFor('Notes/Login Page.md')
    expect(content).toContain('Rewrote validation on [[Login Page]]')
    expect(content).not.toContain('Fixed the header')
    expect(content).not.toContain('Met with the team')
  })
})

describe('Log — edge cases in group traversal', () => {
  it('falls back to the whole journal when nothing matches', async () => {
    // Deliberate: an unfiltered journal is more useful to the reader than an empty panel.
    useVault([
      ...GROUPED_NOTES,
      journal('Bought a new kettle for the [[Kitchen]].\n\nWent for a walk.'),
    ])

    const content = await contentFor('Notes/Projects.md')
    expect(content).toContain('Kitchen')
    expect(content).toContain('Went for a walk')
  })

  it('returns the whole journal when no target note is given', async () => {
    useVault([...GROUPED_NOTES, journal('One [[Projects]].\n\nTwo [[Kitchen]].')])

    const log = new Log(JOURNAL)
    await log.loadContent()

    expect(log.content).toContain('One [[Projects]]')
    expect(log.content).toContain('Two [[Kitchen]]')
  })

  it('terminates on a cycle in the group chain', async () => {
    useVault([
      { path: 'Notes/A.md', frontmatter: { groups: ['[[B]]'] }, content: 'A\n' },
      { path: 'Notes/B.md', frontmatter: { groups: ['[[A]]'] }, content: 'B\n' },
      { path: 'Notes/Other.md', content: 'Other\n' },
      journal('Touched [[A]].\n\nTouched [[Other]].'),
    ])

    const content = await contentFor('Notes/B.md')
    expect(content).toContain('Touched [[A]]')
    expect(content).not.toContain('Other')
  })

  it('ignores a groups value that is not an array', async () => {
    useVault([
      { path: 'Notes/Projects.md', content: 'Projects\n' },
      { path: 'Notes/Bad.md', frontmatter: { groups: '[[Projects]]' }, content: 'Bad\n' },
      { path: 'Notes/Kitchen.md', content: 'Kitchen\n' },
      journal('Worked on [[Bad]].\n\nCleaned the [[Kitchen]].'),
    ])

    // Neither paragraph belongs to Projects, so the no-match fallback returns everything.
    const content = await contentFor('Notes/Projects.md')
    expect(content).toContain('Worked on [[Bad]]')
    expect(content).toContain('Cleaned the [[Kitchen]]')
  })

  it('ignores a group entry that resolves to nothing', async () => {
    useVault([
      { path: 'Notes/Projects.md', content: 'Projects\n' },
      {
        path: 'Notes/Dangling.md',
        frontmatter: { groups: ['[[Nonexistent]]'] },
        content: 'Dangling\n',
      },
      { path: 'Notes/Website.md', frontmatter: { groups: ['[[Projects]]'] }, content: 'Website\n' },
      journal('Touched [[Dangling]].\n\nTouched [[Website]].'),
    ])

    const content = await contentFor('Notes/Projects.md')
    expect(content).toContain('Touched [[Website]]')
    expect(content).not.toContain('Dangling')
  })

  it('follows every branch when a note belongs to several groups', async () => {
    useVault([
      { path: 'Notes/Projects.md', content: 'Projects\n' },
      { path: 'Notes/Home.md', content: 'Home\n' },
      {
        path: 'Notes/Shared.md',
        frontmatter: { groups: ['[[Projects]]', '[[Home]]'] },
        content: 'Shared\n',
      },
      journal('Worked on [[Shared]].\n\nSomething else entirely.'),
    ])

    expect(await contentFor('Notes/Projects.md')).toContain('Worked on [[Shared]]')
    expect(await contentFor('Notes/Home.md')).toContain('Worked on [[Shared]]')
  })

  it('reports a missing journal note instead of throwing', async () => {
    useVault(GROUPED_NOTES)

    const log = new Log('Journals/2026/2026-01-01.md', 'Notes/Projects.md')
    await log.loadContent()

    expect(log.noteNotFound).toBe(true)
  })
})

describe('Log — metadata', () => {
  it('derives its display name from the file path', () => {
    useVault(GROUPED_NOTES)
    expect(new Log(JOURNAL).name).toBe('2026-08-22')
  })

  it('builds a wikilink with the path and name', () => {
    useVault(GROUPED_NOTES)
    expect(new Log(JOURNAL).wikilink).toBe(`[[${JOURNAL}|2026-08-22]]`)
  })

  it('normalises a path given without an extension', () => {
    useVault(GROUPED_NOTES)
    expect(new Log('Journals/2026/2026-08-22').filePath).toBe(JOURNAL)
  })
})
