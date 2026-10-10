import { openExternal } from '@/helpers/openExternal'
import { computed, provide, watch } from 'vue'
import type { CompareSection } from '@/github/compareSection'
import { type RepositorySource } from '@/repository/source'
import { itemHead, itemTabTitle, placeLink, type ItemHead } from '@/github/itemHead'
import { type ItemData } from '@/github/loadItem'
import { type RepoFile } from '@/github/markdownLinks'
import type { GithubClient } from '@/github/client'
import { type GithubTarget } from '@/github/urls'
import { type CompareData } from '@/github/compare'
import { LINKER, createLinker } from '@/github/linking'
import { SCREEN, chatSubject } from '@/github/screen'
import { GITHUB_REPO } from '@/github/repoContext'
import { GITHUB_PEOPLE } from '@/github/users'
import { repoWeb } from '@/github/origin'
import { bodyLink, type GithubLink } from '@/github/permalinks'
import { GlobalStore } from '@/stores/GlobalStore'
import { type BlobData } from '@/github/api'
import type { Ref } from 'vue'
import type { Loaded } from '@/github/useLoad'
import type { BasePin } from '@/github/comparison/pins'
import type { GithubItemProps } from './types'
interface PresentationOptions {
  props: GithubItemProps
  target: Ref<GithubTarget | null>
  shown: Ref<GithubTarget>
  source: Ref<RepositorySource | null>
  main: Loaded<ItemData>
  compared: Ref<CompareData | null>
  client: () => GithubClient
  pullTab: Ref<'conversation' | 'files' | 'commits'>
  compareTab: Ref<CompareSection>
  blob: Ref<BlobData | null>
  pin: Ref<BasePin | null>
}
export function useItemPresentation(options: PresentationOptions) {
  const { props, target, shown, source, main, compared, client, pullTab, compareTab, blob, pin } =
    options
  const browserUrl = computed(() => {
    if (!target.value || source.value.identity.provider === 'node') return ''
    const data = main.data.value as { url?: string } | null
    // The address the link had, so a line anchor survives; GitHub's own for an item it moved.
    return props.model.url || data?.url || ''
  })
  const head = computed<ItemHead>(() => {
    const head = itemHead(shown.value, main.data.value)
    if (source.value?.identity.provider === 'node' && shown.value?.kind === 'repo')
      return { ...head, title: shown.value.repo, state: undefined }
    if (source.value?.identity.provider === 'node' && compared.value)
      return {
        ...head,
        title: `${shortNodeRef(compared.value.base)} → ${shortNodeRef(compared.value.head)}`,
        state: undefined,
        meta: [],
      }
    return head
  })
  const shortNodeRef = (ref: string) =>
    ref.startsWith('working-')
      ? 'Current files'
      : /^[a-f\d]{40}$/i.test(ref)
        ? ref.slice(0, 7)
        : ref
  // Comments, diffs and the file view make links to themselves through this.
  const linker = createLinker({
    app: GlobalStore.getInstance().app,
    shown: () => (target.value ? shown.value : null),
    data: () => main.data.value,
    title: () => head.value.title,
    client,
    source: () => source.value,
  })
  provide(LINKER, linker)
  /** The repository shown: comments and messages resolve their relative links and images in it. */
  const repo = computed<RepoFile | null>(() => {
    const t = target.value
    return t
      ? { host: t.host, origin: t.origin, owner: t.owner, repo: t.repo, ref: 'HEAD', path: '' }
      : null
  })
  provide(GITHUB_REPO, repo)
  // The people in it are looked up with the tab's own client: its server, its token.
  provide(GITHUB_PEOPLE, () =>
    target.value && source.value?.github ? (props.peopleClient?.() ?? client()) : null
  )
  // What is on screen, for an agent to ask about: the diffs and the file view add their part.
  const screen = props.model.screen
  provide(SCREEN, screen)
  /** A link to the item itself — for a file or a folder, at the ref it was read at. */
  const itemLink = computed<GithubLink | null>(() => {
    const t = shown.value
    const data = main.data.value
    if (!t || !data) return null
    if (source.value.identity.provider === 'node')
      return { label: head.value.title, url: (data as { url: string }).url }
    const place = placeLink(t, data)
    if (place !== undefined) return place
    const item = linker.item()
    return item ? bodyLink(item, head.value.title) : null
  })
  watch(
    () =>
      [
        itemLink.value,
        head.value.title,
        main.error.value,
        pullTab.value,
        compareTab.value,
        shown.value,
        blob.value?.comparison,
        pin.value?.enteredRef,
      ] as const,
    () => {
      const t = target.value ? shown.value : null
      props.model.screenNamespace = t ? source.value.cacheNamespace : undefined
      screen.link = itemLink.value
      screen.title = main.data.value ? head.value.title : ''
      screen.kind = t?.kind ?? ''
      screen.section =
        t?.kind === 'pull' ? pullTab.value : t?.kind === 'compare' ? compareTab.value : null
      screen.error = main.error.value ?? ''
      const comparison = blob.value?.comparison
      screen.comparison = comparison
        ? {
            baseSha: comparison.baseSha,
            targetSha: comparison.targetSha,
            baseRef: pin.value?.enteredRef ?? comparison.baseSha,
          }
        : null
    },
    { immediate: true }
  )
  const chatAbout = () => {
    const subject = chatSubject(screen)
    if (subject) void linker.ask(subject.link, subject.quote)
  }
  const tabTitle = computed(() =>
    shown.value && main.data.value
      ? itemTabTitle(shown.value, main.data.value, head.value.title)
      : ''
  )
  watch(tabTitle, (title) => {
    if (title) props.onTitle?.(title)
  })
  const openInBrowser = (url: string) => {
    if (url) openExternal(url)
  }
  /** The same two versions the other way round, in this tab: its back arrow returns. */
  const swapSides = () => {
    const t = shown.value
    if (compared.value && t)
      props.onOpen?.(
        source.value.navigation.comparison(
          compared.value.head,
          compared.value.base,
          compared.value.direct
        ),
        false
      )
  }
  const openCommit = (sha: string) => {
    const t = shown.value
    if (t.kind !== 'pull') return
    props.onOpen?.(`${repoWeb(t)}/pull/${t.number}/commits/${sha}`)
  }
  return { browserUrl, head, linker, repo, screen, chatAbout, openInBrowser, swapSides, openCommit }
}
