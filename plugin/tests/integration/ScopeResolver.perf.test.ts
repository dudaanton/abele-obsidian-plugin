/**
 * Performance contract for group scope resolution.
 *
 * These assertions describe the complexity the implementation SHOULD have, and currently
 * fail — that is deliberate. `resolveGroup` rescans the entire vault once per node in the
 * group's transitive closure, so its cost is (closure size) x (notes carrying `groups`)
 * rather than linear in vault size.
 *
 * The primary assertions count API operations rather than measuring milliseconds. Operation
 * counts are identical on every machine and CI runner, so they cannot flake; wall-clock time
 * is reported alongside purely as human-readable context.
 */
import { describe, it, expect } from 'vitest'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'
import { buildFakeVault, type FakeApp, type FakeFileSpec } from '../helpers/fakeVault'

interface ScaleVaultOptions {
  /** Number of second-level groups directly under the root group. */
  subGroups: number
  /** Number of third-level groups under each second-level group. */
  leafGroupsPerSub: number
  /** Notes attached to each leaf group. */
  membersPerLeaf: number
  /** Notes with a `groups` property that belong to an unrelated branch. */
  unrelatedNotes: number
}

/**
 * Builds a vault shaped like the one `scripts/generate-vault.mjs` produces: a three-level
 * group tree whose root has a wide transitive closure, surrounded by link-dense notes that
 * belong to a different branch. The unrelated notes matter — they are what a full-vault
 * rescan wastes its time on.
 */
function buildScaleVault(options: ScaleVaultOptions): {
  specs: FakeFileSpec[]
  rootPath: string
  closureSize: number
} {
  const specs: FakeFileSpec[] = [{ path: 'Notes/Projects.md' }]
  let closureSize = 1

  for (let s = 0; s < options.subGroups; s++) {
    const subName = `Sub ${s}`
    specs.push({ path: `Notes/${subName}.md`, frontmatter: { groups: ['[[Projects]]'] } })
    closureSize++

    for (let l = 0; l < options.leafGroupsPerSub; l++) {
      const leafName = `Leaf ${s}-${l}`
      specs.push({ path: `Notes/${leafName}.md`, frontmatter: { groups: [`[[${subName}]]`] } })
      closureSize++

      for (let m = 0; m < options.membersPerLeaf; m++) {
        specs.push({
          path: `Notes/Member ${s}-${l}-${m}.md`,
          frontmatter: { groups: [`[[${leafName}]]`] },
        })
        closureSize++
      }
    }
  }

  // A second, unrelated branch. Every one of these carries a `groups` property, so a
  // full-vault rescan pays a link resolution for each of them on every recursion step.
  specs.push({ path: 'Notes/Archive.md' })
  for (let i = 0; i < options.unrelatedNotes; i++) {
    specs.push({ path: `Notes/Other ${i}.md`, frontmatter: { groups: ['[[Archive]]'] } })
  }

  return { specs, rootPath: 'Notes/Projects.md', closureSize }
}

function useVault(specs: FakeFileSpec[]): FakeApp {
  const app = buildFakeVault(specs)
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
  return app
}

describe('ScopeResolver — group resolution complexity', () => {
  // Deliberately modest so the suite stays fast even while the implementation is quadratic.
  // The e2e tier exercises the same shape at real vault scale.
  const { specs, rootPath, closureSize } = buildScaleVault({
    subGroups: 12,
    leafGroupsPerSub: 4,
    membersPerLeaf: 12,
    unrelatedNotes: 1200,
  })

  it('reports the cost of resolving one wide group', () => {
    const app = useVault(specs)
    const scope = new ScopeResolver()
    scope.addGroup(rootPath)

    const startedAt = performance.now()
    const resolved = scope.resolve()
    const elapsed = performance.now() - startedAt

    const vaultSize = specs.length
    console.info(
      [
        '',
        `  vault files ................ ${vaultSize}`,
        `  group closure .............. ${closureSize}`,
        `  resolved paths ............. ${resolved.size}`,
        `  vault.getFiles() ........... ${app.stats.getFiles}`,
        `  metadataCache.getFileCache() ${app.stats.getFileCache}`,
        `  getFirstLinkpathDest() ..... ${app.stats.getFirstLinkpathDest}`,
        `  wall clock ................. ${elapsed.toFixed(0)}ms`,
        '',
      ].join('\n')
    )

    // Sanity: the closure really is what we think it is, so the numbers below mean something.
    expect(resolved.size).toBe(closureSize)
  })

  it('scans the vault a constant number of times, not once per group node', () => {
    const app = useVault(specs)
    const scope = new ScopeResolver()
    scope.addGroup(rootPath)
    scope.resolve()

    // One pass over the vault is enough to build a complete group index. Allowing a small
    // constant leaves room for an implementation that makes a couple of passes.
    expect(app.stats.getFiles).toBeLessThanOrEqual(4)
  })

  it('resolves links a number of times proportional to the vault, not to closure x vault', () => {
    const app = useVault(specs)
    const scope = new ScopeResolver()
    scope.addGroup(rootPath)
    scope.resolve()

    // Every note's `groups` entries need resolving once. Anything beyond a small multiple
    // of the vault size means the same links are being re-resolved on each recursion step.
    expect(app.stats.getFirstLinkpathDest).toBeLessThanOrEqual(specs.length * 2)
  })

  it('inspects each note in the vault a bounded number of times', () => {
    const app = useVault(specs)
    const scope = new ScopeResolver()
    scope.addGroup(rootPath)
    scope.resolve()

    expect(app.stats.getFileCache).toBeLessThanOrEqual(specs.length * 2)
  })

  it('costs no more for a wide group than the vault it lives in', () => {
    // Resolution should scale with vault size. Doubling the closure while holding the vault
    // roughly constant should not multiply the work.
    const narrow = buildScaleVault({
      subGroups: 3,
      leafGroupsPerSub: 2,
      membersPerLeaf: 4,
      unrelatedNotes: 1200,
    })
    const wide = buildScaleVault({
      subGroups: 12,
      leafGroupsPerSub: 4,
      membersPerLeaf: 12,
      unrelatedNotes: 600,
    })

    const narrowApp = useVault(narrow.specs)
    const narrowScope = new ScopeResolver()
    narrowScope.addGroup(narrow.rootPath)
    narrowScope.resolve()
    const narrowOps = narrowApp.stats.getFirstLinkpathDest

    const wideApp = useVault(wide.specs)
    const wideScope = new ScopeResolver()
    wideScope.addGroup(wide.rootPath)
    wideScope.resolve()
    const wideOps = wideApp.stats.getFirstLinkpathDest

    console.info(
      `\n  narrow closure ${narrow.closureSize} over ${narrow.specs.length} files -> ${narrowOps} link resolutions` +
        `\n  wide   closure ${wide.closureSize} over ${wide.specs.length} files -> ${wideOps} link resolutions\n`
    )

    // Both vaults are within ~2x in size, so a linear implementation keeps these comparable.
    expect(wideOps).toBeLessThanOrEqual(narrowOps * 4)
  })
})
