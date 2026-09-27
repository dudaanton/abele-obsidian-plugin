/**
 * The query of a list of pull requests, issues or discussions, in GitHub's own search syntax —
 * `is:open label:bug author:ann sort:updated-desc` — which is the one source of truth: the field
 * shows it, the filters beside it rewrite it, the tab's address carries it (`?q=`), and GitHub
 * is asked with it.
 *
 * Nothing here touches the network.
 */

import { DEFAULT_LIST_QUERY } from '../urls'

export type ListKind = 'pulls' | 'issues' | 'discussions'

/** What GitHub's own list starts with. */
export const DEFAULT_QUERY: Record<ListKind, string> = DEFAULT_LIST_QUERY

/** Words, with a quoted value kept whole: `label:"good first issue"` is one. */
export function tokens(query: string): string[] {
  return query.match(/(?:[^\s"]+(?:"[^"]*")?|"[^"]*")+/g) ?? []
}

const unquote = (v: string) => v.replace(/^"(.*)"$/, '$1')
const quote = (v: string) => (/[\s"]/.test(v) ? `"${v.replace(/"/g, '')}"` : v)

const keyOf = (token: string): string | null => {
  const m = /^(-?)([a-z-]+):/i.exec(token)
  return m ? `${m[1]}${m[2].toLowerCase()}` : null
}

/** Every value given for `key` — `label:a label:b` has two. */
export function qualifier(query: string, key: string): string[] {
  const k = key.toLowerCase()
  return tokens(query)
    .filter((t) => keyOf(t) === k)
    .map((t) => unquote(t.slice(t.indexOf(':') + 1)))
}

/**
 * The query with `key` set to `value` alone — every earlier value of it taken out — or, with no
 * value, without it. Only `is:` is shared by several meanings (state, kind, draft), so for it
 * `among` names the values that replace each other.
 */
export function setQualifier(
  query: string,
  key: string,
  value: string | null,
  among?: string[]
): string {
  const k = key.toLowerCase()
  const kept = tokens(query).filter((t) => {
    if (keyOf(t) !== k) return true
    if (!among) return false
    return !among.includes(unquote(t.slice(t.indexOf(':') + 1)).toLowerCase())
  })
  if (value) kept.push(`${key}:${quote(value)}`)
  return kept.join(' ')
}

export type ListState = 'open' | 'closed' | 'merged' | 'all'
const STATES = ['open', 'closed', 'merged', 'unmerged']

export function stateOf(query: string): ListState {
  const is = qualifier(query, 'is').map((v) => v.toLowerCase())
  if (is.includes('merged')) return 'merged'
  if (is.includes('closed')) return 'closed'
  if (is.includes('open')) return 'open'
  return 'all'
}

export const withState = (query: string, state: ListState): string =>
  setQualifier(query, 'is', state === 'all' ? null : state, STATES)

export interface SortOption {
  id: string
  label: string
}

export const SORTS: SortOption[] = [
  { id: 'created-desc', label: 'Newest' },
  { id: 'created-asc', label: 'Oldest' },
  { id: 'comments-desc', label: 'Most commented' },
  { id: 'updated-desc', label: 'Recently updated' },
]

/** `sort:updated-desc` as the search API takes it: apart from the query, as two parameters. */
export function sortOf(query: string): { sort: string; order: 'asc' | 'desc' } {
  const [value] = qualifier(query, 'sort')
  const m = /^(created|updated|comments|reactions|interactions)(?:-(asc|desc))?$/i.exec(value ?? '')
  if (!m) return { sort: 'created', order: 'desc' }
  return { sort: m[1].toLowerCase(), order: (m[2]?.toLowerCase() as 'asc' | 'desc') ?? 'desc' }
}

/**
 * What GitHub's search is asked: the repository, the kind the list is of — a pull request list
 * that lost its `is:pr` would list issues too — and the rest of the query, the sort taken out.
 */
export function searchQuery(kind: ListKind, repo: string, query: string): string {
  let q = setQualifier(query, 'sort', null)
  q = setQualifier(q, 'repo', null)
  const is = qualifier(q, 'is').map((v) => v.toLowerCase())
  if (kind === 'pulls' && !is.includes('pr')) q = `is:pr ${q}`
  if (kind === 'issues' && !is.includes('issue')) q = `is:issue ${q}`
  if (kind === 'pulls') q = setQualifier(q, 'is', null, ['issue'])
  if (kind === 'issues') q = setQualifier(q, 'is', null, ['pr'])
  return `repo:${repo} ${q}`.trim().replace(/\s+/g, ' ')
}

/** The review a pull request list may be narrowed to: GitHub's `review:` values. */
export const REVIEWS: { value: string; label: string }[] = [
  { value: 'none', label: 'No reviews' },
  { value: 'required', label: 'Review required' },
  { value: 'approved', label: 'Approved' },
  { value: 'changes_requested', label: 'Changes requested' },
]
