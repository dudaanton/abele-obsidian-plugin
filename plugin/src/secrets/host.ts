/**
 * The synced secret store, wired to the running plugin: `data.json` for the store, Obsidian's
 * keychain for this device's key.
 *
 * Why `data.json` and not a file of its own beside it: Obsidian Sync carries exactly four
 * files out of a plugin's folder — `manifest.json`, `main.js`, `styles.css` and `data.json` —
 * and ignores anything else there, so a separate file would never reach a phone synced that
 * way. The cost is that every settings save rewrites the store's few kilobytes of ciphertext
 * unchanged, which is harmless: the store is only re-encrypted when a secret changes.
 */
import type { Plugin } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { collectEntries } from '@/transfer/entries'
import { voiceKeyId } from '@/ai/transcriptionSettings'
import { SecretStore, type StoreHost } from './SecretStore'
import type { SecretStoreFile } from './storeFile'

/**
 * Every keychain id the settings point at. The transfer sections already say, for each thing
 * that can travel, which keychain ids it needs — the one list of what is a secret, so a new
 * setting that declares its `secretsOf` is in the store the day it exists.
 */
export function pluginSecretIds(): string[] {
  const ids = collectEntries(AbeleConfig.getInstance().exportSettings()).flatMap(
    (entry) => entry.secretIds ?? []
  )
  // Voice input reads its key under a default name even when its settings were never
  // touched, and untouched settings are no entry at all.
  ids.push(voiceKeyId())
  return [...new Set(ids)]
}

/** Syncthing's name for the loser of a conflict: `data.sync-conflict-<date>-<time>-<device>.json`. */
export const CONFLICT_COPY = /(^|\/)data\.sync-conflict-[^/]*\.json$/

export function pluginStoreHost(plugin: Plugin): StoreHost {
  const adapter = plugin.app.vault.adapter
  const dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/abele`

  return {
    keychain: () => plugin.app.secretStorage,
    read: () => AbeleConfig.getInstance().secretStore,
    write: async (file: SecretStoreFile | null) => {
      const config = AbeleConfig.getInstance()
      config.secretStore = file ?? undefined
      await config.saveSettings()
    },
    ids: pluginSecretIds,
    conflictCopies: async () => {
      const listed = await adapter.list(dir)
      const copies: unknown[] = []
      for (const path of listed.files.filter((file) => CONFLICT_COPY.test(file))) {
        try {
          const parsed = JSON.parse(await adapter.read(path)) as { secretStore?: unknown }
          if (parsed?.secretStore) copies.push(parsed.secretStore)
        } catch {
          // Not JSON, or gone between the listing and the read: nothing to merge from it.
        }
      }
      return copies
    },
    now: () => Date.now(),
  }
}

export const createPluginSecrets = (plugin: Plugin): SecretStore =>
  new SecretStore(pluginStoreHost(plugin))
