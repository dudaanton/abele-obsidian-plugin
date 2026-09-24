/**
 * The GitHub integration's shared state: the client for the configured server and token, and
 * the one road by which a URL becomes an open tab.
 */
import type { App } from 'obsidian'
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
  targetKey(): string | null
}

/**
 * Opens a GitHub URL in a tab of its own, or brings forward the tab already showing that item
 * and points it at the new line or comment.
 *
 * @returns false when the URL is not one a GitHub tab can show
 */
export async function openGithubUrl(app: App, url: string): Promise<boolean> {
  const target = parseForSettings(url)
  if (!target) return false
  const key = targetKey(target)

  const existing = app.workspace
    .getLeavesOfType(GITHUB_VIEW_TYPE)
    .find((leaf) => (leaf.view as unknown as KeyedView).targetKey?.() === key)

  const leaf = existing ?? app.workspace.getLeaf('tab')
  await leaf.setViewState({ type: GITHUB_VIEW_TYPE, state: { url }, active: true })
  await app.workspace.revealLeaf(leaf)
  return true
}
