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

/**
 * A group graph that is not a tree.
 *
 * Each level hangs two notes off the previous hub and then a new hub that belongs to both of
 * them, so every level doubles the number of distinct routes from the root to the bottom.
 * The relations are unchanged by that — the same notes are reachable either way — but a walk
 * that only remembers the route it took expands the bottom of the graph once per route.
 *
 * Real vaults produce the same shape whenever a note belongs to two groups that share a
 * parent, which is ordinary rather than exotic.
 */
function buildDiamondVault(depth: number, leaves: number): FakeFileSpec[] {
  const specs: FakeFileSpec[] = [{ path: 'Notes/Hub 0.md', content: 'root\n' }]

  for (let level = 1; level <= depth; level++) {
    for (const side of ['A', 'B']) {
      specs.push({
        path: `Notes/${side} ${level}.md`,
        frontmatter: { groups: [`[[Hub ${level - 1}]]`] },
        content: `${side} ${level}\n`,
      })
    }
    specs.push({
      path: `Notes/Hub ${level}.md`,
      frontmatter: { groups: [`[[A ${level}]]`, `[[B ${level}]]`] },
      content: `Hub ${level}\n`,
    })
  }

  for (let leaf = 0; leaf < leaves; leaf++) {
    specs.push({
      path: `Tasks/Leaf ${leaf}.md`,
      frontmatter: { type: 'task', created: '2026-01-01', groups: [`[[Hub ${depth}]]`] },
      content: `Leaf ${leaf}\n`,
    })
  }

  return specs
}

/** Every note the walk should reach, regardless of how many routes lead to it. */
function expectedDiamondMembers(depth: number, leaves: number): number {
  return depth * 3 + leaves
}

describe('NoteRelations — group graphs with more than one route to a node', () => {
  let app: FakeApp
  let relations: NoteRelations | null = null

  beforeEach(async () => {
    await Promise.resolve()
  })

  afterEach(() => {
    relations?.cleanup()
    relations = null
    VaultWatcherWrapper.destroy()
  })

  const gather = (specs: FakeFileSpec[]): { app: FakeApp; gathered: number } => {
    app = useVault(specs)
    configureAbele()
    app.resetStats()

    relations = new NoteRelations('Notes/Hub 0.md')

    return {
      app,
      gathered:
        relations.tasks.size +
        relations.notes.size +
        relations.logs.size +
        relations.transactions.size +
        relations.timeEntries.size,
    }
  }

  it('reaches every member exactly once, whichever route leads there', () => {
    const { gathered } = gather(buildDiamondVault(7, 30))

    expect(gathered).toBe(expectedDiamondMembers(7, 30))
  })

  it('does not re-walk a node once per route that reaches it', () => {
    const depth = 7
    const leaves = 30
    const { app: vault, gathered } = gather(buildDiamondVault(depth, leaves))

    console.info(
      [
        '',
        `  graph depth ................ ${depth} (2^${depth} = ${2 ** depth} routes to the bottom)`,
        `  members gathered ........... ${gathered}`,
        `  getFileCache() ............. ${vault.stats.getFileCache}`,
        '',
      ].join('\n')
    )

    // Every visit reads a file's frontmatter, so cache reads track how often the graph was
    // walked. Bounded by the members, this says each node was visited a fixed number of
    // times; unbounded, it tracks the number of routes and so doubles with every level.
    expect(vault.stats.getFileCache).toBeLessThan(gathered * 10)
  })

  it('costs no more per level as the number of routes doubles', async () => {
    const shallow = gather(buildDiamondVault(4, 30))
    const shallowReads = shallow.app.stats.getFileCache

    VaultWatcherWrapper.destroy()
    relations?.cleanup()
    relations = null

    // The backlink index lives for one tick. Without this boundary the second vault would be
    // served the first one's index and report its reads, which is how this test first passed
    // while measuring nothing.
    await Promise.resolve()

    const deep = gather(buildDiamondVault(8, 30))
    const deepReads = deep.app.stats.getFileCache

    console.info(
      `\n  depth 4 (${2 ** 4} routes) -> ${shallowReads} cache reads` +
        `\n  depth 8 (${2 ** 8} routes) -> ${deepReads} cache reads\n`
    )

    // Four more levels multiply the routes by sixteen. Work must follow the four extra
    // levels of members, not the sixteenfold increase in ways to reach them.
    expect(deepReads).toBeLessThan(shallowReads * 3)
  })
})
