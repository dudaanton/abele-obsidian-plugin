import { t, currentLocale, relativeFormatter, dateFormatter } from '@/i18n'
/**
 * GitHub notifications as the Notifications API sends them, and where each one leads.
 *
 * A notification names its subject by an API address — `…/repos/o/r/pulls/7` — never by the
 * page a person reads, so the page is worked out from it: an issue, a pull request or a commit
 * opens in a GitHub tab, at the latest comment when the notification points at one. A discussion
 * has no address at all in a notification (GitHub leaves `subject.url` empty), so it is found by
 * its title; a release is asked for its page, which only the browser shows. Everything else —
 * a workflow run, a security alert, an invitation — goes to the matching page of the repository
 * on GitHub.
 */
import type { Endpoints } from '../urls'

export interface RawNotification {
  id: string
  unread: boolean
  reason: string
  updated_at: string
  last_read_at?: string | null
  subject: {
    title: string
    url: string | null
    latest_comment_url: string | null
    type: string
  }
  repository: {
    full_name: string
    html_url?: string
  }
}

export interface GithubNotification {
  /** The thread's id: what marking it read or done names. */
  id: string
  unread: boolean
  /** GitHub's own word for why it arrived: `mention`, `review_requested`… */
  reason: string
  updatedAt: string
  title: string
  /** GitHub's subject type: `Issue`, `PullRequest`, `Discussion`, `Release`… */
  type: string
  /** `owner/name`. */
  repo: string
  /** The subject's API address, when GitHub gives one. */
  apiUrl: string | null
  /** The latest comment's API address, when GitHub gives one. */
  commentApiUrl: string | null
}

export function parseNotification(raw: RawNotification): GithubNotification | null {
  if (!raw || typeof raw.id !== 'string' || !raw.subject || !raw.repository?.full_name) return null
  return {
    id: raw.id,
    unread: !!raw.unread,
    reason: raw.reason ?? '',
    updatedAt: raw.updated_at ?? '',
    title: raw.subject.title ?? '',
    type: raw.subject.type ?? '',
    repo: raw.repository.full_name,
    apiUrl: raw.subject.url || null,
    commentApiUrl: raw.subject.latest_comment_url || null,
  }
}

export const parseNotifications = (raw: unknown): GithubNotification[] =>
  Array.isArray(raw)
    ? raw
        .map((r) => parseNotification(r as RawNotification))
        .filter((n): n is GithubNotification => !!n)
    : []

const TYPES: Record<string, { label: string; icon: string }> = {
  Issue: {
    get label() {
      return t('streamB.issue.48dc76')
    },
    icon: 'circle-dot',
  },
  PullRequest: {
    get label() {
      return t('streamB.pullRequest.f3dba6')
    },
    icon: 'git-pull-request',
  },
  Discussion: {
    get label() {
      return t('streamB.discussion.5eb6cf')
    },
    icon: 'messages-square',
  },
  Release: {
    get label() {
      return t('streamB.release.e020e3')
    },
    icon: 'tag',
  },
  Commit: {
    get label() {
      return t('streamB.commit.82a9c4')
    },
    icon: 'git-commit-horizontal',
  },
  CheckSuite: {
    get label() {
      return t('streamB.checks.de07d0')
    },
    icon: 'circle-play',
  },
  WorkflowRun: {
    get label() {
      return t('streamB.workflowRun.d6d341')
    },
    icon: 'circle-play',
  },
  RepositoryInvitation: {
    get label() {
      return t('streamB.invitation.af4ea0')
    },
    icon: 'mail',
  },
  RepositoryVulnerabilityAlert: {
    get label() {
      return t('streamB.securityAlert.9ed298')
    },
    icon: 'shield-alert',
  },
  RepositoryDependabotAlertsThread: {
    get label() {
      return t('streamB.dependabotAlert.d39a6a')
    },
    icon: 'shield-alert',
  },
  SecurityAdvisory: {
    get label() {
      return t('streamB.securityAdvisory.6b4e06')
    },
    icon: 'shield-alert',
  },
}

/** The subject type in words and as a glyph; an unknown type is shown by its own name. */
export const subjectType = (type: string): { label: string; icon: string } =>
  TYPES[type] ?? {
    label: type.replace(/([a-z])([A-Z])/g, '$1 $2') || t('streamB.notification.7d31b8'),
    icon: 'bell',
  }

const REASONS: Record<string, string> = {
  get approval_requested() {
    return t('streamBMeta.8eae081635')
  },
  get assign() {
    return t('streamBMeta.2ebb929480')
  },
  get author() {
    return t('streamBMeta.6364858689')
  },
  get ci_activity() {
    return t('streamBMeta.e7fc4d67f0')
  },
  get comment() {
    return t('streamBMeta.c44bb2fd51')
  },
  get invitation() {
    return t('streamBMeta.a3013c082c')
  },
  get manual() {
    return t('streamBMeta.abc12f8d66')
  },
  get member_feature_requested() {
    return t('streamBMeta.25fe1eda04')
  },
  get mention() {
    return t('streamBMeta.51c55fa573')
  },
  get review_requested() {
    return t('streamBMeta.4e499f153c')
  },
  get security_advisory_credit() {
    return t('streamBMeta.139d04f1f0')
  },
  get security_alert() {
    return t('streamBMeta.145b4343be')
  },
  get state_change() {
    return t('streamBMeta.11c5448327')
  },
  get subscribed() {
    return t('streamBMeta.19bda4aa00')
  },
  get team_mention() {
    return t('streamBMeta.9f741ba611')
  },
}

/** Why the notification arrived, in words. */
export const reasonText = (reason: string): string => REASONS[reason] ?? reason.replace(/_/g, ' ')

/** Where clicking a notification leads. */
export type Destination =
  /** A page a GitHub tab shows. */
  | { kind: 'tab'; url: string }
  /** A discussion: its number is found by its title. `list` is the fallback, its search. */
  | { kind: 'discussion'; repoUrl: string; title: string }
  /** A page only GitHub shows, whose address the API has to be asked for — a release. */
  | { kind: 'ask'; apiUrl: string; fallback: string }
  /** A page only GitHub shows, whose address is known. */
  | { kind: 'browser'; url: string }

/**
 * The part of an API address under `repos/`: `o/r/issues/5`, split. Null for an address on
 * another server or outside `repos/`.
 */
function repoPath(apiUrl: string, ends: Endpoints): string[] | null {
  const prefix = `${ends.api}/repos/`
  if (!apiUrl.startsWith(prefix)) return null
  const path = apiUrl.slice(prefix.length).split(/[?#]/)[0]
  const parts = path.split('/').filter(Boolean)
  return parts.length >= 2 ? parts : null
}

/**
 * The anchor of the comment an API address names: `issues/comments/12` is `issuecomment-12`,
 * `pulls/comments/12` — a review comment — `discussion_r12`. Anything else has none.
 */
export function commentAnchor(apiUrl: string | null, ends: Endpoints): string | undefined {
  if (!apiUrl) return undefined
  const parts = repoPath(apiUrl, ends)
  if (!parts || parts.length !== 5 || parts[3] !== 'comments' || !/^\d+$/.test(parts[4]))
    return undefined
  if (parts[2] === 'issues') return `issuecomment-${parts[4]}`
  if (parts[2] === 'pulls') return `discussion_r${parts[4]}`
  return undefined
}

/**
 * The web page an issue, pull request, commit or discussion API address is: `…/pulls/7` is
 * `<origin>/o/r/pull/7`. Null for anything a GitHub tab does not show.
 */
export function apiToWeb(apiUrl: string, ends: Endpoints): string | null {
  const parts = repoPath(apiUrl, ends)
  if (!parts || parts.length !== 4) return null
  const [owner, repo, kind, id] = parts
  const web = `${ends.origin}/${owner}/${repo}`
  if (kind === 'issues' && /^\d+$/.test(id)) return `${web}/issues/${id}`
  if (kind === 'pulls' && /^\d+$/.test(id)) return `${web}/pull/${id}`
  if (kind === 'discussions' && /^\d+$/.test(id)) return `${web}/discussions/${id}`
  if (kind === 'commits' && /^[0-9a-f]{7,40}$/i.test(id)) return `${web}/commit/${id}`
  return null
}

/** Where a notification leads — see the top of this file. */
export function destination(n: GithubNotification, ends: Endpoints): Destination {
  const repoUrl = `${ends.origin}/${n.repo}`
  const page = n.apiUrl ? apiToWeb(n.apiUrl, ends) : null
  if (page) {
    // A comment that is the subject itself says nothing more than the subject.
    const anchor = n.commentApiUrl !== n.apiUrl ? commentAnchor(n.commentApiUrl, ends) : undefined
    return { kind: 'tab', url: anchor ? `${page}#${anchor}` : page }
  }
  switch (n.type) {
    case 'Discussion':
      return { kind: 'discussion', repoUrl, title: n.title }
    case 'Release':
      return n.apiUrl
        ? { kind: 'ask', apiUrl: n.apiUrl, fallback: `${repoUrl}/releases` }
        : { kind: 'browser', url: `${repoUrl}/releases` }
    case 'CheckSuite':
    case 'WorkflowRun':
      return { kind: 'browser', url: `${repoUrl}/actions` }
    case 'RepositoryInvitation':
      return { kind: 'browser', url: `${repoUrl}/invitations` }
    case 'RepositoryVulnerabilityAlert':
    case 'RepositoryDependabotAlertsThread':
    case 'SecurityAdvisory':
      return { kind: 'browser', url: `${repoUrl}/security` }
    default:
      return { kind: 'tab', url: repoUrl }
  }
}

/** The repository's discussions searched for a title — where a discussion not found by it goes. */
export const discussionSearchUrl = (repoUrl: string, title: string): string =>
  `${repoUrl}/discussions?q=${encodeURIComponent(`in:title ${title}`)}`

/** How long ago, the way GitHub's inbox says it: `now`, `5m`, `3h`, `2d`, then the date. */
export function ago(iso: string, now = Date.now()): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const minutes = Math.floor((now - then) / 60_000)
  if (currentLocale().language !== 'en') {
    const locale = currentLocale().format
    const hours = Math.floor(minutes / 60),
      days = Math.floor(hours / 24)
    const format = relativeFormatter(locale, { numeric: 'auto', style: 'narrow' })
    if (minutes < 1) return format.format(0, 'second')
    if (minutes < 60) return format.format(-minutes, 'minute')
    if (hours < 24) return format.format(-hours, 'hour')
    if (days < 30) return format.format(-days, 'day')
    return dateFormatter(locale, {
      day: 'numeric',
      month: 'short',
      ...(new Date(now).getFullYear() === new Date(then).getFullYear() ? {} : { year: 'numeric' }),
    }).format(new Date(then))
  }
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const d = new Date(then)
  const month = d.toLocaleString('en', { month: 'short' })
  return new Date(now).getFullYear() === d.getFullYear()
    ? `${d.getDate()} ${month}`
    : `${d.getDate()} ${month} ${d.getFullYear()}`
}
