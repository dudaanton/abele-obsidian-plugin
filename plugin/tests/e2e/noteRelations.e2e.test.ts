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
import { evalLong } from './helpers/obsidianCli'
import {
  JOURNAL_ORACLE_FOLDER,
  ORACLE_NEXT_DAY,
  journalOracleSpecs,
  journalOracleExpected,
  journalOracleNextExpected,
  oraclePath,
} from './contracts/journalOracle'
import { snapshotBaseline } from './helpers/snapshotBaseline'
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

/** A journal note whose effective-day relations come from the shared vault index. */
const JOURNAL_NOTE = process.env.OBSIDIAN_JOURNAL_NOTE ?? 'ScaleTest/Journals/2024/2024-03-15.md'

const UPDATE_SNAPSHOT = process.env.UPDATE_RELATIONS_SNAPSHOT === '1'

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

      const expected = snapshotBaseline(SNAPSHOT_PATH, current, UPDATE_SNAPSHOT)
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

    it('uses the warmed shared day index without another full-vault sweep', () => {
      expect(journal.getMarkdownFilesCalls).toBe(0)
    })

    it('matches invented journal membership after warm queries, mutation and renamed day', async () => {
      const report = JSON.parse(
        await evalLong(`(async () => {
        const api = window.__abeleTest, config = api.AbeleConfig.getInstance()
        const folder = ${JSON.stringify(JOURNAL_ORACLE_FOLDER)}
        const previous = config.journals
        const select = result => Object.fromEntries(['tasks','logs','transactions','timeEntries','notes'].map(key => [key,result[key]]))
        const measure = path => api.measureNoteRelations(path)
        const until = async (read, expected) => {
          const deadline = Date.now() + 15000
          while (Date.now() < deadline) {
            const value = read()
            if (JSON.stringify(select(value)) === JSON.stringify(expected)) return value
            await new Promise(r => setTimeout(r,50))
          }
          throw Error('journal oracle mismatch: ' + JSON.stringify(select(read())))
        }
        if (app.vault.getAbstractFileByPath(folder)) throw Error('oracle fixture already exists')
        try {
          config.journals = [...previous, new api.Journal({id:'sample-index-oracle',name:'Sample index oracle',type:'/^Sample journal oracle\\\\//',isDefault:true,recurrence:'daily'})]
          await app.vault.createFolder(folder)
          for (const sub of ['Journals','Other']) await app.vault.createFolder(folder+'/'+sub)
          for (const {name,fm} of ${JSON.stringify(journalOracleSpecs)}) {
            const text = '---\\n' + Object.entries(fm).map(([key,value])=>key+': '+JSON.stringify(value)).join('\\n') + '\\n---\\n' + name.split('/').pop()
            const file = await app.vault.create(folder+'/'+name+'.md',text)
            const deadline = Date.now()+15000
            while (!app.metadataCache.getFileCache(file) && Date.now()<deadline) await new Promise(r=>setTimeout(r,50))
          }
          const rootPath = ${JSON.stringify(oraclePath('Journals/2028-03-15'))}
          const initial = await until(()=>measure(rootPath),${JSON.stringify(journalOracleExpected)})
          const warm = measure(rootPath)
          for (const name of ['Sample due task','Sample created note']) {
            const file = app.vault.getAbstractFileByPath(folder+'/'+name+'.md')
            await app.fileManager.processFrontMatter(file,fm=> { if(name==='Sample due task') fm.due=${JSON.stringify(ORACLE_NEXT_DAY)}; else fm.created=${JSON.stringify(ORACLE_NEXT_DAY)} })
          }
          const expectedMutation = {...${JSON.stringify(journalOracleExpected)},tasks:[],notes:[]}
          const mutation = await until(()=>measure(rootPath),expectedMutation)
          const root = app.vault.getAbstractFileByPath(rootPath)
          const renamedPath = ${JSON.stringify(oraclePath('Journals/2028-03-16'))}
          await app.fileManager.renameFile(root,renamedPath)
          const renamed = await until(()=>measure(renamedPath),${JSON.stringify(journalOracleNextExpected)})
          return {initial,warm,mutation,renamed}
        } finally {
          config.journals=previous
          const fixture=app.vault.getAbstractFileByPath(folder)
          if(fixture) await app.vault.delete(fixture,true)
        }
      })()`)
      )
      for (const key of ['initial', 'warm']) {
        for (const field of ['tasks', 'logs', 'transactions', 'timeEntries', 'notes'] as const)
          expect(report[key][field]).toEqual(journalOracleExpected[field])
      }
      expect(report.mutation.tasks).toEqual([])
      expect(report.mutation.notes).toEqual([])
      for (const field of ['logs', 'transactions', 'timeEntries'] as const)
        expect(report.mutation[field]).toEqual(journalOracleExpected[field])
      for (const field of ['tasks', 'logs', 'transactions', 'timeEntries', 'notes'] as const)
        expect(report.renamed[field]).toEqual(journalOracleNextExpected[field])
      for (const result of Object.values(report) as NoteRelationsMeasurement[]) {
        expect(result.getMarkdownFilesCalls).toBe(0)
        expect(result.fileCacheReads).toBeLessThanOrEqual(result.vaultFiles * 2)
        expect(result.linkResolutions).toBeLessThanOrEqual(result.vaultFiles * 2)
      }
    })

    it('does not sweep the vault for a note that is not a journal', () => {
      expect(group.getMarkdownFilesCalls).toBe(0)
    })
  })

  describe('cost', () => {
    it('bounds link resolution while building a group note relation set', () => {
      expect(group.linkResolutions).toBeLessThanOrEqual(group.vaultFiles * 2)
    })

    it('reads each note in the vault a bounded number of times', () => {
      // Backlink lookups scan the whole link index. Doing that once per node of the group
      // tree, rather than once in total, is what makes this grow with the tree rather than
      // with the vault.
      expect(group.fileCacheReads).toBeLessThanOrEqual(group.vaultFiles * 2)
    })

    it('bounds metadata work while building a journal note relation set', () => {
      expect(journal.fileCacheReads).toBeLessThanOrEqual(journal.vaultFiles * 2)
      expect(journal.linkResolutions).toBeLessThanOrEqual(journal.vaultFiles * 2)
    })
  })
})
