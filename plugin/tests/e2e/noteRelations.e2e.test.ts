/**
 * What a note gathers from its group tree, against a real running Obsidian.
 *
 * Correctness is pinned by a committed snapshot of the actual tasks, logs, transactions and
 * time entries a group note collects — including everything filed against its subgroups.
 * Cost is asserted separately: building this set happens when a note is opened, so it sits
 * directly in front of the user.
 *
 * Requires a development build and OBSIDIAN_TEST_VAULT — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isObsidianRunning, hasTestApi, evalJson, activeVaultName } from './helpers/obsidianCli'

interface NoteRelationsMeasurement {
  ms: number
  tasks: string[]
  logs: string[]
  transactions: string[]
  timeEntries: string[]
  notes: string[]
  getMarkdownFilesCalls: number
  fileCacheReads: number
  linkResolutions: number
  vaultFiles: number
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_PATH = path.join(HERE, '__snapshots__', 'note-relations.json')

/** A mid-level group: deep enough to have subgroups, small enough to snapshot in full. */
const GROUP_NOTE = process.env.OBSIDIAN_RELATIONS_NOTE ?? 'ScaleTest/Notes/Atlas Books 5.md'

/** A journal note, which additionally sweeps the whole vault for anything dated to its day. */
const JOURNAL_NOTE = process.env.OBSIDIAN_JOURNAL_NOTE ?? 'ScaleTest/Journals/2024/2024-03-15.md'

const UPDATE_SNAPSHOT = process.env.UPDATE_RELATIONS_SNAPSHOT === '1'

/** Opening a note should feel immediate; a second of frozen UI does not. */
const ACCEPTABLE_MS = 300

const available = isObsidianRunning() && hasTestApi()

function measure(notePath: string): NoteRelationsMeasurement {
  return evalJson<NoteRelationsMeasurement>(
    `window.__abeleTest.measureNoteRelations(${JSON.stringify(notePath)})`,
    900_000
  )
}

describe.skipIf(!available)('note relations end-to-end', () => {
  let group: NoteRelationsMeasurement
  let journal: NoteRelationsMeasurement

  beforeAll(() => {
    group = measure(GROUP_NOTE)
    journal = measure(JOURNAL_NOTE)

    console.info(
      [
        '',
        `  vault ...................... ${activeVaultName()} (${group.vaultFiles} files)`,
        '',
        `  group note ................. ${GROUP_NOTE}`,
        `    tasks .................... ${group.tasks.length}`,
        `    logs ..................... ${group.logs.length}`,
        `    transactions ............. ${group.transactions.length}`,
        `    time entries ............. ${group.timeEntries.length}`,
        `    notes .................... ${group.notes.length}`,
        `    getFileCache() ........... ${group.fileCacheReads.toLocaleString()}`,
        `    wall clock ............... ${Math.round(group.ms)}ms`,
        '',
        `  journal note ............... ${JOURNAL_NOTE}`,
        `    markdown sweeps .......... ${journal.getMarkdownFilesCalls}`,
        `    getFileCache() ........... ${journal.fileCacheReads.toLocaleString()}`,
        `    wall clock ............... ${Math.round(journal.ms)}ms`,
        '',
      ].join('\n')
    )
  }, 900_000)

  describe('correctness', () => {
    it('matches the committed snapshot of gathered relations', () => {
      const current = {
        [GROUP_NOTE]: {
          tasks: group.tasks,
          logs: group.logs,
          transactions: group.transactions,
          timeEntries: group.timeEntries,
          notes: group.notes,
        },
      }

      if (UPDATE_SNAPSHOT || !fs.existsSync(SNAPSHOT_PATH)) {
        fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true })
        fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8')
        console.info(
          `  wrote relations snapshot: ${group.tasks.length} tasks, ${group.logs.length} logs, ` +
            `${group.transactions.length} transactions, ${group.timeEntries.length} time entries, ` +
            `${group.notes.length} notes`
        )
        return
      }

      const expected = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'))
      expect(current).toEqual(expected)
    })

    it('gathers tasks from the group tree', () => {
      expect(group.tasks.length).toBeGreaterThan(0)
    })

    it('gathers journal logs from the group tree', () => {
      expect(group.logs.length).toBeGreaterThan(0)
    })

    it('never lists the note itself among its own relations', () => {
      const everything = [
        ...group.tasks,
        ...group.logs,
        ...group.transactions,
        ...group.timeEntries,
        ...group.notes,
      ]
      expect(everything).not.toContain(GROUP_NOTE)
    })

    it('sweeps the vault exactly once for a journal note', () => {
      expect(journal.getMarkdownFilesCalls).toBe(1)
    })

    it('does not sweep the vault for a note that is not a journal', () => {
      expect(group.getMarkdownFilesCalls).toBe(0)
    })
  })

  describe('cost', () => {
    it('builds a group note relation set without a visible freeze', () => {
      expect(group.ms).toBeLessThan(ACCEPTABLE_MS)
    })

    it('reads each note in the vault a bounded number of times', () => {
      // Backlink lookups scan the whole link index. Doing that once per node of the group
      // tree, rather than once in total, is what makes this grow with the tree rather than
      // with the vault.
      expect(group.fileCacheReads).toBeLessThanOrEqual(group.vaultFiles * 2)
    })

    it('builds a journal note relation set without a visible freeze', () => {
      expect(journal.ms).toBeLessThan(ACCEPTABLE_MS)
    })
  })
})
