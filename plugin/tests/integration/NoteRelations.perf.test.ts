/**
 * Complexity contract for relation gathering.
 *
 * Building a note's relations walks backlinks for every node of its group tree. Each backlink
 * lookup reads Obsidian's whole `resolvedLinks` map, so doing that per node costs
 * (nodes in the tree) x (notes in the vault). Inverting the map once per synchronous burst
 * makes it linear instead.
 *
 * As with group resolution, the assertions count operations rather than measure time:
 * operation counts are identical on every machine, wall clock is not.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NoteRelations } from '@/entities/NoteRelations'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { useVault, configureAbele } from '../helpers/testEnv'
import type { FakeApp, FakeFileSpec } from '../helpers/fakeVault'

interface ScaleOptions {
  subGroups: number
  membersPerSubGroup: number
  /** Notes in an unrelated branch, each linking somewhere — pure weight on the link index. */
  unrelatedNotes: number
}

/**
 * A group tree surrounded by link-dense unrelated notes. The unrelated notes are the point:
 * they are what a full scan of the link index wastes its time on, once per node.
 */
function buildScaleVault(options: ScaleOptions): {
  specs: FakeFileSpec[]
  rootPath: string
  expectedMembers: number
} {
  const specs: FakeFileSpec[] = [{ path: 'Notes/Root.md', content: 'Root\n' }]
  let expectedMembers = 0

  for (let s = 0; s < options.subGroups; s++) {
    const subName = `Sub ${s}`
    specs.push({
      path: `Notes/${subName}.md`,
      frontmatter: { groups: ['[[Root]]'] },
      content: `${subName}\n`,
    })
    expectedMembers++

    for (let m = 0; m < options.membersPerSubGroup; m++) {
      specs.push({
        path: `Tasks/Task ${s}-${m}.md`,
        frontmatter: { type: 'task', created: '2026-01-01', groups: [`[[${subName}]]`] },
        content: `Task ${s}-${m}\n`,
      })
      expectedMembers++
    }
  }

  specs.push({ path: 'Notes/Archive.md', content: 'Archive\n' })
  for (let i = 0; i < options.unrelatedNotes; i++) {
    specs.push({
      path: `Notes/Other ${i}.md`,
      frontmatter: { groups: ['[[Archive]]'] },
      content: `Other ${i} mentions [[Archive]]\n`,
    })
  }

  return { specs, rootPath: 'Notes/Root.md', expectedMembers }
}

describe('NoteRelations — relation gathering complexity', () => {
  const { specs, rootPath, expectedMembers } = buildScaleVault({
    subGroups: 10,
    membersPerSubGroup: 8,
    unrelatedNotes: 800,
  })

  let app: FakeApp
  let relations: NoteRelations | null = null

  beforeEach(async () => {
    // The backlink index self-clears on a microtask. Flushing here guarantees this test
    // builds its own rather than inheriting one built from a previous test's vault.
    await Promise.resolve()
    app = useVault(specs)
    configureAbele()
    app.resetStats()
  })

  afterEach(() => {
    relations?.cleanup()
    relations = null
    VaultWatcherWrapper.destroy()
  })

  it('reports the cost of gathering one wide group', () => {
    relations = new NoteRelations(rootPath)

    const gathered =
      relations.tasks.size +
      relations.notes.size +
      relations.logs.size +
      relations.transactions.size +
      relations.timeEntries.size

    console.info(
      [
        '',
        `  vault files ................ ${specs.length}`,
        `  gathered relations ......... ${gathered}`,
        `  resolvedLinks reads ........ ${app.stats.resolvedLinks}`,
        `  getFileCache() ............. ${app.stats.getFileCache}`,
        '',
      ].join('\n')
    )

    expect(gathered).toBe(expectedMembers)
  })

  it('reads the link index a constant number of times, not once per group node', () => {
    relations = new NoteRelations(rootPath)

    // One inversion serves the whole burst. A count that tracks the size of the group tree
    // means the index is being re-walked for every node.
    expect(app.stats.resolvedLinks).toBeLessThanOrEqual(2)
  })

  it('does not grow its link-index reads as the group tree widens', async () => {
    const narrow = buildScaleVault({ subGroups: 2, membersPerSubGroup: 2, unrelatedNotes: 800 })
    const wide = buildScaleVault({ subGroups: 10, membersPerSubGroup: 8, unrelatedNotes: 800 })

    const narrowApp = useVault(narrow.specs)
    configureAbele()
    narrowApp.resetStats()
    const narrowRelations = new NoteRelations(narrow.rootPath)
    const narrowReads = narrowApp.stats.resolvedLinks
    narrowRelations.cleanup()

    // Swapping the vault mid-test needs a microtask boundary: the index is cached for the
    // duration of a synchronous burst, so without this the second measurement would be
    // served from the first vault's index and read zero — passing for the wrong reason.
    await Promise.resolve()

    const wideApp = useVault(wide.specs)
    configureAbele()
    wideApp.resetStats()
    const wideRelations = new NoteRelations(wide.rootPath)
    const wideReads = wideApp.stats.resolvedLinks
    wideRelations.cleanup()

    console.info(
      `\n  narrow tree (${narrow.expectedMembers} members) -> ${narrowReads} link-index reads` +
        `\n  wide   tree (${wide.expectedMembers} members) -> ${wideReads} link-index reads\n`
    )

    expect(wideReads).toBeLessThanOrEqual(Math.max(narrowReads, 1) * 2)
  })
})
