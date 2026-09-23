/** The GitHub integration's settings, kept under `github` in the plugin's settings. */
export interface GithubSettings {
  /** The whole feature. Off: no link is intercepted and no command does anything. */
  enabled: boolean
  /**
   * The keychain id the token is stored under — the id, never the token. Named `keyId` so the
   * agent's settings tools treat it as a secret and neither read nor write it.
   */
  keyId: string
  /** An Enterprise Server's address. Empty is github.com. */
  server: string
  /** Clicking a supported GitHub link in a note opens it in a tab here, not in the browser. */
  openLinks: boolean
}

export const GITHUB_TOKEN_KEY_ID = 'abele-github-token'

export const DEFAULT_GITHUB_SETTINGS: GithubSettings = {
  enabled: false,
  keyId: '',
  server: '',
  openLinks: true,
}

export const githubSettingsFrom = (stored?: Partial<GithubSettings>): GithubSettings => ({
  ...DEFAULT_GITHUB_SETTINGS,
  ...(stored ?? {}),
})
