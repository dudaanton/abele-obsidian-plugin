/** The GitHub integration's settings, kept under `github` in the plugin's settings. */
import { normalizeConnections, projectLegacy, validConnectionServer, type GithubConnection } from './connections'
export interface GithubSettings {
  /** The whole feature. Off: no link is intercepted and no command does anything. */
  enabled: boolean
  /**
   * The keychain id the token is stored under — the id, never the token. Named `keyId` so the
   * agent's settings tools treat it as a secret and neither read nor write it.
   */
  keyId: string
  /** Connection list (an explicitly empty list prevents legacy credential resurrection). */
  connections: GithubConnection[]
  /** Server retained for projecting one connection to older plugin versions. */
  legacyServer?: string
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
  /**
   * How a markdown file opens: rendered — a link to its lines marks the blocks holding them — or
   * as its source. The switch in the tab overrides it for that tab.
   */
  markdownView: 'preview' | 'code'
  /**
   * The repositories pinned to the top of "Open GitHub repository…", in the order pinned. Each
   * is its address, which names its server; an object, so that the connection it is read with
   * can be added beside the address later.
   */
  pinnedRepos: PinnedRepo[]
  /**
   * What the notifications panel alone reads with. GitHub serves notifications only to a classic
   * token, so a fine-grained main token needs a classic one beside it; with no `keyId` here —
   * or nothing under it on this device — the panel reads with the main token. An object, whose
   * field is named `keyId` so the agent's settings tools treat it as a secret, and so that it can
   * become a connection of its own later.
   */
  notifications: { keyId: string; boundKeyId?: string; boundServer?: string }
}

export interface PinnedRepo {
  /** `https://<host>/<owner>/<repo>`. */
  url: string
}

export const GITHUB_TOKEN_KEY_ID = 'abele-github-token'
export const GITHUB_NOTIFICATIONS_TOKEN_KEY_ID = 'abele-github-notifications-token'

export const DEFAULT_GITHUB_SETTINGS: GithubSettings = {
  enabled: false,
  keyId: '',
  connections: [],
  server: '',
  openLinks: true,
  searchLimitMb: 100,
  defaultRepo: '',
  userDisplay: 'name',
  pageWidth: 'custom',
  pageWidthPx: 1000,
  markdownView: 'preview',
  pinnedRepos: [],
  notifications: { keyId: '' },
}

const stringSetting = (value: unknown): string => typeof value==='string' ? value : ''
const serverSetting = (value: unknown): string | null => {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string') return null
  const address=value.trim()
  return !address || validConnectionServer(address) ? address : null
}
function notificationsFrom(stored: Partial<GithubSettings> | undefined): GithubSettings['notifications'] {
  const raw=stored?.notifications
  const keyId=stringSetting(raw?.keyId), boundKeyId=stringSetting(raw?.boundKeyId) || keyId
  if (!boundKeyId) return {keyId:''}
  const boundServer=serverSetting(raw?.boundServer === undefined ? stored?.server : raw.boundServer)
  // An unreadable binding is unavailable, not permission to send its token to github.com.
  return boundServer === null ? {keyId:''} : {keyId,boundKeyId,boundServer}
}

export const githubSettingsFrom = (stored?: Partial<GithubSettings>): GithubSettings =>
  projectLegacy({
    ...DEFAULT_GITHUB_SETTINGS,
    ...(stored ?? {}),
    server: serverSetting(stored?.server) ?? '',
    keyId: stringSetting(stored?.keyId),
    legacyServer: typeof stored?.legacyServer==='string' ? stored.legacyServer : undefined,
    defaultRepo: stringSetting(stored?.defaultRepo),
    connections: normalizeConnections(stored?.connections, stored ?? {}),
    // A settings file from before pinning, or one edited by hand, holds nothing usable here.
    pinnedRepos: Array.isArray(stored?.pinnedRepos)
      ? stored.pinnedRepos.filter((p): p is PinnedRepo => typeof p?.url === 'string')
      : [],
    notifications: notificationsFrom(stored),
  })
