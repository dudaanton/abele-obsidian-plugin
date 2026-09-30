/**
 * The notifications of the account the token belongs to: listed, marked read or done on GitHub.
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
  /** Known limitations reported by the successful response, not an authentication error. */
  accessHint: string
}

export interface InboxPage {
  items: GithubNotification[]
  /** Seconds until GitHub would like to be asked again. */
  pollSeconds: number
  /** More than the pages read: the list stops short of what GitHub has. */
  truncated: boolean
  accessHint: string
}

/** Do not infer scopes when GitHub did not report them, or demand broader access to read. */
function accessHint(headers: Record<string, string>): string {
  const hints: string[] = []
  const scopes = header(headers, 'x-oauth-scopes')
  if (scopes !== undefined && !scopes.split(',').some((s) => s.trim() === 'repo')) {
    hints.push(
      'This token has no repo scope. If private repository notifications are missing, check the token’s repository access. Organizations may also require SSO authorization or allow access only to approved tokens.'
    )
  }
  if (header(headers, 'x-github-sso')?.includes('partial-results')) {
    hints.push(
      'GitHub reports partial results: authorize this token for the missing organizations with Configure SSO on GitHub.'
    )
  }
  return hints.join(' ')
}

/** Where a classic token is made, and what to tick. */
const MAKE_CLASSIC =
  'GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic), with the notifications scope (or repo, which covers it)'

/** Where it goes: its own field, so the main token keeps serving everything else. */
const FIELD = 'Abele settings → GitHub → Notifications token'

/**
 * A refusal of the notifications, said for the notifications: GitHub lets only a classic personal
 * access token read them, with the `notifications` or `repo` scope, and a fine-grained token is
 * refused whatever it is given. The generic words ("lacks that permission") would send the person
 * looking for a permission that does not exist.
 *
 * `separate` says the panel read with its own notifications token rather than the main one, so
 * the words name the token that was refused and the field it is set in.
 */
export function notificationsRefusal(
  error: GithubError,
  tokenKind: string,
  headers: Record<string, string> = {},
  separate = false
): GithubError {
  const refused = error.status === 403 || error.status === 404
  const keep = { githubSaid: error.githubSaid, needed: error.needed }
  const addOne = `Make a classic token (${MAKE_CLASSIC}) and set it in ${FIELD}: only the notifications read with it, and everything else keeps using the main token.`
  const replace = `Make a new classic token (${MAKE_CLASSIC}) and set it in ${FIELD} in place of this one.`
  let refusal: Refusal | null = null
  if (error.status === 401 && tokenKind === 'none') {
    refusal = {
      ...keep,
      kind: 'auth',
      reason: 'GitHub shows notifications only to a request with a token.',
      fix: addOne,
    }
  } else if (error.status === 401 && separate) {
    refusal = {
      ...keep,
      kind: 'auth',
      reason:
        'GitHub did not accept the notifications token. It may be mistyped, expired or revoked.',
      fix: replace,
    }
  } else if (refused && (tokenKind === 'fine-grained' || tokenKind === 'app')) {
    const what = tokenKind === 'app' ? 'an app token' : 'a fine-grained one'
    refusal = {
      ...keep,
      kind: 'forbidden',
      reason: separate
        ? `The notifications token is ${what}, and GitHub lets only a classic personal access token read notifications.`
        : tokenKind === 'app'
          ? 'GitHub does not let an app token read notifications.'
          : 'GitHub does not let a fine-grained token read notifications, whatever permissions it has: only a classic personal access token can.',
      fix: separate ? replace : addOne,
    }
  } else if (refused && error.kind !== 'rate-limit' && error.kind !== 'sso') {
    const has = header(headers, 'x-oauth-scopes')
    refusal = {
      ...keep,
      kind: 'forbidden',
      reason: `GitHub refused the notifications to ${separate ? 'the notifications token' : 'this token'}${
        has !== undefined ? ` (its scopes: ${has.trim() || 'none'})` : ''
      }. Reading them needs the notifications or the repo scope.`,
      fix: separate
        ? 'Edit the token on GitHub (Settings → Developer settings → Personal access tokens) and tick notifications — or repo.'
        : `Edit the token on GitHub (Settings → Developer settings → Personal access tokens) and tick notifications — or repo. Or, to leave it as it is: ${addOne}`,
    }
  }
  return refusal ? new GithubError(refusal.kind, refusal.reason, error.status, refusal) : error
}

export class NotificationInbox {
  private kept = new Map<Which, Kept>()
  private pending: Promise<void> = Promise.resolve()

  /** A slow list must not republish a thread after a successful write on this same inbox. */
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const turn = this.pending.then(run)
    this.pending = turn.then(
      (): void => undefined,
      (): void => undefined
    )
    return turn
  }

  /** A write changes both lists, possibly within Last-Modified's one-second precision. */
  private invalidateValidators() {
    for (const k of this.kept.values()) k.lastModified = undefined
  }

  constructor(
    private readonly client: GithubClient,
    /** Read with the notifications token rather than the main one. */
    private readonly separate = false
  ) {}

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
      probe.headers,
      this.separate
    )
  }

  /**
   * The notifications: unread ones, or every recent one. Asked for only when the poll interval
   * has passed or `force` says so, and asked conditionally, so an unchanged list is free.
   */
  load(which: Which, force = false): Promise<InboxPage> {
    return this.serial(() => this.loadNow(which, force))
  }

  private async loadNow(which: Which, force: boolean): Promise<InboxPage> {
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
      accessHint: accessHint(first.headers),
    }
    this.kept.set(which, fresh)
    return this.page(fresh)
  }

  private page(k: Kept): InboxPage {
    return {
      items: k.items,
      pollSeconds: k.pollSeconds,
      truncated: k.truncated,
      accessHint: k.accessHint,
    }
  }

  /** Marks what is kept read, in every list, without asking GitHub. */
  private markKept(read: (n: GithubNotification) => boolean) {
    for (const k of this.kept.values()) {
      k.items = k.items.map((n) => (n.unread && read(n) ? { ...n, unread: false } : n))
    }
  }

  /** Done removes a thread from GitHub's inbox; Read only removes its unread emphasis. */
  markDone(id: string): Promise<void> {
    return this.serial(() => this.markDoneNow(id))
  }

  private async markDoneNow(id: string): Promise<void> {
    const answer = await this.client.call(
      'DELETE',
      `/notifications/threads/${encodeURIComponent(id)}`,
      { what: 'marking the notification done' }
    )
    // Unlike Read, Done has only one documented successful status; 304 is not a deletion.
    if (answer.error || answer.status !== 204) this.refuse(answer)
    for (const k of this.kept.values()) k.items = k.items.filter((n) => n.id !== id)
    this.invalidateValidators()
  }

  /** Marks one thread read on GitHub — `PATCH /notifications/threads/{id}`. */
  markRead(id: string): Promise<void> {
    return this.serial(() => this.markReadNow(id))
  }

  private async markReadNow(id: string): Promise<void> {
    const answer = await this.client.call(
      'PATCH',
      `/notifications/threads/${encodeURIComponent(id)}`,
      { what: 'marking the notification read' }
    )
    if (answer.error) this.refuse(answer)
    this.markKept((n) => n.id === id)
    this.invalidateValidators()
  }

  /**
   * Marks everything read on GitHub — or everything of one repository, `owner/name` — up to the
   * moment the list was read: `PUT /notifications` (`/repos/{owner}/{repo}/notifications`) with
   * `last_read_at`, so one that arrived since is not swallowed unseen. GitHub may answer 202: it
   * has taken the request and marks them in a while.
   */
  markAllRead(which: Which, repo = ''): Promise<void> {
    return this.serial(() => this.markAllReadNow(which, repo))
  }

  private async markAllReadNow(which: Which, repo: string): Promise<void> {
    const listedAt = this.kept.get(which)?.listedAt ?? new Date().toISOString()
    const path = repo
      ? `/repos/${repo.split('/').map(encodeURIComponent).join('/')}/notifications`
      : '/notifications'
    const answer = await this.client.call('PUT', path, {
      what: 'marking the notifications read',
      // Do not force all notifications read: last_read_at must protect later activity.
      body: { last_read_at: listedAt },
    })
    if (answer.error) this.refuse(answer)
    this.markKept(
      (n) => (!repo || n.repo === repo) && Date.parse(n.updatedAt) <= Date.parse(listedAt)
    )
    this.invalidateValidators()
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

/**
 * The inbox of a client: one per server and token, kept while the client is. `separate`: the
 * client carries the notifications token, not the main one.
 */
export function inboxFor(client: GithubClient, separate = false): NotificationInbox {
  let inbox = inboxes.get(client)
  if (!inbox) {
    inbox = new NotificationInbox(client, separate)
    inboxes.set(client, inbox)
  }
  return inbox
}
