import type { GithubTarget } from '@/github/urls'
import type { ListData, ListItem, ListPage, ListChoices } from '@/github/lists/listData'
import { tokens, qualifier, stateOf, sortOf } from '@/github/lists/listQuery'
import type { ForgejoClient } from './forgejoClient'

type Target = Extract<GithubTarget, { kind: 'list' }>
interface Row {
  number: number
  title: string
  state: string
  merged?: boolean
  pull_request?: unknown
  user?: { login: string }
  assignees?: { login: string }[]
  labels?: { name: string; color?: string }[]
  milestone?: { title: string }
  created_at?: string
  updated_at?: string
  comments?: number
}
const PAGE = 25
/** Local filtering of a bounded native snapshot; an incomplete scan never claims exact totals. */
export function forgejoLists(client: ForgejoClient, api: string, web: string) {
  const snapshots = new Map<
    string,
    { items: ListItem[]; complete: boolean; counts: ListData['counts'] }
  >()
  const key = (target: Target) => JSON.stringify([target.list, target.query])
  const list = async (target: Target): Promise<ListData> => {
    client.session.assertCurrent()
    if (target.list === 'discussions')
      throw new Error('Discussions are not available for this service.')
    const words: string[] = []
    for (const token of tokens(target.query)) {
      const match = /^([^:]+):(.*)$/.exec(token)
      if (!match) {
        words.push(token.replace(/^"|"$/g, '').toLowerCase())
        continue
      }
      if (
        !['is', 'author', 'assignee', 'label', 'milestone', 'sort'].includes(match[1]) ||
        (match[1] === 'is' && !['open', 'closed', 'merged', 'pr', 'issue'].includes(match[2])) ||
        (match[1] === 'sort' &&
          !['created-desc', 'created-asc', 'updated-desc', 'comments-desc'].includes(match[2]))
      )
        throw new Error(`The filter ${match[1]}:${match[2]} is not available for this service.`)
    }
    const pull = target.list === 'pulls'
    const rows = await client.pages<Row>(
      `${api}/${pull ? 'pulls?state=all' : 'issues?state=all&type=issues'}`
    )
    const values = (name: string) => qualifier(target.query, name).map((v) => v.toLowerCase())
    const common = rows.value.filter(
      (row) =>
        words.every((word) => row.title.toLowerCase().includes(word)) &&
        values('author').every((v) => row.user?.login.toLowerCase() === v) &&
        values('assignee').every((v) => row.assignees?.some((a) => a.login.toLowerCase() === v)) &&
        values('label').every((v) => row.labels?.some((l) => l.name.toLowerCase() === v)) &&
        values('milestone').every((v) => row.milestone?.title.toLowerCase() === v)
    )
    const state = stateOf(target.query)
    const filtered = common.filter(
      (row) => state === 'all' || (state === 'merged' ? !!row.merged : row.state === state)
    )
    const sort = sortOf(target.query)
    filtered.sort((a, b) => {
      const field = sort.sort === 'updated' ? 'updated_at' : 'created_at'
      const order =
        sort.sort === 'comments'
          ? (a.comments ?? 0) - (b.comments ?? 0)
          : (a[field] ?? '').localeCompare(b[field] ?? '')
      return sort.order === 'asc' ? order : -order
    })
    const items: ListItem[] = filtered.map((row) => ({
      kind: pull ? 'pull' : 'issue',
      number: row.number,
      title: row.title,
      state: row.merged ? 'merged' : row.state,
      author: row.user?.login ?? 'ghost',
      createdAt: row.created_at ?? '',
      updatedAt: row.updated_at ?? '',
      comments: row.comments ?? 0,
      labels: (row.labels ?? []).map((l) => ({ name: l.name, color: l.color ?? '' })),
      milestone: row.milestone?.title,
      url: `${web}/${pull ? 'pulls' : 'issues'}/${row.number}`,
    }))
    const counts = {
      open: rows.complete ? common.filter((row) => row.state === 'open').length : null,
      closed: rows.complete ? common.filter((row) => row.state === 'closed').length : null,
    }
    client.session.assertCurrent()
    snapshots.set(key(target), { items, complete: rows.complete, counts })
    while (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value)
    return {
      kind: target.list,
      query: target.query,
      counts,
      url: `${web}/${target.list}${target.query ? `?q=${encodeURIComponent(target.query)}` : ''}`,
      items: items.slice(0, PAGE),
      total: items.length,
      next: items.length > PAGE ? 2 : null,
      totalKnown: rows.complete,
      note: rows.complete
        ? undefined
        : 'Only the first 1000 service rows were filtered; counts and results are incomplete. Narrow the query on the service for the rest.',
    }
  }
  const more = async (target: Target, page: number | string): Promise<ListPage> => {
    client.session.assertCurrent()
    const snapshot = snapshots.get(key(target))
    if (!snapshot) throw new Error('The list snapshot expired. Reload the list before continuing.')
    const number = Number(page)
    if (!Number.isSafeInteger(number) || number < 2) throw new Error('Invalid list page.')
    return {
      items: snapshot.items.slice((number - 1) * PAGE, number * PAGE),
      total: snapshot.items.length,
      next: snapshot.items.length > number * PAGE ? number + 1 : null,
    }
  }
  const choices = async (): Promise<ListChoices> => {
    const [labels, milestones] = await Promise.all([
      client
        .pages<{ name: string }>(`${api}/labels`)
        .catch(() => ({ value: [] as { name: string }[] })),
      client
        .pages<{ title: string }>(`${api}/milestones?state=open`)
        .catch(() => ({ value: [] as { title: string }[] })),
    ])
    client.session.assertCurrent()
    return {
      labels: labels.value.map((l) => l.name),
      milestones: milestones.value.map((m) => m.title),
      categories: [],
    }
  }
  return { list, more, choices }
}
