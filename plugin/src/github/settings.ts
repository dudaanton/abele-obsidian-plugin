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
  /**
   * The largest repository, in megabytes of files at the commit, that a code search or a
   * definition lookup downloads whole. Past it, GitHub's own code search is asked instead.
   */
  searchLimitMb: number
  /**
   * The repository `#123` or a title means in the "Open on GitHub" picker when no GitHub tab
   * says otherwise: `owner/repo` or a link into it. Empty: only what the tabs say.
   */
  defaultRepo: string
  /**
   * What a person in a tab is shown by: the name on their profile, or their login. The other is
   * in the tooltip, and a click on the person swaps the two in place.
   */
  userDisplay: 'name' | 'login'
  /**
   * How wide a tab's text runs — conversations, rendered markdown, folder pages: the notes'
   * readable line width, `pageWidthPx`, or the whole pane. Diffs and code always take the pane.
   */
  pageWidth: 'readable' | 'custom' | 'full'
  /** The width in pixels when `pageWidth` is `custom`. */
  pageWidthPx: number
}

export const GITHUB_TOKEN_KEY_ID = 'abele-github-token'

export const DEFAULT_GITHUB_SETTINGS: GithubSettings = {
  enabled: false,
  keyId: '',
  server: '',
  openLinks: true,
  searchLimitMb: 100,
  defaultRepo: '',
  userDisplay: 'name',
  pageWidth: 'custom',
  pageWidthPx: 1000,
}

export const githubSettingsFrom = (stored?: Partial<GithubSettings>): GithubSettings => ({
  ...DEFAULT_GITHUB_SETTINGS,
  ...(stored ?? {}),
})
