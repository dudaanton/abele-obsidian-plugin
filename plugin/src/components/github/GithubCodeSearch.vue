<template>
  <section class="abele-github-search" data-find-skip>
    <div class="abele-github-search__bar">
      <Input
        ref="inputRef"
        v-model="query"
        class="abele-github-search__query"
        :placeholder="
          scope === 'names' ? t('streamB.fileName.3efed3') : t('streamB.searchCode.c33868')
        "
        :aria-label="t('streamB.whatToSearchFor.f03868')"
        @keydown="onKey"
      />
      <div class="abele-github-search__toggles">
        <Icon
          v-if="scope !== 'names'"
          icon="case-sensitive"
          :active="caseSensitive"
          :tooltip="t('streamB.matchLetterCase.25489d')"
          @click="caseSensitive = !caseSensitive"
        />
        <Icon
          v-if="scope !== 'names'"
          icon="whole-word"
          :active="wholeWord"
          :tooltip="t('streamB.matchWholeWordsOnly.2a7c87')"
          @click="wholeWord = !wholeWord"
        />
        <Icon
          v-if="scope !== 'names'"
          icon="regex"
          :active="regex"
          :tooltip="t('streamB.readTheQueryAsARegularExpression.917119')"
          @click="regex = !regex"
        />
        <Icon icon="x" :tooltip="t('streamB.closeCodeSearch.22b261')" @click="emit('close')" />
      </div>
    </div>

    <div class="abele-github-search__options">
      <Dropdown v-model="scope" :options="scopes" class="abele-github-search__scope" />
      <Input
        v-if="scope !== 'names'"
        v-model="glob"
        class="abele-github-search__glob"
        :placeholder="t('streamB.inFilesLikeSrcTs.feb03e')"
        :aria-label="t('streamB.onlyInFilesMatching.d5d937')"
        @keydown="onKey"
      />
      <Button
        :text="t('streamB.search.49c266')"
        icon="search"
        :disabled="running || !ready || !query.trim()"
        :tooltip="
          running
            ? t('streamB.aSearchIsRunning.c94c40')
            : !ready
              ? t('streamB.waitingForTheTabToLoad.fa689d')
              : t('streamB.searchWithTheseSettings.43d86f')
        "
        @click="run"
      />
    </div>

    <div v-if="running" class="abele-github-search__progress">
      <span>{{ stageText }}</span>
      <Button
        :text="t('streamB.cancel.19766e')"
        :tooltip="t('streamB.stopWaitingForThisSearchADownload.2cb523')"
        @click="cancel"
      />
    </div>
    <div v-else-if="error" class="abele-github-search__error">{{ presentUiError(error) }}</div>
    <template v-if="results && !running">
      <div v-if="results.note" class="abele-github-search__note">
        {{ presentUiField(results, 'note') }}
      </div>
      <div class="abele-github-search__summary">{{ summary }}</div>
      <div class="abele-github-search__results">
        <div v-for="file in results.files" :key="file.path" class="abele-github-search__file">
          <div
            class="abele-github-search__path"
            role="button"
            tabindex="0"
            @click="open(file.url, $event)"
            @keydown.enter="open(file.url, $event)"
          >
            <span>{{ file.path }}</span>
            <Badge v-if="file.lines.length" :text="String(file.lines.length)" />
          </div>
          <div
            v-for="(line, i) in file.lines"
            :key="i"
            class="abele-github-search__line"
            role="button"
            tabindex="0"
            @click="open(line.url, $event)"
            @keydown.enter="open(line.url, $event)"
          >
            <span class="abele-github-search__number">{{ line.label }}</span>
            <code class="abele-github-search__text"
              >{{ parts(line).before
              }}<mark class="abele-github-search__match">{{ parts(line).match }}</mark
              >{{ parts(line).after }}</code
            >
          </div>
        </div>
      </div>
      <Button
        v-if="results.next"
        :text="t('repository.loadMoreResults')"
        :loading="loadingMore"
        :disabled="loadingMore"
        @click="more"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { streamBLabel } from '@/i18n/streamBLabels'
import { presentUiField, presentUiError } from '@/i18n/streamBErrors'
import { streamBWord } from '@/i18n/streamBCounts'

import { t } from '@/i18n'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Keymap } from 'obsidian'
import Input from '../obsidian/Input.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import Badge from '../obsidian/Badge.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import {
  STAGE_TEXT,
  type CodeResults,
  type ResultLine,
  type Scope,
  type TabCode,
} from '@/github/search/tabCode'

/** A search asked for from elsewhere — "Find references" — with a nonce so the same one reruns. */
export interface SearchRequest {
  text: string
  wholeWord?: boolean
  caseSensitive?: boolean
  scope?: Scope
  nonce: number
}

const props = withDefaults(
  defineProps<{
    code: Pick<TabCode, 'refLabel' | 'search'>
    /** Whether the tab has changes of its own to search: a pull request or a commit. */
    hasChanges?: boolean
    request?: SearchRequest | null
    /** The tab's item has loaded, so which commit to search is known. */
    ready?: boolean
    /** Only supplied for live node observations; frozen searches never follow invalidations. */
    revisionKey?: string
  }>(),
  { hasChanges: false, request: null, ready: true, revisionKey: undefined }
)

const emit = defineEmits<{
  (e: 'open', url: string, newTab: boolean): void
  (e: 'close'): void
}>()

const inputRef = ref<InstanceType<typeof Input>>()
const query = ref('')
const glob = ref('')
const caseSensitive = ref(false)
const wholeWord = ref(false)
const regex = ref(false)
const scope = ref<Scope>(props.hasChanges ? 'changes' : 'repo')
const running = ref(false)
const stageText = ref('')
const error = ref('')
const results = ref<CodeResults | null>(null)
const loadingMore = ref(false)
const more = async () => {
  const previous = results.value
  if (!previous?.next || loadingMore.value) return
  const key = queryKey()
  loadingMore.value = true
  error.value = ''
  try {
    const next = await previous.next()
    if (results.value === previous && queryKey() === key) results.value = next
  } catch (e) {
    if (results.value === previous && queryKey() === key) error.value = presentUiError(e)
  } finally {
    loadingMore.value = false
  }
}
let abort: AbortController | null = null
/** Enter was pressed before the tab's item loaded: the search runs once it has. */
let pending = false
let livePending = false
let lastQuery = ''
const queryKey = () =>
  JSON.stringify([
    query.value.trim(),
    scope.value,
    glob.value,
    caseSensitive.value,
    wholeWord.value,
    regex.value,
  ])

const scopes = computed(() => [
  ...(props.hasChanges
    ? [{ value: 'changes', display: t('streamB.onlyTheChangedFiles.308397') }]
    : []),
  {
    value: 'repo',
    display: t('streamB.wholeRepositoryAt.3217d1', {
      v0: String(streamBLabel(props.code.refLabel())),
    }),
  },
  {
    value: 'names',
    display: t('streamB.fileNamesAt.cec59e', { v0: String(streamBLabel(props.code.refLabel())) }),
  },
])

const summary = computed(() => {
  const r = results.value
  if (!r) return ''
  const files = r.files.length
  if (scope.value === 'names') {
    if (!files) return t('streamB.noFileHasANameLikeThat.6774e4')
    return `${files}${r.capped ? '+' : ''} ${streamBWord(files, 'file')}`
  }
  if (!files) return t('streamB.nothingFound.eb1fa1')
  const lines = r.files.reduce((n, f) => n + f.lines.length, 0)
  const shown = t('streamB.in.e099b7', {
    v0: String(lines),
    v1: String(streamBWord(lines, 'line')),
    v2: String(files),
    v3: String(streamBWord(files, 'file')),
  })
  return r.capped ? t('streamB.theFirstOfMoreNarrowTheSearch.712c6f', { v0: String(shown) }) : shown
})

const parts = (line: ResultLine) => {
  if (line.column < 0 || !line.length) return { before: line.text, match: '', after: '' }
  return {
    before: line.text.slice(0, line.column),
    match: line.text.slice(line.column, line.column + line.length),
    after: line.text.slice(line.column + line.length),
  }
}

const run = async () => {
  window.clearTimeout(nameTimer)
  const text = query.value.trim()
  if (!text) return
  if (!props.ready) {
    pending = true
    return
  }
  pending = false
  livePending = false
  lastQuery = queryKey()
  abort?.abort()
  const mine = (abort = new AbortController())
  running.value = true
  error.value = ''
  stageText.value = t('streamB.searching.c31723')
  try {
    const found = await props.code.search(
      scope.value,
      { text, caseSensitive: caseSensitive.value, regex: regex.value, wholeWord: wholeWord.value },
      glob.value,
      (stage) => {
        if (abort === mine) stageText.value = STAGE_TEXT[stage]
      },
      mine.signal
    )
    if (abort !== mine) return
    results.value = found
  } catch (e) {
    if (abort !== mine) return
    if (e instanceof DOMException && e.name === 'AbortError') return
    console.debug('[Abele] code search failed', e)
    results.value = null
    error.value = presentUiError(e)
  } finally {
    if (abort === mine) {
      running.value = false
      abort = null
      const rerun = livePending && lastQuery === queryKey()
      livePending = false
      if (rerun) void run()
    }
  }
}

watch(
  () => props.revisionKey,
  (next, previous) => {
    if (!next || !previous || next === previous || !lastQuery || lastQuery !== queryKey()) return
    if (running.value) livePending = true
    else if (results.value) void run()
  }
)

const cancel = () => {
  abort?.abort()
  abort = null
  running.value = false
  livePending = false
}

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    void run()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}

const open = (url: string, e: MouseEvent | KeyboardEvent) =>
  emit('open', url, !!Keymap.isModEvent(e))

// The tab followed a result to a file, which changed nothing of its own: the scope that searched
// the change is gone, so the whole repository is searched instead of nothing at all.
watch(
  () => props.hasChanges,
  (has) => {
    if (!has && scope.value === 'changes') scope.value = 'repo'
  }
)

// Debounce edits and cancel stale work immediately, before the next search starts.
let nameTimer = 0
watch([query, scope, glob, caseSensitive, wholeWord, regex], () => {
  window.clearTimeout(nameTimer)
  cancel()
  results.value = null
  error.value = ''
  if (!query.value.trim()) return
  nameTimer = window.setTimeout((): void => void run(), 250)
})

// A search asked for before the item loaded runs once it has.
watch(
  () => props.ready,
  (ready) => {
    if (!ready || running.value) return
    if (pending || (props.request && !results.value)) void run()
  }
)

watch(
  () => props.request?.nonce,
  () => {
    const r = props.request
    if (!r) return
    query.value = r.text
    wholeWord.value = !!r.wholeWord
    caseSensitive.value = !!r.caseSensitive
    regex.value = false
    if (r.scope) scope.value = r.scope
    void run()
  },
  { immediate: true }
)

const focus = () => {
  const el = inputRef.value?.inputRef as HTMLInputElement | undefined
  el?.focus()
  el?.select()
}

onMounted(() => {
  if (!props.request) focus()
})
onBeforeUnmount(() => {
  window.clearTimeout(nameTimer)
  cancel()
})

defineExpose({ focus })
</script>

<style lang="scss">
.abele-github-search {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding: var(--size-4-2);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  background: var(--background-secondary);

  &__bar,
  &__options {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--size-4-2);
  }

  &__query {
    flex: 1 1 12em;
  }

  &__toggles {
    display: flex;
    gap: var(--size-2-1);
    flex-shrink: 0;
  }

  &__glob {
    flex: 1 1 10em;
  }

  &__progress {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  &__error {
    color: var(--text-error);
    font-size: var(--font-ui-small);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  &__note,
  &__summary {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    overflow-wrap: anywhere;
  }

  // A long list scrolls within the panel, so the tab's own content stays a scroll away.
  &__results {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
    max-height: 50vh;
    overflow-y: auto;
  }

  &__file {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-s);
    background: var(--background-primary);
  }

  &__path {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    padding: var(--size-4-1) var(--size-4-2);
    font-family: var(--font-monospace);
    font-size: var(--font-ui-small);
    overflow-wrap: anywhere;
    cursor: var(--cursor-link);
    color: var(--text-accent);
  }

  &__line {
    display: flex;
    gap: var(--size-4-2);
    padding: var(--size-2-1) var(--size-4-2);
    cursor: var(--cursor-link);
  }

  &__path:hover,
  &__line:hover {
    background: var(--background-modifier-hover);
  }

  &__number {
    flex-shrink: 0;
    min-width: 3em;
    color: var(--text-faint);
    font-family: var(--font-monospace);
    font-size: var(--code-size);
    text-align: right;
  }

  &__text {
    min-width: 0;
    background: none;
    font-size: var(--code-size);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  &__match {
    background-color: var(--highlight-background, var(--text-highlight-bg));
    color: inherit;
  }
}

// Go to definition's hint in a code view: the name Mod-click would follow, as an editor shows it.
.abele-github-code .abele-github-code__definition,
.abele-github-code .abele-github-code__definition * {
  text-decoration: underline;
  text-underline-offset: 0.15em;
  color: var(--text-accent);
  cursor: var(--cursor-link);
}
</style>
