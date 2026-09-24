/**
 * Why GitHub refused a request, in words a person can act on.
 *
 * A fine-grained token is refused in ways that look alike from outside — nearly all of them a
 * 403 or a 404 — and each needs a different fix: a permission not granted, a repository not
 * selected, a token made under the wrong resource owner, an organisation policy on tokens, an
 * IP allow list, single sign-on. GitHub's `message` and headers are what tell them apart, so
 * they are read here, the cause is put first, and GitHub's own words are kept beside it.
 *
 * The wordings matched are GitHub's own, as its API sends them (docs.github.com, "Troubleshooting
 * the REST API" and the organisation personal-access-token policies). An unknown one still
 * shows GitHub's message: nothing is lost by a pattern that does not match.
 */

export type RefusalKind =
  | 'auth'
  | 'sso'
  | 'ip-allow-list'
  | 'policy'
  | 'forbidden'
  | 'not-found'
  | 'empty'
  | 'rate-limit'
  | 'network'
  | 'other'

export interface Refusal {
  kind: RefusalKind
  /** The first thing said: what went wrong, naming the request. */
  reason: string
  /** What to do about it. */
  fix?: string
  /** The permission the request needed, from `X-Accepted-GitHub-Permissions`. */
  needed?: string
  /** GitHub's own `message`, verbatim. */
  githubSaid?: string
}

export type TokenKind = 'none' | 'fine-grained' | 'classic' | 'oauth' | 'app' | 'unknown'

/** Told from the prefix GitHub gives every token it issues. Nothing else of it is looked at. */
export function tokenKind(token: string): TokenKind {
  if (!token) return 'none'
  if (token.startsWith('github_pat_')) return 'fine-grained'
  if (token.startsWith('ghp_')) return 'classic'
  if (token.startsWith('gho_')) return 'oauth'
  if (token.startsWith('ghu_') || token.startsWith('ghs_')) return 'app'
  return 'unknown'
}

export const header = (
  headers: Record<string, string> | undefined,
  name: string
): string | undefined => {
  if (!headers) return undefined
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : undefined
}

const PERMISSION_NAMES: Record<string, string> = {
  metadata: 'Metadata',
  contents: 'Contents',
  issues: 'Issues',
  pull_requests: 'Pull requests',
  discussions: 'Discussions',
}

const permissionName = (key: string) =>
  PERMISSION_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')

/**
 * `X-Accepted-GitHub-Permissions` in words: `issues=read; pull_requests=read` is "Issues (read)
 * or Pull requests (read)" — semicolons separate alternatives, commas permissions needed
 * together. `allows_permissionless_access=true` needs nothing and says nothing.
 */
export function neededPermissions(value: string | undefined): string | undefined {
  if (!value) return undefined
  const alternatives = value
    .split(';')
    .map((set) =>
      set
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p && !p.startsWith('allows_permissionless_access'))
        .map((p) => {
          const [key, level] = p.split('=')
          return level ? `${permissionName(key.trim())} (${level.trim()})` : permissionName(key)
        })
        .join(' and ')
    )
    .filter(Boolean)
  return alternatives.length ? alternatives.join(' or ') : undefined
}

/** The organisation a message names — "the `acme` organization", "'acme' organization", "acme forbids". */
function orgIn(message: string): string {
  const quoted = /the [`'"]?([\w.-]+)[`'"]? organization/i.exec(message)
  if (quoted) return quoted[1]
  const leading = /^[`'"]?([\w.-]+)[`'"]? forbids/i.exec(message)
  return leading ? leading[1] : ''
}

const the = (org: string) => (org ? `The organisation ${org}` : 'The organisation')

export interface RefusalInput {
  status: number
  headers?: Record<string, string>
  /** GitHub's `message`, or empty. */
  message: string
  hasToken: boolean
  /** The request, named: "the pull request's reviews". */
  what: string
}

export function explainRefusal({
  status,
  headers,
  message,
  hasToken,
  what,
}: RefusalInput): Refusal {
  const githubSaid = message || undefined
  const needed = neededPermissions(header(headers, 'x-accepted-github-permissions'))
  const base = { githubSaid, needed }

  if (status === 401) {
    return {
      ...base,
      kind: 'auth',
      reason: hasToken
        ? `GitHub did not accept the token when asked for ${what}.`
        : `GitHub asks for a token to show ${what}.`,
      fix: hasToken
        ? 'It may be mistyped, expired or revoked. Set a new one in Abele settings → GitHub.'
        : 'Add one in Abele settings → GitHub.',
    }
  }

  const remaining = header(headers, 'x-ratelimit-remaining')
  if (status === 429 || (status === 403 && remaining === '0')) {
    const reset = Number(header(headers, 'x-ratelimit-reset'))
    return {
      ...base,
      kind: 'rate-limit',
      reason: hasToken
        ? 'The GitHub request limit for this token is used up.'
        : 'The GitHub limit for requests without a token (60 an hour) is used up.',
      fix:
        (reset ? `It resets at ${new Date(reset * 1000).toLocaleTimeString()}.` : '') +
        (hasToken ? '' : `${reset ? ' ' : ''}A token raises it to 5000.`),
    }
  }

  const sso = header(headers, 'x-github-sso')
  if (status === 403 && (sso || /SAML enforcement|single sign-on/i.test(message))) {
    const url = sso ? /url=([^;\s]+)/.exec(sso)?.[1] : undefined
    return {
      ...base,
      kind: 'sso',
      reason:
        'This organisation uses single sign-on, and the token has not been authorised for it.',
      fix: url
        ? `Authorise it here: ${url}`
        : 'Authorise it on GitHub: Settings → Personal access tokens → the token → Configure SSO.',
    }
  }

  if (/IP allow list/i.test(message)) {
    return {
      ...base,
      kind: 'ip-allow-list',
      reason: `${the(orgIn(message))} only accepts requests from its allowed IP addresses, and this device's address is not on the list. The token itself is fine.`,
      fix: 'Connect through the office network or VPN the organisation allows, or ask an organisation owner to add this address. The same token keeps working from a machine that is on the list, which is why it can work elsewhere and not here.',
    }
  }

  if (
    /forbids access via a fine-grained personal access tokens? if the token's lifetime/i.test(
      message
    )
  ) {
    const days = /greater than (\d+) days/i.exec(message)?.[1]
    return {
      ...base,
      kind: 'policy',
      reason: `${the(orgIn(message))} refuses fine-grained tokens that are valid for longer than it allows${days ? ` (${days} days)` : ''}.`,
      fix: "Shorten the token's expiration on GitHub — GitHub's message below has the link — or make a new token with a shorter one.",
    }
  }

  if (
    /forbids access via a (personal access token with fine-grained permissions|fine-grained personal access token)/i.test(
      message
    )
  ) {
    return {
      ...base,
      kind: 'policy',
      reason: `${the(orgIn(message))} does not accept fine-grained personal access tokens at all.`,
      fix: 'Only an organisation owner can change that (organisation settings → Personal access tokens). Until then its repositories cannot be read with this kind of token.',
    }
  }

  if (/forbids access via a personal access token \(classic\)/i.test(message)) {
    return {
      ...base,
      kind: 'policy',
      reason: `${the(orgIn(message))} does not accept classic personal access tokens.`,
      fix: 'Make a fine-grained token instead, with the organisation as its Resource owner.',
    }
  }

  if (/OAuth App access restrictions/i.test(message)) {
    return {
      ...base,
      kind: 'policy',
      reason: `${the(orgIn(message))} restricts which apps may read its data, and this token is caught by it.`,
      fix: 'Use a fine-grained token with the organisation as its Resource owner, or ask an owner to allow access.',
    }
  }

  if (
    status === 403 &&
    /Resource not accessible by (personal access token|integration)/i.test(message)
  ) {
    return {
      ...base,
      kind: 'forbidden',
      reason: `GitHub refused ${what} to this token.`,
      fix: 'A fine-grained token is refused like this when it lacks that permission, when this repository is not among the repositories it was given, or when its Resource owner is your own account rather than the organisation — a fine-grained token only reaches the repositories of the one owner chosen when it was made. A token still waiting for an organisation owner to approve it reads public data only.',
    }
  }

  if (status === 403) {
    return {
      ...base,
      kind: 'forbidden',
      reason: `GitHub refused ${what}.`,
    }
  }

  if (status === 404 && /repository is empty/i.test(message)) {
    return { ...base, kind: 'empty', reason: 'The repository is empty: it has no files yet.' }
  }

  if (status === 404) {
    return {
      ...base,
      kind: 'not-found',
      reason: `GitHub found nothing for ${what}.`,
      fix: hasToken
        ? 'Either it does not exist, or the token cannot see it: GitHub answers "not found" rather than "forbidden" for a private repository a token has no access to. Check that the repository is selected in the token, that the token\'s Resource owner is the organisation that owns the repository (a token made under your own account cannot see an organisation\'s private repositories), and, if the organisation requires approval, that an owner has approved the token.'
        : 'If the repository is private, add a token in Abele settings → GitHub.',
    }
  }

  return { ...base, kind: 'other', reason: `GitHub answered ${status} for ${what}.` }
}

/** The refusal as the lines a person reads: cause and fix, then the permission, then GitHub. */
export function refusalText(r: Refusal): string {
  const lines = [r.fix ? `${r.reason} ${r.fix}` : r.reason]
  if (r.needed) lines.push(`Needs: ${r.needed}`)
  if (r.githubSaid) lines.push(`GitHub said: "${r.githubSaid}"`)
  return lines.join('\n')
}
