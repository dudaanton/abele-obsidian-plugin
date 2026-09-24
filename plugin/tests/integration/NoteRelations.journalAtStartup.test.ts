/**
 * A daily note already open when Obsidian starts has its footer built before the metadata
 * cache has read the note. Which journal a note belongs to, and its day, is told from that
 * metadata — so the footer was built with no day, and the tasks dated to it did not show until
 * the note was opened again.
 *
 * The note now tells its journal again once the metadata arrives, and takes in that day's notes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { computed, reactive } from 'vue'
import type { TFile } from 'obsidian'
import { NoteRelations } from '@/entities/NoteRelations'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { useVault, dailyJournal, configureAbele } from '../helpers/testEnv'
import type { FakeFileSpec } from '../helpers/fakeVault'

const TODAY = 'Journals/2026/2026-08-22.md'
const DATED = 'Tasks/Water the plants.md'

const VAULT: FakeFileSpec[] = [
  { path: TODAY, frontmatter: { type: 'journal' }, content: 'Today\n' },
  {
    path: DATED,
    frontmatter: { type: 'task', created: '2026-08-01', date: '2026-08-22' },
    content: 'Water the plants\n',
  },
]

describe('NoteRelations — a daily note open at startup', () => {
  let app: ReturnType<typeof useVault>
  let relations: NoteRelations | null = null
  let metadataReady: boolean

  beforeEach(() => {
    app = useVault(VAULT)
    configureAbele({ journals: [dailyJournal()] })
    // The metadata cache has not read the note yet.
    metadataReady = false
    const getFileCache = app.metadataCache.getFileCache.bind(app.metadataCache)
    app.metadataCache.getFileCache = (file: TFile) => (metadataReady ? getFileCache(file) : null)
  })

  afterEach(() => {
    relations?.cleanup()
    relations = null
    VaultWatcherWrapper.destroy()
  })

  const ready = () => {
    metadataReady = true
    app.emit('metadataCache', 'changed', app.vault.getAbstractFileByPath(TODAY))
    app.emit('metadataCache', 'resolved')
  }

  it('gets its day, and the tasks dated to it, once the metadata is read', () => {
    relations = new NoteRelations(TODAY)
    expect(relations.journalDate ?? null).toBeNull()

    ready()

    expect(relations.journalDate?.format('YYYY-MM-DD')).toBe('2026-08-22')
    expect(relations.journal?.id).toBe('test-daily')
    expect([...relations.tasks.keys()]).toContain(DATED)
  })

  it('gets it when only the resolved pass reports the metadata', () => {
    relations = new NoteRelations(TODAY)
    metadataReady = true
    app.emit('metadataCache', 'resolved')

    expect(relations.journalDate?.format('YYYY-MM-DD')).toBe('2026-08-22')
    expect([...relations.tasks.keys()]).toContain(DATED)
  })

  it('shows the day on the footer drawn before it was known', () => {
    const footerRelations = reactive(new NoteRelations(TODAY))
    relations = footerRelations as NoteRelations
    const shown = computed(() => footerRelations.journalDate?.format('YYYY-MM-DD') ?? null)
    expect(shown.value).toBeNull()

    ready()

    expect(shown.value).toBe('2026-08-22')
  })
})
