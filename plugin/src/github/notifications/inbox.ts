/**
 * The notifications of the account the token belongs to: read, kept, and marked read on GitHub.
 *
 * GitHub asks that notifications be polled gently. Every answer carries `X-Poll-Interval` — the
 * seconds to wait before asking again — and `Last-Modified`, which goes back as
 * `If-Modified-Since`: when nothing has changed GitHub answers 304, with nothing in it, and does
 * not count the request against the hourly limit. So a list is asked for again only once its
 * interval has passed, unless the person asks; and even then an unchanged list costs nothing.
 *
 * One inbox per client: the client is per server and token, so a new token starts afresh.
 */
import { GithubError, type GithubClient, type Probe } from '../client'
import { header, type Refusal } from '../refusal'
import {
  destination,
  discussionSearchUrl,
  parseNotifications,
  type Destination,
  type GithubNotification,
} from './model'

/** GitHub's page size for notifications is at most 50. */
const PER_PAGE = 50
/** 200 notifications is past anything worth scrolling in a sidebar. */
const MAX_PAGES = 4
/** What GitHub asks for when it says nothing — its documented default. */
const DEFAULT_POLL_SECONDS = 60

export type Which = 'unread' | 'all'

/** What the panel shows: which list, and one repository of it or all. */
export interface NotificationsState {
  which: Which
  /** `owner/name`, or empty for every repository. */
  repo: string
}

interface Kept {
  items: GithubNotification[]
  lastModified?: string
  /** When the list was last asked for, ms. */
  askedAt: number
  /** When GitHub last answered with a list, ISO: what "mark all as read" reads up to. */
  listedAt: string
  pollSeconds: number
  truncated: boolean
}

export interface InboxPage {
  items: GithubNotification[]
  /** Seconds until GitHub would like to be asked again. */
  pollSeconds: number
  /** More than the pages read: the list stops short of what GitHub has. */
  truncated: boolean
}

const TOKEN_SETTINGS =
  "GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic), and tick notifications (or repo, which covers it and everything else Abele reads). Then set it in Abele settings → GitHub; a classic token with repo reads the rest of GitHub here too, so it can take the fine-grained one's place."

/**
 * A refusal of the notifications, said for the notifications: GitHub lets only a classic personal
 * access token read them, with the `notifications` or `repo` scope, and a fine-grained token is
 * refused whatever it is given. The generic words ("lacks that permission") would send the person
 * looking for a permission that does not exist.
 */
export function notificationsRefusal(
  error: GithubError,
  tokenKind: string,
  headers: Record<string, string> = {}
): GithubError {
  const refused = error.status === 403 || error.status === 404
  const keep = { githubSaid: error.githubSaid, needed: error.needed }
  let refusal: Refusal | null = null
  if (error.status === 401 && tokenKind === 'none') {
    refusal = {
      ...keep,
      kind: 'auth',
      reason: 'GitHub shows notifications only to a request with a token.',
      fix: `Make a classic personal access token: ${TOKEN_SETTINGS}`,
    }
  } else if (refused && (tokenKind === 'fine-grained' || tokenKind === 'app')) {
    refusal = {
      ...keep,
      kind: 'forbidden',
      reason:
        tokenKind === 'app'
          ? 'GitHub does not let an app token read notifications.'
          : 'GitHub does not let a fine-grained token read notifications, whatever permissions it has: only a classic personal access token can.',
      fix: `Make a classic one: ${TOKEN_SETTINGS}`,
    }
  } else if (refused && error.kind !== 'rate-limit' && error.kind !== 'sso') {
    const has = header(headers, 'x-oauth-scopes')
    refusal = {
      ...keep,
      kind: 'forbidden',
      reason: `GitHub refused the notifications to this token${
        has !== undefined ? ` (its scopes: ${has.trim() || 'none'})` : ''
      }. Reading them needs the notifications or the repo scope.`,
      fix: 'Edit the token on GitHub (Settings → Developer settings → Personal access tokens) and tick notifications — or repo. A fine-grained token cannot read notifications at all.',
    }
  }
  return refusal ? new GithubError(refusal.kind, refusal.reason, error.status, refusal) : error
}

export class NotificationInbox {
  private kept = new Map<Which, Kept>()

  constructor(private readonly client: GithubClient) {}

  /** The notifications as last read, without asking. */
  cached(which: Which): GithubNotification[] | null {
    return this.kept.get(which)?.items ?? null
  }

  /** Seconds left before GitHub would like to be asked again; 0 when it may be asked now. */
  waitSeconds(which: Which, now = Date.now()): number {
    const k = this.kept.get(which)
    if (!k) return 0
    return Math.max(0, Math.ceil((k.askedAt + k.pollSeconds * 1000 - now) / 1000))
  }

  private refuse(probe: Probe): never {
    throw notificationsRefusal(
      probe.error ?? new GithubError('other', `GitHub answered ${probe.status}.`, probe.status),
      this.client.tokenInfo.kind,
      probe.headers
    )
  }

  /**
   * The notifications: unread ones, or every recent one. Asked for only when the poll interval
   * has passed or `force` says so, and asked conditionally, so an unchanged list is free.
   */
  async load(which: Which, force = false): Promise<InboxPage> {
    const kept = this.kept.get(which)
    const now = Date.now()
    if (kept && !force && this.waitSeconds(which, now) > 0) return this.page(kept)

    if (!this.client.hasToken) {
      this.refuse({
        status: 401,
        headers: {},
        body: null,
        error: new GithubError('auth', 'No token.', 401),
      })
    }

    const base = `/notifications?all=${which === 'all'}&per_page=${PER_PAGE}`
    const first = await this.client.call<unknown>('GET', `${base}&page=1`, {
      what: 'the notifications',
      headers: kept?.lastModified ? { 'If-Modified-Since': kept.lastModified } : {},
    })
    if (first.error) this.refuse(first)

    const poll = Number(header(first.headers, 'x-poll-interval'))
    const pollSeconds = Number.isFinite(poll) && poll > 0 ? poll : DEFAULT_POLL_SECONDS

    if (first.status === 304 && kept) {
      kept.askedAt = now
      kept.pollSeconds = pollSeconds
      // Read here since the list came: an unread list asked for again leaves them out.
      if (which === 'unread') kept.items = kept.items.filter((n) => n.unread)
      return this.page(kept)
    }

    const items = parseNotifications(first.body)
    let batch = Array.isArray(first.body) ? first.body.length : 0
    let truncated = false
    for (let page = 2; batch === PER_PAGE; page++) {
      if (page > MAX_PAGES) {
        truncated = true
        break
      }
      const next = await this.client.call<unknown>('GET', `${base}&page=${page}`, {
        what: 'the notifications',
      })
      if (next.error) this.refuse(next)
      items.push(...parseNotifications(next.body))
      batch = Array.isArray(next.body) ? next.body.length : 0
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    const fresh: Kept = {
      items,
      lastModified: header(first.headers, 'last-modified'),
      askedAt: now,
      listedAt: new Date(now).toISOString(),
      pollSeconds,
      truncated,
    }
    this.kept.set(which, fresh)
    return this.page(fresh)
  }

  private page(k: Kept): InboxPage {
    return { items: k.items, pollSeconds: k.pollSeconds, truncated: k.truncated }
  }

  /** Marks what is kept read, in every list, without asking GitHub. */
  private markKept(read: (n: GithubNotification) => boolean) {
    for (const k of this.kept.values()) {
      k.items = k.items.map((n) => (n.unread && read(n) ? { ...n, unread: false } : n))
    }
  }

  /** Marks one thread read on GitHub — `PATCH /notifications/threads/{id}`. */
  async markRead(id: string): Promise<void> {
    const answer = await this.client.call(
      'PATCH',
      `/notifications/threads/${encodeURIComponent(id)}`,
      { what: 'marking the notification read' }
    )
    if (answer.error) this.refuse(answer)
    this.markKept((n) => n.id === id)
  }

  /**
   * Marks everything read on GitHub — or everything of one repository, `owner/name` — up to the
   * moment the list was read: `PUT /notifications` (`/repos/{owner}/{repo}/notifications`) with
   * `last_read_at`, so one that arrived since is not swallowed unseen. GitHub may answer 202: it
   * has taken the request and marks them in a while.
   */
  async markAllRead(which: Which, repo = ''): Promise<void> {
    const listedAt = this.kept.get(which)?.listedAt ?? new Date().toISOString()
    const path = repo
      ? `/repos/${repo.split('/').map(encodeURIComponent).join('/')}/notifications`
      : '/notifications'
    const answer = await this.client.call('PUT', path, {
      what: 'marking the notifications read',
      body: { last_read_at: listedAt, read: true },
    })
    if (answer.error) this.refuse(answer)
    this.markKept((n) => (!repo || n.repo === repo) && n.updatedAt <= listedAt)
  }

  /**
   * The address clicking a notification opens, and whether a GitHub tab shows it (`tab`) or only
   * the browser does. A discussion is found by its title in the repository; a release is asked for
   * its page. A lookup that fails falls back to a page that still leads there.
   */
  async open(n: GithubNotification): Promise<{ url: string; tab: boolean }> {
    const d: Destination = destination(n, this.client.endpoints)
    if (d.kind === 'tab') return { url: d.url, tab: true }
    if (d.kind === 'browser') return { url: d.url, tab: false }
    if (d.kind === 'ask') {
      try {
        const release = await this.client.get<{ html_url?: string }>(d.apiUrl, {
          what: 'the release',
        })
        return { url: release.html_url || d.fallback, tab: false }
      } catch {
        return { url: d.fallback, tab: false }
      }
    }
    try {
      const number = await this.discussionNumber(n.repo, d.title)
      if (number) return { url: `${d.repoUrl}/discussions/${number}`, tab: true }
    } catch {
      // The search below is the way there when the lookup cannot be made.
    }
    return { url: discussionSearchUrl(d.repoUrl, d.title), tab: true }
  }

  /** The number of the repository's discussion with exactly this title, most recent first. */
  private async discussionNumber(repo: string, title: string): Promise<number | null> {
    const query = `query($q:String!){search(query:$q,type:DISCUSSION,first:10){nodes{... on Discussion{number title updatedAt}}}}`
    const quoted = title.replace(/"/g, ' ')
    const data = await this.client.graphql<{
      search: { nodes: ({ number?: number; title?: string; updatedAt?: string } | null)[] }
    }>(query, { q: `repo:${repo} in:title "${quoted}"` }, 'the discussion')
    const same = data.search.nodes
      .filter((d): d is { number: number; title: string; updatedAt?: string } => {
        return !!d && typeof d.number === 'number' && d.title === title
      })
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    return same[0]?.number ?? null
  }
}

const inboxes = new WeakMap<GithubClient, NotificationInbox>()

/** The inbox of a client: one per server and token, kept while the client is. */
export function inboxFor(client: GithubClient): NotificationInbox {
  let inbox = inboxes.get(client)
  if (!inbox) {
    inbox = new NotificationInbox(client)
    inboxes.set(client, inbox)
  }
  return inbox
}
