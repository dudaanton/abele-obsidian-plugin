import { streamBCount } from '@/i18n/streamBCounts'
import { t as translate } from '@/i18n'
import { agentText } from '@/i18n/streamBText'
import dayjs from 'dayjs'
/**
 * How a GitHub tab names what it shows: the title and the details under it, the tab's own name,
 * and — for a file or a folder — the link to it at the ref it was read at.
 */
import { type GithubTarget, shortName } from './urls'

import { formatDate as localizedDate, splitMessage } from './format'
import { repoWeb } from './origin'
import type { GithubLink } from './permalinks'
import type { ItemData } from './loadItem'
import type { BlobData, CommitData, DiscussionData, IssueData, Label, PullData } from './api'
import type { FolderData } from './tree/folder'
import type { CompareData } from './compare'
import { treeUrl } from './tree/fileTree'
import { homeUrl, type RepoHomeData } from './repoPage/repoHome'
import { listUrl, type ListData } from './lists/listData'

const LIST_TITLE = {
  pulls: 'streamB.pullRequests.d9e3f2',
  issues: 'streamB.issues.666067',
  discussions: 'streamB.discussions.60157c',
} as const

/** A commit SHA as GitHub shows one; a branch or a tag as it is. */
export const shortRef = (ref: string) => (/^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref)

/** A person in the details under the title, drawn with their name and picture. */
export interface MetaPerson {
  login: string
  avatar?: string
  /** Words after them: `opened 1 Sep 2026, 10:00`. */
  after?: string
}

export type MetaPart = string | MetaPerson

export interface ItemHead {
  title: string
  number?: number
  state?: string
  labels: Label[]
  meta: MetaPart[]
}

export function itemHead(
  translationItem: GithubTarget | null,
  data: ItemData | null,
  localized = true
): ItemHead {
  const t = localized ? translate : agentText
  const formatDate = localized
    ? localizedDate
    : (iso: string | undefined) => {
        const date = dayjs(iso)
        return iso && date.isValid() ? date.format('D MMM YYYY, HH:mm') : ''
      }
  const fallback: ItemHead = {
    title: translationItem ? shortName(translationItem) : '',
    labels: [],
    meta: [],
  }
  if (!translationItem || !data) return fallback

  if (translationItem.kind === 'commit') {
    const c = data as CommitData
    return {
      ...fallback,
      title: splitMessage(c.message).title,
      meta: [
        c.sha.slice(0, 7),
        c.login ? { login: c.login, avatar: c.avatar } : c.author,
        formatDate(c.date),
        ...(translationItem.pull
          ? [t('streamB.in.fbc77f', { v0: String(translationItem.pull) })]
          : []),
      ],
    }
  }
  if (translationItem.kind === 'compare') {
    const c = data as CompareData
    const commits =
      c.aheadBy === null
        ? t('streamBMeta.162899fff5')
        : t('streamBMeta.0ff3e488c6', {
            commits: localized
              ? streamBCount(c.aheadBy, 'commit')
              : agentText('streamBCount.commit', { count: c.aheadBy }),
          })
    return {
      ...fallback,
      // A commit by its short SHA, as GitHub writes one; a branch or a tag as it is.
      title: `${shortRef(c.base)}${c.direct ? '..' : '...'}${shortRef(c.head)}`,
      state: c.status || undefined,
      meta: [
        commits,
        c.behindBy === null
          ? t('streamBMeta.220216bd7e')
          : t('streamBMeta.02039c2288', { count: c.behindBy }),
        (c.filesComplete || c.files.length) && !c.files.some((file) => file.countsPending)
          ? `+${c.additions} −${c.deletions}`
          : '',
        c.mergeBaseSha ? t('streamB.splitAt.2939dd', { v0: c.mergeBaseSha.slice(0, 7) }) : '',
      ].filter(Boolean),
    }
  }
  // The front page is titled by the repository, which the breadcrumbs draw with the ref shown;
  // what it is — private, archived, a fork — is said beside it.
  if (translationItem.kind === 'repo') {
    const { meta } = data as RepoHomeData
    return {
      ...fallback,
      title: `${meta.owner}/${meta.name}`,
      state: meta.visibility,
      labels: meta.archived ? [{ name: t('streamB.archived.dd9e88'), color: '' }] : [],
      meta: meta.parent ? [t('streamB.forkedFrom.f5921c', { v0: String(meta.parent) })] : [],
    }
  }
  // A list is titled by what it lists; how many the query finds is said under it.
  if (translationItem.kind === 'list') {
    const list = data as ListData
    return {
      ...fallback,
      title: t(LIST_TITLE[translationItem.list]),
      meta: [t('streamBMeta.6d6de8b0ca', { count: list.total })],
    }
  }
  // A file or a folder is titled by where it is, which the breadcrumbs draw with its ref.
  if (translationItem.kind === 'blob' || translationItem.kind === 'tree') {
    const b = data as BlobData | FolderData
    return { ...fallback, title: b.path || `${translationItem.owner}/${translationItem.repo}` }
  }

  const item = data as IssueData | PullData | DiscussionData
  const meta: MetaPart[] = [
    {
      login: item.author,
      avatar: item.authorAvatar,
      after: t('streamB.opened.65ac8f', { v0: String(formatDate(item.createdAt)) }),
    },
  ]
  if (translationItem.kind === 'pull') {
    const p = item as PullData
    meta.push(`${p.head} → ${p.base}`)
    if (p.additions !== null && p.deletions !== null) meta.push(`+${p.additions} −${p.deletions}`)
  }
  if (translationItem.kind === 'discussion') meta.push((item as DiscussionData).category)
  return {
    title: item.title,
    number: item.number,
    state: item.state,
    labels: item.labels,
    meta: meta.filter(Boolean),
  }
}

/**
 * The tab's name: `app.ts @ main`, `util/ @ 1a2b3c4`, `acme/widgets#42 The title`,
 * `acme/widgets main...dev`.
 */
export function itemTabTitle(translationItem: GithubTarget, data: ItemData, title: string): string {
  if (translationItem.kind === 'compare')
    return `${translationItem.owner}/${translationItem.repo} ${title}`
  if (translationItem.kind === 'list')
    return `${translationItem.owner}/${translationItem.repo} ${title.toLowerCase()}`
  if (translationItem.kind === 'repo') {
    const home = data as RepoHomeData
    const name = `${home.meta.owner}/${home.meta.name}`
    return home.ref === home.meta.defaultBranch ? name : `${name} @ ${shortRef(home.ref)}`
  }
  if (translationItem.kind === 'blob' || translationItem.kind === 'tree') {
    const b = data as BlobData | FolderData
    const name = b.path ? b.path.split('/').pop() : translationItem.repo
    return `${name}${translationItem.kind === 'tree' ? '/' : ''} @ ${shortRef(b.ref)}`
  }
  return `${shortName(translationItem)} ${title}`
}

/**
 * A link to a file or a folder at the ref it was read at; undefined for anything else, which the
 * linker names.
 */
export function placeLink(translationItem: GithubTarget, data: ItemData): GithubLink | undefined {
  if (translationItem.kind === 'blob') {
    const b = data as BlobData
    const path = b.path.split('/').map(encodeURIComponent).join('/')
    return {
      label: `${translationItem.owner}/${translationItem.repo}@${b.ref} · ${b.path}`,
      url: `${repoWeb(translationItem)}/blob/${b.ref}/${path}`,
    }
  }
  if (translationItem.kind === 'list') {
    return {
      label: `${translationItem.owner}/${translationItem.repo} ${agentText(LIST_TITLE[translationItem.list]).toLowerCase()} · ${translationItem.query}`,
      url: listUrl(translationItem),
    }
  }
  if (translationItem.kind === 'repo') {
    const home = data as RepoHomeData
    const atDefault = home.ref === home.meta.defaultBranch
    return {
      label: `${translationItem.owner}/${translationItem.repo}${atDefault ? '' : `@${home.ref}`}`,
      url: homeUrl(translationItem, home.ref, home.meta.defaultBranch),
    }
  }
  if (translationItem.kind === 'tree') {
    const f = data as FolderData
    return {
      label: `${translationItem.owner}/${translationItem.repo}@${f.ref}${f.path ? ` · ${f.path}/` : ''}`,
      url: treeUrl(translationItem, f.ref, f.path),
    }
  }
  return undefined
}
