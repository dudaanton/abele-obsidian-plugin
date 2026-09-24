/**
 * A daily note already open when Obsidian starts has its header built before the metadata cache
 * has read the note. Which journal a note is, and its day, is told from that metadata — so the
 * header had no day, and its previous and next day buttons had nowhere to go, until the note
 * itself changed.
 *
 * The header now tells its journal again once the metadata arrives.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { computed, reactive } from 'vue'
import type { TFile } from 'obsidian'
import { Header } from '@/entities/Header'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { useVault, dailyJournal, configureAbele } from '../helpers/testEnv'
import type { FakeFileSpec } from '../helpers/fakeVault'

const TODAY = 'Journals/2026/2026-08-22.md'

const VAULT: FakeFileSpec[] = [
  { path: TODAY, frontmatter: { type: 'journal' }, content: 'Today\n' },
]

describe('Header — a daily note open at startup', () => {
  let app: ReturnType<typeof useVault>
  let header: Header | null = null
  let metadataReady: boolean

  beforeEach(() => {
    app = useVault(VAULT)
    configureAbele({ journals: [dailyJournal()] })
    metadataReady = false
    const getFileCache = app.metadataCache.getFileCache.bind(app.metadataCache)
    app.metadataCache.getFileCache = (file: TFile) => (metadataReady ? getFileCache(file) : null)
  })

  afterEach(() => {
    header?.cleanup()
    header = null
    VaultWatcherWrapper.destroy()
  })

  const drawn = async () => {
    header = reactive(new Header({ id: 'h', filePath: TODAY })) as Header
    await header.load()
    const shown = computed(() => header!.journalDate?.format('YYYY-MM-DD') ?? null)
    expect(shown.value).toBeNull()
    return shown
  }

  it('gets its day once the note itself is reported read', async () => {
    const shown = await drawn()

    metadataReady = true
    app.emit('metadataCache', 'changed', app.vault.getAbstractFileByPath(TODAY))

    expect(shown.value).toBe('2026-08-22')
    expect(header!.journal?.id).toBe('test-daily')
  })

  it('gets its day once the first metadata pass ends', async () => {
    const shown = await drawn()

    metadataReady = true
    app.emit('metadataCache', 'resolved')

    expect(shown.value).toBe('2026-08-22')
  })

  it('ignores other notes being read', async () => {
    const shown = await drawn()
    let loads = 0
    const load = header!.load.bind(header)
    header!.load = async (force?: boolean) => {
      loads++
      return load(force)
    }

    app.emit('metadataCache', 'changed', { path: 'Notes/Other.md' })

    expect(loads).toBe(0)
    expect(shown.value).toBeNull()
  })
})
