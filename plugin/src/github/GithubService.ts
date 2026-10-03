/**
 * The GitHub integration's shared state: the client for the configured server and token, and
 * the one road by which a URL becomes an open tab.
 */
import { secrets } from '@/secrets/SecretStore'
import { watch } from 'vue'
import { ConnectionClients } from './connectionClients'
import { ConnectionMemory, routeConnections, type ConnectionCandidate } from './connectionRouting'
import type { GithubViewModel } from './model'
import type { App, PaneType, WorkspaceLeaf } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GithubClient } from './client'
import { checkAccess, parseRepoInput, type AccessReport } from './accessCheck'
import {
  endpoints,
  normaliseHost,
  parseGithubUrl,
  targetKey,
  type Endpoints,
  type GithubTarget,
} from './urls'
import { DEFAULT_GITHUB_SETTINGS, type GithubSettings } from './settings'
import { forgetRepoTrees } from './tree/repoTree'
import { forgetCodeIndexes } from './search/source'
import { rememberRepo } from './open/repoList'

export const GITHUB_VIEW_TYPE = 'abele-github'

export const githubSettings = (): GithubSettings =>
  AbeleConfig.getInstance().github ?? DEFAULT_GITHUB_SETTINGS

let connectionClients: ConnectionClients | undefined

/** Explicit connection access; legacy callers deliberately keep their single-server facade. */
export function connectionClient(id: string): GithubClient {
  if (!connectionClients) {
    connectionClients = new ConnectionClients(
      () => githubSettings().connections ?? [],
      (keyId) => (keyId ? (secrets().get(keyId) ?? '') : ''),
      () => secrets().status.value,
      undefined,
      forgetCodeIndexes
    )
    watch(
      [AbeleConfig.getInstance().version, secrets().version, secrets().status],
      () => connectionClients?.reconcile(),
      { flush: 'sync' }
    )
  }
  return connectionClients.client(id)
}

/** github.com always; an Enterprise host besides it when one is configured. */
export function githubHosts(): string[] {
  const settings = githubSettings()
  return [
    ...new Set([
      'github.com',
      endpoints(settings.server).webHost,
      ...(settings.connections ?? []).map((c) => endpoints(c.server).webHost),
    ]),
  ]
}

export const parseForSettings = (url: string): GithubTarget | null => {
  const target = parseGithubUrl(url, githubHosts())
  if (!target) return null
  const parsed = new URL(url)
  if (parsed.username || parsed.password) return null
  const origin = parsed.origin
  // Preserve noncanonical origins too, so routing refuses a wrong public scheme/port.
  if (target.host !== 'github.com' || parsed.protocol !== 'https:' || parsed.port)
    target.origin = origin
  const rows = githubSettings().connections ?? []
  if (rows.length && !routeConnections(rows, target).length) return null
  return target
}

export const routingMemory = new ConnectionMemory()
export const connectionGeneration = (id: string): string => {
  try {
    return id ? connectionClient(id).cacheNamespace : githubClient('github.com').cacheNamespace
  } catch {
    return ''
  }
}
export function resolveConnectionCandidates(
  target: GithubTarget,
  options: {
    sourceId?: string
    openId?: string
    explicitId?: string
    allowedIds?: string[]
  } = {}
): ConnectionCandidate[] {
  const settings = githubSettings()
  const rows = settings.connections ?? []
  const repo = `${target.origin ?? `https://${target.host}`}/${target.owner}/${target.repo}`
  return routeConnections(rows, {
    ...target,
    ...options,
    rememberedId: routingMemory.success(repo, connectionGeneration),
    allowed: options.allowedIds ? (c) => options.allowedIds!.includes(c.id) : undefined,
  })
}

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

  const stored = settings.keyId ? (secrets().get(settings.keyId) ?? '').trim() : ''
  const token = useConfigured ? stored : ''
  const noTokenReason =
    stored && !useConfigured
      ? `the token is set for ${configured.webHost} (the Server setting), and this is on ${normaliseHost(host ?? '')}.`
      : !stored && settings.keyId
        ? 'a token is set, but the keychain on this device has nothing under it. Paste the token again in Abele settings → GitHub, or, if keys are synced, unlock them in Abele settings → Transfer → Synced keys.'
        : undefined

  return cachedClient(ends, token, noTokenReason)
}

function cachedClient(ends: Endpoints, token: string, noTokenReason?: string): GithubClient {
  const key = `${ends.api}\n${token}\n${noTokenReason ?? ''}`
  let client = clients.get(key)
  if (!client) {
    // A legacy credential changed on this server: stop old loads as well as forgetting text.
    for (const [oldKey, oldClient] of clients) {
      if (oldKey.startsWith(`${ends.api}\n`)) {
        oldClient.retire()
        clients.delete(oldKey)
        forgetCodeIndexes()
      }
    }
    client = new GithubClient(ends, token, undefined, noTokenReason)
    clients.set(key, client)
  }
  return client
}

/**
 * The client the notifications panel reads with: the notifications token when one is set and
 * this device's keychain holds it — GitHub serves notifications only to a classic token, and a
 * fine-grained main token needs one beside it — else the main token's client. `separate` says
 * which, for a refusal to name the right field.
 */
const notificationClients = new ConnectionClients(
  () => {
    const settings=githubSettings(), keyId=settings.notifications?.boundKeyId ?? settings.notifications?.keyId
    return keyId ? [{id:'notifications',name:'GitHub notifications',server:settings.notifications?.boundServer ?? settings.server,
      keyId,owners:[] as string[],isDefault:true}] : []
  },
  keyId=>secrets().get(keyId) ?? '',
  ()=>secrets().status.value
)

export function notificationsClient(): { client: GithubClient; separate: boolean } {
  const settings = githubSettings()
  const keyId = settings.notifications?.boundKeyId ?? settings.notifications?.keyId
  const token = keyId ? (secrets().get(keyId) ?? '').trim() : ''
  notificationClients.reconcile()
  if (!token) {
    const main=settings.connections?.find(c=>c.isDefault && endpoints(c.server).origin===endpoints(settings.server).origin)
    return {client:main ? connectionClient(main.id) : githubClient(),separate:false}
  }
  return {client:notificationClients.client('notifications'),separate:true}
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
  for (const client of clients.values()) client.retire()
  clients.clear()
  connectionClients?.reconcile()
  notificationClients.reconcile()
  forgetRepoTrees()
  forgetCodeIndexes()
}

interface KeyedView {
  model?: GithubViewModel
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
  pane: PaneType | false = false,
  context: {
    sourceId?: string
    sourceIntent?: 'manual' | 'automatic'
    connectionId?: string
    manual?: boolean
    allowedIds?: string[]
    agentId?: string
    approvedConnections?: Record<string, string>
  } = {}
): Promise<boolean> {
  const target = parseForSettings(url)
  if (!target) return false
  const key = targetKey(target)
  const matching = app.workspace
    .getLeavesOfType(GITHUB_VIEW_TYPE)
    .map((l) => (l.view as unknown as KeyedView).model)
    .find(
      (m) =>
        m?.target?.host === target.host &&
        m?.target?.owner === target.owner &&
        m?.target?.repo === target.repo
    )
  const chosen = resolveConnectionCandidates(target, {
    sourceId: context.sourceId,
    openId: matching?.connectionId,
    explicitId: context.connectionId,
    allowedIds: context.allowedIds,
  })[0]
  // Legacy fixtures and callers without a configured connection still read public GitHub.
  if (!chosen && (githubSettings().connections ?? []).length) return false

  let leaf: WorkspaceLeaf
  if (pane) {
    leaf = app.workspace.getLeaf(pane)
  } else {
    const leaves = app.workspace.getLeavesOfType(GITHUB_VIEW_TYPE)
    const same = leaves.find((l) => (l.view as unknown as KeyedView).targetKey?.() === key)
    leaf = same ?? reusableLeaf(leaves) ?? app.workspace.getLeaf('tab')
  }
  await leaf.setViewState({
    type: GITHUB_VIEW_TYPE,
    state: {
      url,
      ...(chosen?.id
        ? {
            connectionId: chosen.id,
            connectionIntent:
              context.manual ||
              (context.sourceId === chosen.id && context.sourceIntent === 'manual')
                ? 'manual'
                : 'automatic',
          }
        : {}),
      ...(context.allowedIds
        ? {
            allowedConnections: context.allowedIds,
            executionAgentId: context.agentId,
            approvedConnections: context.approvedConnections,
          }
        : {}),
    },
    active: true,
  })
  await app.workspace.revealLeaf(leaf)
  lastGithubLeaf = leaf
  // Offered first among the recent ones by "Open GitHub repository…" on this device.
  if (app.saveLocalStorage) rememberRepo(app, target)
  return true
}
