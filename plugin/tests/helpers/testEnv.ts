/**
 * Shared wiring for integration tests: point the plugin's singletons at an in-memory vault
 * and a known configuration, without running their real initialisation.
 *
 * `GlobalStore.init()` also constructs a VaultWatcher and registers vault callbacks, and
 * `AbeleConfig.init()` needs a Plugin instance to load settings from disk. Neither is
 * relevant to the units under test, so the backing state is set directly instead.
 */
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { Journal, type JournalDTO } from '@/entities/Journal'
import { buildFakeVault, type FakeApp, type FakeFileSpec } from './fakeVault'

/** Installs a fake vault as the app every plugin singleton reads from. */
export function useVault(specs: FakeFileSpec[]): FakeApp {
  const app = buildFakeVault(specs)
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
  return app
}

/** Journal definition matching the plugin's own defaults for a daily journal. */
export function dailyJournal(overrides: Partial<JournalDTO> = {}): JournalDTO {
  return {
    id: 'test-daily',
    name: 'Daily',
    type: 'journal',
    isDefault: true,
    recurrence: 'daily',
    newPathTemplate: 'Journals/{{date:YYYY}}/{{date}}',
    ...overrides,
  }
}

/**
 * Resets configuration to a known baseline. `logsNotesTypes` goes through a setter that also
 * compiles the `/regexp/` entries, so it must be assigned rather than mutated in place.
 */
export function configureAbele(
  options: { journals?: JournalDTO[]; logsNotesTypes?: string[] } = {}
): AbeleConfig {
  const config = AbeleConfig.getInstance()
  config.journals = (options.journals ?? []).map((dto) => new Journal(dto))
  config.logsNotesTypes = options.logsNotesTypes ?? ['journal', 'log', 'daily']
  return config
}
