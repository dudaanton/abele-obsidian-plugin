/**
 * Functional guarantees for group membership against a real running Obsidian.
 *
 * This is the safety net for the group-resolution rewrite. It is not about speed: it asserts
 * that groups are counted, previewed and updated exactly as they are today. `ScopeResolver`
 * decides which files the AI agent may touch, so a rewrite that quietly changes membership
 * widens or narrows the agent's reach — a correctness and security problem, not a perf one.
 *
 * Three independent forms of protection:
 *   1. A committed snapshot of real membership, regenerated only when explicitly asked.
 *   2. Agreement between the current implementation and a reference derived from Obsidian's
 *      precomputed link index — the basis the rewrite intends to adopt.
 *   3. Live mutation: a new note joins its group and leaves again when deleted.
 *
 * Requires a development build and OBSIDIAN_TEST_VAULT — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isObsidianRunning,
  hasTestApi,
  evalJson,
  evalRaw,
  activeVaultName,
  activeVaultFileCount,
} from './helpers/obsidianCli'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_PATH = path.join(HERE, '__snapshots__', 'group-membership.json')

/**
 * Groups to pin — two roots and a mid-level subgroup, so the snapshot covers every depth at
 * which membership is computed.
 *
 * The deliberately huge "Projects" branch is left out on purpose: resolving it currently
 * takes about two minutes and these tests resolve each group several times. Measuring that
 * cost is the cost tier's job (`scopeResolver.e2e.test.ts`); this file is about correctness.
 */
const SNAPSHOT_GROUPS = (
  process.env.OBSIDIAN_SNAPSHOT_GROUPS ??
  [
    'ScaleTest/Notes/People.md',
    'ScaleTest/Notes/Books.md',
    'ScaleTest/Notes/Atlas Books 5.md',
  ].join(',')
).split(',')

/** Group used for preview assertions — small enough to resolve repeatedly. */
const PREVIEW_GROUP = process.env.OBSIDIAN_PREVIEW_GROUP ?? 'ScaleTest/Notes/Books.md'
const UPDATE_SNAPSHOT = process.env.UPDATE_GROUP_SNAPSHOT === '1'

const available = isObsidianRunning() && hasTestApi()

function resolvedPaths(groupPath: string): string[] {
  return evalJson<string[]>(
    `(() => { const s = new window.__abeleTest.ScopeResolver();
      s.addGroup(${JSON.stringify(groupPath)});
      return [...s.resolve()].sort() })()`,
    900_000
  )
}

describe.skipIf(!available)('groups end-to-end', () => {
  beforeAll(() => {
    console.info(`\n  vault: ${activeVaultName()} (${activeVaultFileCount()} files)\n`)
  })

  describe('membership snapshot', () => {
    it('matches the committed snapshot for every pinned group', () => {
      const current: Record<string, string[]> = {}
      for (const group of SNAPSHOT_GROUPS) {
        current[group] = resolvedPaths(group)
      }

      if (UPDATE_SNAPSHOT || !fs.existsSync(SNAPSHOT_PATH)) {
        fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true })
        fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8')
        console.info(
          `  wrote group membership snapshot: ${Object.entries(current)
            .map(([g, paths]) => `${g} -> ${paths.length}`)
            .join(', ')}`
        )
        return
      }

      const expected = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Record<
        string,
        string[]
      >

      for (const group of SNAPSHOT_GROUPS) {
        expect(current[group], `membership changed for ${group}`).toEqual(expected[group])
      }
    })
  })

  describe('agreement with the link-index reference', () => {
    it.each(SNAPSHOT_GROUPS)('resolves %s identically to the reference', (group) => {
      const viaScan = resolvedPaths(group)
      const viaIndex = evalJson<string[]>(
        `window.__abeleTest.groupPathsViaLinkIndex(${JSON.stringify(group)})`,
        900_000
      )
      expect(viaIndex).toEqual(viaScan)
    })
  })

  describe('preview shown in the scope editor', () => {
    it('lists exactly the members the scope resolves to', () => {
      const preview = evalJson<string[]>(
        `window.__abeleTest.groupPreviewPaths(${JSON.stringify(PREVIEW_GROUP)})`,
        900_000
      )
      expect(preview).toEqual(resolvedPaths(PREVIEW_GROUP))
    })

    it('counts a non-trivial number of members', () => {
      const preview = evalJson<number>(
        `window.__abeleTest.groupPreviewPaths(${JSON.stringify(PREVIEW_GROUP)}).length`,
        900_000
      )
      expect(preview).toBeGreaterThan(100)
    })
  })

  describe('membership changes when notes change', () => {
    const probeGroup = SNAPSHOT_GROUPS[SNAPSHOT_GROUPS.length - 1]
    const probeName = 'ZZ Group Membership Probe'
    const probePath = `ScaleTest/Notes/${probeName}.md`

    afterAll(() => {
      // Always remove the probe, even if an assertion failed part-way.
      try {
        evalRaw(
          `(() => { const f = app.vault.getAbstractFileByPath(${JSON.stringify(probePath)});
            return f ? (app.vault.delete(f), 'deleted') : 'absent' })()`,
          60_000
        )
      } catch {
        // Nothing to clean up.
      }
    })

    it('adds a newly created note to its group and removes it again on delete', async () => {
      const groupName = path.basename(probeGroup, '.md')
      const before = resolvedPaths(probeGroup)
      expect(before).not.toContain(probePath)

      // Create the note through the vault API so Obsidian indexes it exactly as it would a
      // note the user typed.
      evalRaw(
        `(() => { const body = ${JSON.stringify(
          `---\ngroups:\n  - '[[${groupName}]]'\n---\n${probeName}\n`
        )};
          return app.vault.create(${JSON.stringify(probePath)}, body).then(() => 'ok') })()`,
        120_000
      )

      // Metadata indexing is asynchronous; wait for the frontmatter to become visible.
      const deadline = Date.now() + 60_000
      let indexed = false
      while (Date.now() < deadline) {
        indexed = evalJson<boolean>(
          `(() => { const f = app.vault.getAbstractFileByPath(${JSON.stringify(probePath)});
            if (!f) return false;
            const g = app.metadataCache.getFileCache(f);
            return !!(g && g.frontmatter && Array.isArray(g.frontmatter.groups)) })()`,
          60_000
        )
        if (indexed) break
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      expect(indexed, 'probe note was not indexed in time').toBe(true)

      expect(resolvedPaths(probeGroup)).toContain(probePath)

      evalRaw(
        `(() => { const f = app.vault.getAbstractFileByPath(${JSON.stringify(probePath)});
          return app.vault.delete(f).then(() => 'deleted') })()`,
        120_000
      )

      const removalDeadline = Date.now() + 60_000
      let removed = false
      while (Date.now() < removalDeadline) {
        removed = evalJson<boolean>(
          `app.vault.getAbstractFileByPath(${JSON.stringify(probePath)}) === null`,
          60_000
        )
        if (removed) break
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      expect(removed, 'probe note was not deleted in time').toBe(true)

      expect(resolvedPaths(probeGroup)).toEqual(before)
    })
  })
})
