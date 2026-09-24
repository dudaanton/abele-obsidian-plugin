/**
 * The GitHub integration's shared state: the client for the configured server and token, and
 * the one road by which a URL becomes an open tab.
 */
import type { App, PaneType, WorkspaceLeaf } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { GithubClient } from './client'
import { checkAccess, parseRepoInput, type AccessReport } from './accessCheck'
import { endpoints, normaliseHost, parseGithubUrl, targetKey, type GithubTarget } from './urls'
import { DEFAULT_GITHUB_SETTINGS, type GithubSettings } from './settings'

export const GITHUB_VIEW_TYPE = 'abele-github'

export const githubSettings = (): GithubSettings =>
  AbeleConfig.getInstance().github ?? DEFAULT_GITHUB_SETTINGS

/** github.com always; an Enterprise host besides it when one is configured. */
export function githubHosts(): string[] {
  const { webHost } = endpoints(githubSettings().server)
  return webHost === 'github.com' ? ['github.com'] : ['github.com', webHost]
}

export const parseForSettings = (url: string): GithubTarget | null =>
  parseGithubUrl(url, githubHosts())

/** One client per server and token, so the ETag cache survives between tabs. */
const clients = new Map<string, GithubClient>()

/**
 * The client for a target's host. A link to github.com while an Enterprise server is configured
 * is read from github.com without the Enterprise token — a token belongs to one server.
 */
export function githubClient(host?: string): GithubClient {
  const settings = githubSettings()
  const configured = endpoints(settings.server)
  const useConfigured = !host || normaliseHost(host) === configured.webHost
  const ends = useConfigured ? configured : endpoints('')

  const { app } = GlobalStore.getInstance()
  const stored = settings.keyId ? (app.secretStorage.getSecret(settings.keyId) ?? '').trim() : ''
  const token = useConfigured ? stored : ''
  const noTokenReason =
    stored && !useConfigured
      ? `the token is set for ${configured.webHost} (the Server setting), and this is on ${normaliseHost(host ?? '')}.`
      : !stored && settings.keyId
        ? 'a token is set, but the keychain on this device has nothing under it. Paste the token again in Abele settings → GitHub.'
        : undefined

  const key = `${ends.api}\n${token}\n${noTokenReason ?? ''}`
  let client = clients.get(key)
  if (!client) {
    client = new GithubClient(ends, token, undefined, noTokenReason)
    clients.set(key, client)
  }
  return client
}

/**
 * "Check access" for the settings: the client a tab for that repository would use — the same
 * host rule, the same token — tried against it, or only the token when no repository is given.
 */
export function checkGithubAccess(repoInput: string): Promise<AccessReport> {
  const settings = githubSettings()
  const tokenHost = endpoints(settings.server).webHost
  const text = repoInput.trim()
  const repo = text ? parseRepoInput(text, tokenHost) : null
  if (text && !repo) {
    return Promise.reject(
      new Error(`"${text}" is not a repository. Give owner/name, or any link into the repository.`)
    )
  }
  if (repo && !githubHosts().includes(normaliseHost(repo.host))) {
    return Promise.reject(
      new Error(
        `${repo.host} is neither github.com nor the server set above, so nothing here reads it.`
      )
    )
  }
  return checkAccess({
    client: githubClient(repo?.host),
    repo,
    tokenConfigured: !!settings.keyId,
    tokenHost,
  })
}

/** Forgets every cached answer — for a token that was just replaced, say. */
export function resetGithubClients(): void {
  clients.clear()
}

interface KeyedView {
  targetKey?(): string | null
  getViewType?(): string
}

/** Internals the typings leave out: when a leaf was last focused, and whether it is pinned. */
interface LeafInternals {
  activeTime?: number
  pinned?: boolean
}

const isGithubLeaf = (leaf: WorkspaceLeaf | null | undefined): leaf is WorkspaceLeaf =>
  (leaf?.view as unknown as KeyedView | undefined)?.getViewType?.() === GITHUB_VIEW_TYPE

/** The GitHub tab focused last, as `active-leaf-change` reports it. */
let lastGithubLeaf: WorkspaceLeaf | null = null

/** The GitHub tab used last — the one a plain link would land in. */
export const lastUsedGithubLeaf = (): WorkspaceLeaf | null => lastGithubLeaf

/** Called on every `active-leaf-change`: remembers the leaf when it is a GitHub tab. */
export function noteActiveLeaf(leaf: WorkspaceLeaf | null): void {
  if (isGithubLeaf(leaf)) lastGithubLeaf = leaf
}

/**
 * The GitHub tab a plain click navigates: the one focused last, so that in a split the links
 * keep landing in the same pane. A pinned tab is left showing what it shows.
 */
function reusableLeaf(leaves: WorkspaceLeaf[]): WorkspaceLeaf | null {
  const open = leaves.filter((l) => !(l as unknown as LeafInternals).pinned)
  if (open.length === 0) return null
  if (lastGithubLeaf && open.includes(lastGithubLeaf)) return lastGithubLeaf
  const time = (l: WorkspaceLeaf) => (l as unknown as LeafInternals).activeTime ?? 0
  return open.reduce((best, l) => (time(l) > time(best) ? l : best))
}

/**
 * Opens a GitHub URL in a tab.
 *
 * With no `pane` — a plain click, the menu item, the command — the tab already showing that
 * item comes forward and moves to the new line or comment; failing that the GitHub tab used
 * last is pointed at the link, the way a browser tab follows a link (its back arrow returns);
 * only when there is no GitHub tab is a new one opened. A `pane` — what `Keymap.isModEvent`
 * makes of a Mod-click — always opens a new tab, split or window.
 *
 * @returns false when the URL is not one a GitHub tab can show
 */
export async function openGithubUrl(
  app: App,
  url: string,
  pane: PaneType | false = false
): Promise<boolean> {
  const target = parseForSettings(url)
  if (!target) return false
  const key = targetKey(target)

  let leaf: WorkspaceLeaf
  if (pane) {
    leaf = app.workspace.getLeaf(pane)
  } else {
    const leaves = app.workspace.getLeavesOfType(GITHUB_VIEW_TYPE)
    const same = leaves.find((l) => (l.view as unknown as KeyedView).targetKey?.() === key)
    leaf = same ?? reusableLeaf(leaves) ?? app.workspace.getLeaf('tab')
  }
  await leaf.setViewState({ type: GITHUB_VIEW_TYPE, state: { url }, active: true })
  await app.workspace.revealLeaf(leaf)
  lastGithubLeaf = leaf
  return true
}
