import { describe, expect, it } from 'vitest'
import { NoteRelations } from '@/entities/NoteRelations'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { AbeleConfig } from '@/services/AbeleConfig'
import { configureAbele, dailyJournal, useVault } from '../helpers/testEnv'
import {
  JOURNAL_ORACLE_FOLDER,
  ORACLE_NEXT_DAY,
  journalOracleSpecs,
  journalOracleExpected,
  journalOracleNextExpected,
  oraclePath,
} from '../e2e/contracts/journalOracle'

const snapshot = (relations: NoteRelations) => ({
  tasks: [...relations.tasks.keys()].sort(),
  logs: [...relations.logs.keys()].sort(),
  transactions: [...relations.transactions.keys()].sort(),
  timeEntries: [...relations.timeEntries.keys()].sort(),
  notes: [...relations.notes.keys()].sort(),
})
it('matches an independent journal oracle cold, warm, after mutation and after renamed day', async () => {
  const config = AbeleConfig.getInstance(),
    previous = config.journals
  const app = useVault(
    journalOracleSpecs.map(({ name, fm }) => ({
      path: oraclePath(name),
      frontmatter: { ...fm },
      content: name.split('/').pop()!,
    }))
  )
  configureAbele({ journals: [dailyJournal({ type: `/^${JOURNAL_ORACLE_FOLDER}\\//` })] })
  let cold: NoteRelations | undefined, warm: NoteRelations | undefined
  try {
    const root = app.vault.getFileByPath(oraclePath('Journals/2028-03-15'))!
    app.resetStats()
    cold = new NoteRelations(root.path)
    expect(snapshot(cold)).toEqual(journalOracleExpected)
    expect(app.stats.getMarkdownFiles).toBe(1)
    app.emit('metadataCache', 'resolved')
    app.resetStats()
    warm = new NoteRelations(root.path)
    expect(snapshot(warm)).toEqual(journalOracleExpected)
    expect(app.stats.getMarkdownFiles).toBe(0)
    for (const name of ['Sample due task', 'Sample created note']) {
      const path = oraclePath(name)
      app.setFrontmatter(
        path,
        name === 'Sample due task'
          ? { type: 'task', due: ORACLE_NEXT_DAY }
          : { type: 'note', created: ORACLE_NEXT_DAY }
      )
      app.emit('metadataCache', 'changed', app.vault.getFileByPath(path)!)
    }
    app.emit('metadataCache', 'resolved')
    expect(snapshot(cold)).toEqual({ ...journalOracleExpected, tasks: [], notes: [] })
    expect(snapshot(warm)).toEqual({ ...journalOracleExpected, tasks: [], notes: [] })
    const old = root.path
    await app.vault.rename(root, oraclePath('Journals/2028-03-16'))
    app.emit('vault', 'rename', root, old)
    app.emit('metadataCache', 'resolved')
    expect(cold.journalDate?.format('YYYY-MM-DD')).toBe(ORACLE_NEXT_DAY)
    expect(snapshot(cold)).toEqual(journalOracleNextExpected)
    expect(snapshot(warm)).toEqual(journalOracleNextExpected)
    expect(app.stats.getMarkdownFiles).toBe(0)
  } finally {
    cold?.cleanup()
    warm?.cleanup()
    VaultWatcherWrapper.destroy()
    config.journals = previous
  }
})
