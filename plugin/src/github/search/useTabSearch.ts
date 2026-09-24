/**
 * The search a GitHub tab carries — find in the tab, code search, go to definition — wired to
 * what the tab has loaded. Kept out of the tab component so that component only says where the
 * find bar and the search panel go.
 */
import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { PaneType } from 'obsidian'
import type { BlobData, CommitData, DiffFile, FilesData, PullData } from '../api'
import type { GithubClient } from '../client'
import { commitSha } from '../api'
import type { FolderData } from '../tree/folder'
import { parsePatch } from '../patch'
import type { GithubTarget } from '../urls'
import { resolveSha } from './source'
import { TabCode, blobUrl, webBase, type TabChanges } from './tabCode'
import { provideCodeNav } from './navAddon'
import { DefinitionPicker } from './definitionPicker'
import type { Loaded } from '../useLoad'
import { GlobalStore } from '@/stores/GlobalStore'
import { githubSettings } from '../GithubService'

export interface TabSearchOptions {
  root: Ref<HTMLElement | undefined>
  shown: ComputedRef<GithubTarget>
  data: () => unknown
  files: Loaded<FilesData>
  client: () => GithubClient
  open: (url: string, pane: PaneType | false) => void
}

export interface SearchRequestState {
  text: string
  wholeWord?: boolean
  caseSensitive?: boolean
  scope?: 'changes' | 'repo' | 'names'
  nonce: number
}

export function useTabSearch(o: TabSearchOptions) {
  const findOpen = ref(false)
  const findNonce = ref(0)
  const searchOpen = ref(false)
  const searchRequest = ref<SearchRequestState | null>(null)

  /** The SHA the tab's code is at, asked once per item. */
  let shaFor: { key: string; sha: Promise<string> } | null = null

  const repo = () => {
    const t = o.shown.value
    return { host: t.host, owner: t.owner, repo: t.repo }
  }

  const sha = (): Promise<string> => {
    const t = o.shown.value
    const d = o.data()
    const key = JSON.stringify([t.kind, t.host, t.owner, t.repo, (d as { url?: string })?.url])
    if (shaFor?.key === key) return shaFor.sha
    let promise: Promise<string>
    const head = t.kind === 'pull' ? (d as PullData | null)?.headSha : undefined
    if (head) promise = Promise.resolve(head)
    else if (t.kind === 'commit' && d) promise = Promise.resolve((d as CommitData).sha)
    else if ((t.kind === 'blob' || t.kind === 'tree') && d)
      promise = commitSha(o.client(), repo(), (d as BlobData | FolderData).ref)
    else promise = resolveSha(o.client(), repo())
    // A failed lookup is not kept: the next ask tries again.
    promise.catch(() => {
      if (shaFor?.sha === promise) shaFor = null
    })
    shaFor = { key, sha: promise }
    return promise
  }

  const refLabel = (): string => {
    const t = o.shown.value
    const d = o.data()
    if (t.kind === 'pull') return (d as PullData)?.head || `#${t.number}`
    if (t.kind === 'commit') return ((d as CommitData)?.sha ?? t.sha).slice(0, 7)
    if (t.kind === 'blob' || t.kind === 'tree') {
      const ref = (d as BlobData | FolderData | null)?.ref ?? ''
      // A commit reads as GitHub shows it; a branch or a tag as it is.
      return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref
    }
    return 'the default branch'
  }

  const hasChanges = computed(
    () => o.shown.value?.kind === 'pull' || o.shown.value?.kind === 'commit'
  )

  const changes = async (): Promise<TabChanges | null> => {
    const t = o.shown.value
    if (t.kind === 'pull') {
      if (!o.files.data.value) await o.files.load()
      const files = o.files.data.value?.files
      if (!files) throw new Error(o.files.error.value ?? "The pull request's files did not load.")
      return {
        files,
        lineUrl: (hash, side, line) =>
          `${webBase(t)}/pull/${t.number}/files#diff-${hash}${side && line ? `${side}${line}` : ''}`,
      }
    }
    if (t.kind === 'commit') {
      const c = o.data() as CommitData | null
      if (!c) return null
      return {
        files: c.files,
        lineUrl: (hash, side, line) =>
          `${webBase(t)}/commit/${c.sha}#diff-${hash}${side && line ? `${side}${line}` : ''}`,
      }
    }
    return null
  }

  const code = new TabCode({
    client: o.client,
    repo,
    refLabel,
    sha,
    changes,
    blob: () => {
      const d = o.data() as BlobData | null
      return o.shown.value.kind === 'blob' && d ? { path: d.path, text: d.text } : null
    },
    open: (url, newTab) => o.open(url, newTab ? 'tab' : false),
    limitBytes: () => (githubSettings().searchLimitMb || 100) * 1024 * 1024,
    showReferences: (name) => {
      searchOpen.value = true
      searchRequest.value = {
        text: name,
        wholeWord: true,
        caseSensitive: true,
        scope: 'repo',
        nonce: (searchRequest.value?.nonce ?? 0) + 1,
      }
    },
    pick: (hits, at, name) => {
      const r = repo()
      new DefinitionPicker(GlobalStore.getInstance().app, hits, name, (hit, newTab) =>
        o.open(blobUrl(r, at, hit.path, hit.line), newTab ? 'tab' : false)
      ).open()
    },
  })

  // Diff viewers are named by their file's hash; the code search needs the path.
  const diffFiles = (): DiffFile[] => {
    const t = o.shown.value
    if (!t) return []
    if (t.kind === 'pull') return o.files.data.value?.files ?? []
    if (t.kind === 'commit') return (o.data() as CommitData | null)?.files ?? []
    return []
  }
  watch([() => o.files.data.value, () => o.data()], () => code.noteFiles(diffFiles()), {
    immediate: true,
  })

  let undoNav = () => {}
  watch(
    o.root,
    (el) => {
      undoNav()
      undoNav = el ? provideCodeNav(el, code) : () => {}
    },
    { immediate: true }
  )
  onBeforeUnmount(() => undoNav())

  /** A folded diff file's text, the same the viewer would show when it opens. */
  const foldedText = (hash: string): string | null => {
    const file = diffFiles().find((f) => f.hash === hash)
    return file?.patch
      ? parsePatch(file.patch)
          .map((l) => l.text)
          .join('\n')
      : null
  }

  const openFind = () => {
    findOpen.value = true
    findNonce.value++
  }

  const openSearch = () => {
    searchOpen.value = !searchOpen.value
  }

  // Another item in the same tab: the old search's answers belong to the old item.
  watch(
    () => o.shown.value && `${o.shown.value.kind}:${o.shown.value.owner}/${o.shown.value.repo}`,
    () => {
      searchRequest.value = null
      shaFor = null
    }
  )

  return {
    code,
    hasChanges,
    findOpen,
    findNonce,
    searchOpen,
    searchRequest,
    finderHooks: { foldedText },
    openFind,
    openSearch,
  }
}
