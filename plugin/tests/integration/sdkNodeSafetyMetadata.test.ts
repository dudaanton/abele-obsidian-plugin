// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { assertLocalSafety } from '../../node_modules/@abele/sync-sdk/dist/internal/node/externalSafety.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function ledger(key: string, value: string) {
  mkdirSync('../.scratch', { recursive: true })
  const root = mkdtempSync('../.scratch/sdk-safety-')
  roots.push(root)
  mkdirSync(join(root, '.abele-sync'))
  const db = new Database(join(root, '.abele-sync/state.db'))
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare('INSERT INTO meta VALUES (?, ?)').run(key, value)
  db.close()
  return root
}

it.each([
  'daemon:v2-local-note-cache',
  'daemon:pull-cleanup:sample',
  'daemon:pull-cleanup-head',
  'daemon:scoped-placement:pull-cleanup:sample',
  'daemon:scoped-placement:pull-cleanup-head',
  'daemon:scoped-placement:pull-write:sample',
  'daemon:held-deletes',
  'daemon:delete-decision',
])('does not load metadata unused at an active desktop effect boundary: %s', (key) => {
  const root = ledger(key, 'x'.repeat(1024 * 1024))
  const read: string[] = []
  const prepare = Database.prototype.prepare
  vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (sql: string) {
    const statement = prepare.call(this, sql)
    if (/SELECT key, value FROM meta/i.test(sql)) {
      const all = statement.all
      statement.all = function (...args: unknown[]) {
        const rows = all.apply(this, args) as { key: string }[]
        read.push(...rows.map((row) => row.key))
        return rows
      }
    }
    return statement
  })
  assertLocalSafety(root, false, false, true)
  expect(read).not.toContain(key)
})

it('observes new recovery evidence at the next effect boundary', () => {
  const root = ledger('daemon:v2-local-note-cache', '{}')
  assertLocalSafety(root, false, false, true)
  const db = new Database(join(root, '.abele-sync/state.db'))
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('daemon:external-disconnect-ready', '{}')
  db.close()
  expect(() => assertLocalSafety(root, false, false, true)).toThrow()
})

it.each([
  'daemon:external-disconnect-ready',
  'daemon:external-files',
  'daemon:settlement-departure:row:sample',
  'daemon:settlement-departure:index:',
  'daemon:pull-write:sample',
  'daemon:pull-cleanup:sample',
  'daemon:pull-cleanup-head',
  'daemon:scoped-placement:pull-cleanup:sample',
  'daemon:scoped-placement:pull-cleanup-head',
  'daemon:scoped-placement:pull-write:sample',
  'daemon:held-deletes',
  'daemon:delete-decision',
  'journal',
])('still refuses unresolved or malformed safety metadata: %s', (key) => {
  const root = ledger(key, '["sample-file"]')
  expect(() => assertLocalSafety(root, true)).toThrow()
})

it.fails('BUG: rejects an array used as the deferred queue document', () => {
  const root = ledger('daemon:deferred-changes', '["sample-file"]')
  expect(() => assertLocalSafety(root, true)).toThrow()
})

it('still rejects a deferred document whose staged field is not an array', () => {
  const root = ledger('daemon:deferred-changes', '{"staged":"invalid"}')
  expect(() => assertLocalSafety(root, true)).toThrow()
})
