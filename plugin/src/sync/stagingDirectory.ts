/** Private work files share the vault filesystem, but never a user content directory. */
export function stagingDirectory(configDir?: string): string {
  // Standalone adapters have no Vault. Vault compositions always supply their configDir.
  return configDir ? `${configDir}/plugins/abele/sync-staging` : '.abele-sync-work'
}
