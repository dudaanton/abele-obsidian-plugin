/** Operation counts are the contract; timings are context, never pass/fail thresholds.
 * FIND_DISK_BENCH=1 also generates 50k notes in a temporary directory and reads real files.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFindTool } from '@/ai/tools/FindTool'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'
import { buildFakeVault, type FakeFileSpec } from '../helpers/fakeVault'

const size = 50_000
const specs: FakeFileSpec[] = Array.from({ length: size }, (_, i) => {
  const path = `Notes/Batch-${Math.floor(i / 1000)}/Sample-${String(i).padStart(5, '0')}.md`
  const frontmatter = {
    type: i % 10 === 0 ? 'task' : 'note',
    tags: ['sample'],
    groups: ['[[Sample-00000]]'],
  }
  const body =
    `# Sample ${i}\n\n` +
    'Planning notes and follow-up questions. See [[Notes/Batch-0/Sample-00000]].\n'.repeat(
      16 + (i % 64)
    ) +
    (i % 10 === 0 ? '\nNeedle: follow up on the draft.\n' : '\nReview the next revision.\n')
  return {
    path,
    frontmatter,
    raw: `---\ntype: ${frontmatter.type}\ntags:\n  - sample\ngroups:\n  - "[[Sample-00000]]"\n---\n${body}`,
  }
})

afterEach(() => vi.restoreAllMocks())

function setup() {
  const app = buildFakeVault(specs)
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
  const scope = new ScopeResolver()
  scope.setFullVaultAccess(true)
  return { app, scope, ctx: { scope, interactive: false } }
}

describe('find — large vault work bounds', () => {
  it('reports representative query timings with exact counts and filtered reads', async () => {
    const { app, scope, ctx } = setup()
    const tool = createFindTool()
    const disk = process.env.FIND_DISK_BENCH === '1'
    const dir = disk ? await mkdtemp(join(tmpdir(), 'find-bench-')) : undefined
    try {
      if (dir) {
        for (let b = 0; b < 50; b++) await mkdir(join(dir, `Notes/Batch-${b}`), { recursive: true })
        for (let at = 0; at < specs.length; at += 64) {
          await Promise.all(
            specs.slice(at, at + 64).map((s) => writeFile(join(dir, s.path), s.raw!))
          )
        }
        app.vault.cachedRead = async (file) => {
          app.stats.read++
          return readFile(join(dir, file.path), 'utf8')
        }
      }
      const cases = [
        {
          name: 'word',
          criteria: [{ type: 'content', operator: 'contains', value: 'Needle' }],
          reads: size,
          count: 5000,
        },
        {
          name: 'regex',
          criteria: [{ type: 'content', operator: 'regex', value: 'Needle:.*draft' }],
          reads: size,
          count: 5000,
        },
        {
          name: 'path + word',
          criteria: [
            { type: 'path', operator: 'startsWith', value: 'Notes/Batch-0/' },
            { type: 'content', operator: 'contains', value: 'Needle' },
          ],
          reads: 1000,
          count: 100,
        },
        {
          name: 'property + word',
          criteria: [
            { type: 'content', operator: 'contains', value: 'Needle' },
            { type: 'property', operator: 'equals', property: 'type', value: 'task' },
          ],
          reads: 5000,
          count: 5000,
        },
        {
          name: 'name, no content',
          criteria: [{ type: 'name', operator: 'startsWith', value: 'Sample-00' }],
          reads: 0,
          count: 1000,
        },
        {
          name: 'property, no content',
          criteria: [{ type: 'property', operator: 'equals', property: 'type', value: 'task' }],
          reads: 0,
          count: 5000,
        },
      ]
      for (const c of cases) {
        scope.invalidate()
        app.resetStats()
        const resolve = vi.spyOn(scope, 'getAccessiblePaths')
        const start = performance.now()
        const result = await tool.execute(
          'find',
          { criteria: c.criteria, limit: 7 },
          undefined,
          ctx
        )
        console.info(
          `find ${disk ? 'disk' : 'memory'} ${c.name}: ${(performance.now() - start).toFixed(0)}ms; ${app.stats.read} reads`
        )
        const text = result.content.map((b) => b.text).join('')
        expect(text.split('\n')[0]).toBe(`7 of ${c.count} files:`)
        expect(text.split('\n')).toHaveLength(8)
        expect(app.stats.read).toBe(c.reads)
        expect(app.stats.getFiles).toBe(1)
        expect(resolve).toHaveBeenCalledTimes(1)
        resolve.mockRestore()
      }
    } finally {
      scope.destroy()
      if (dir) await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('overlaps cold reads with bounded fan-out, preserving the first results and exact total', async () => {
    const { app, scope, ctx } = setup()
    const read = app.vault.cachedRead.bind(app.vault)
    let pending: (() => void)[] = []
    let rounds = 0
    let maxPending = 0
    const pump = setInterval(() => {
      if (!pending.length) return
      rounds++
      const batch = pending
      pending = []
      // Complete backwards to expose ordering bugs.
      batch.reverse().forEach((done) => done())
    }, 0)
    app.vault.cachedRead = (file) =>
      new Promise((resolve) => {
        pending.push(() => {
          void read(file).then(resolve)
        })
        maxPending = Math.max(maxPending, pending.length)
      })
    try {
      const start = performance.now()
      const result = await createFindTool().execute(
        'find',
        {
          criteria: [{ type: 'content', operator: 'contains', value: 'Needle' }],
          limit: 3,
        },
        undefined,
        ctx
      )
      expect(result.content[0].text).toBe(
        '3 of 5000 files:\nNotes/Batch-0/Sample-00000.md\nNotes/Batch-0/Sample-00010.md\nNotes/Batch-0/Sample-00020.md'
      )
      console.info(
        `find delayed word: ${(performance.now() - start).toFixed(0)}ms; ${rounds} I/O rounds; peak ${maxPending} reads`
      )
      expect(app.stats.read).toBe(size)
      expect(maxPending).toBeGreaterThan(1)
      expect(maxPending).toBeLessThanOrEqual(64)
      expect(rounds).toBeLessThanOrEqual(Math.ceil(size / 16))
      expect(app.stats.getFiles).toBe(1)
    } finally {
      clearInterval(pump)
      scope.destroy()
    }
  }, 120_000)
})
