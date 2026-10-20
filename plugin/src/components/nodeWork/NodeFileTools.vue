<template>
  <Teleport :to="glyphHost ?? 'body'" :disabled="!glyphHost">
    <Icon
      data-node-find
      icon="search"
      :tooltip="t('streamB.findInThisTabModF.de7869')"
      @click="showFind"
    />
    <Icon
      v-if="search"
      data-node-search
      icon="file-search"
      :tooltip="t('streamB.searchTheCodeThisChangeTheWhole.b06270')"
      @click="search.openSearch"
    />
  </Teleport>
  <GithubFindBar
    v-if="findOpen && root"
    ref="finder"
    :root="root"
    :hooks="search?.finderHooks ?? { foldedText: () => null }"
    @close="findOpen = false"
  />
  <GithubCodeSearch
    v-if="search?.searchOpen.value"
    :code="search.code"
    :ready="true"
    :has-changes="false"
    :request="search.searchRequest.value"
    @open="(url, newTab) => open(url, newTab ? 'tab' : false)"
    @close="search.searchOpen.value = false"
  />
</template>
<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { FILE_NAVIGATION } from '@/node/fileNavigation'
import type { PaneType } from 'obsidian'
import { t } from '@/i18n'
import type { RepositorySource } from '@/repository/source'
import type { RepoFile } from '@/github/markdownLinks'
import type { GithubTarget } from '@/github/urls'
import { useTabSearch } from '@/github/search/useTabSearch'
import { useLoad } from '@/github/useLoad'
import type { FilesData } from '@/github/api'
import { parseNodeRepositoryLink } from '@/repository/nodeLinks'
import { openNodeRepositoryTarget } from '@/node/openRepository'
import { GlobalStore } from '@/stores/GlobalStore'
import Icon from '../obsidian/Icon.vue'
import GithubFindBar from '../github/GithubFindBar.vue'
import GithubCodeSearch from '../github/GithubCodeSearch.vue'

const props = defineProps<{
  root?: HTMLElement
  glyphHost?: HTMLElement
  source?: RepositorySource
  file: RepoFile
  text: string
}>()
const finder = ref<InstanceType<typeof GithubFindBar>>()
const emit = defineEmits<{ find: [] }>()
const findOpen = ref(false)
const fileNavigation = inject(FILE_NAVIGATION, undefined)
const open = (url: string, pane: PaneType | false) => {
  if (fileNavigation?.(url)) return
  const target = parseNodeRepositoryLink(url)
  if (target) void openNodeRepositoryTarget(GlobalStore.getInstance().app, target, pane)
}
const source = props.source
const search = source
  ? useTabSearch({
      root: toRef(props, 'root'),
      shown: computed<GithubTarget>(() => ({
        host: props.file.host,
        owner: props.file.owner,
        repo: props.file.repo,
        kind: 'blob',
        rest: [props.file.ref, ...props.file.path.split('/')],
      })),
      data: () => ({ ...props.file, text: props.text }),
      files: useLoad<FilesData>(async () => ({ files: [] }) as FilesData),
      // All lookups use the supplied repository source, as in the node repository tab.
      client: () => undefined,
      source: () => source,
      open,
    })
  : undefined
async function showFind() {
  // A changed file starts as a folded comparison. Find searches its whole file instead.
  emit('find')
  findOpen.value = true
  await nextTick()
  finder.value?.focus()
}
function keydown(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return
  event.preventDefault()
  event.stopPropagation()
  if (event.shiftKey) search?.openSearch()
  else void showFind()
}
watch(
  () => props.root,
  (root, previous) => {
    previous?.removeEventListener('keydown', keydown)
    root?.addEventListener('keydown', keydown)
  },
  { immediate: true }
)
onBeforeUnmount(() => props.root?.removeEventListener('keydown', keydown))
</script>
