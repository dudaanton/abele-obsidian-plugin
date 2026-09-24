<template>
  <section class="abele-github-search" data-find-skip>
    <div class="abele-github-search__bar">
      <Input
        ref="inputRef"
        v-model="query"
        class="abele-github-search__query"
        :placeholder="scope === 'names' ? 'File name' : 'Search code'"
        aria-label="What to search for"
        @keydown="onKey"
      />
      <div class="abele-github-search__toggles">
        <Icon
          v-if="scope !== 'names'"
          icon="case-sensitive"
          :active="caseSensitive"
          tooltip="Match letter case"
          @click="caseSensitive = !caseSensitive"
        />
        <Icon
          v-if="scope !== 'names'"
          icon="whole-word"
          :active="wholeWord"
          tooltip="Match whole words only"
          @click="wholeWord = !wholeWord"
        />
        <Icon
          v-if="scope !== 'names'"
          icon="regex"
          :active="regex"
          tooltip="Read the query as a regular expression"
          @click="regex = !regex"
        />
        <Icon icon="x" tooltip="Close code search" @click="emit('close')" />
      </div>
    </div>

    <div class="abele-github-search__options">
      <Dropdown v-model="scope" :options="scopes" class="abele-github-search__scope" />
      <Input
        v-if="scope !== 'names'"
        v-model="glob"
        class="abele-github-search__glob"
        placeholder="In files like src/**/*.ts"
        aria-label="Only in files matching"
        @keydown="onKey"
      />
      <Button
        text="Search"
        icon="search"
        :disabled="running || !ready || !query.trim()"
        :tooltip="
          running
            ? 'A search is running'
            : !ready
              ? 'Waiting for the tab to load'
              : 'Search with these settings'
        "
        @click="run"
      />
    </div>

    <div v-if="running" class="abele-github-search__progress">
      <span>{{ stageText }}</span>
      <Button
        text="Cancel"
        tooltip="Stop waiting for this search. A download already started finishes and is kept for the next one."
        @click="cancel"
      />
    </div>
    <div v-else-if="error" class="abele-github-search__error">{{ error }}</div>
    <template v-else-if="results">
      <div v-if="results.note" class="abele-github-search__note">{{ results.note }}</div>
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
    </template>
  </section>
</template>

<script setup lang="ts">
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
    code: TabCode
    /** Whether the tab has changes of its own to search: a pull request or a commit. */
    hasChanges?: boolean
    request?: SearchRequest | null
    /** The tab's item has loaded, so which commit to search is known. */
    ready?: boolean
  }>(),
  { hasChanges: false, request: null, ready: true }
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
let abort: AbortController | null = null

const scopes = computed(() => [
  ...(props.hasChanges ? [{ value: 'changes', display: 'Only the changed files' }] : []),
  { value: 'repo', display: `Whole repository at ${props.code.refLabel()}` },
  { value: 'names', display: `File names at ${props.code.refLabel()}` },
])

const summary = computed(() => {
  const r = results.value
  if (!r) return ''
  const files = r.files.length
  if (scope.value === 'names') {
    if (!files) return 'No file has a name like that.'
    return `${files}${r.capped ? '+' : ''} ${files === 1 ? 'file' : 'files'}`
  }
  if (!files) return 'Nothing found.'
  const lines = r.files.reduce((n, f) => n + f.lines.length, 0)
  const shown = `${lines} ${lines === 1 ? 'line' : 'lines'} in ${files} ${files === 1 ? 'file' : 'files'}`
  return r.capped ? `${shown} — the first of more; narrow the search to see the rest.` : shown
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
  const text = query.value.trim()
  if (!text || !props.ready) return
  abort?.abort()
  const mine = (abort = new AbortController())
  running.value = true
  error.value = ''
  stageText.value = 'Searching…'
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
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (abort === mine) {
      running.value = false
      abort = null
    }
  }
}

const cancel = () => {
  abort?.abort()
  abort = null
  running.value = false
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

// A file name is found as it is typed: the list is one request, made once.
let nameTimer = 0
watch([query, scope], () => {
  if (scope.value !== 'names') return
  window.clearTimeout(nameTimer)
  nameTimer = window.setTimeout((): void => void run(), 250)
})

// A search asked for before the item loaded runs once it has.
watch(
  () => props.ready,
  (ready) => {
    if (ready && props.request && !results.value && !running.value) void run()
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
  const el = inputRef.value?.$el as HTMLInputElement | undefined
  el?.focus()
  el?.select()
}

onMounted(() => {
  if (!props.request) focus()
})
onBeforeUnmount(() => {
  window.clearTimeout(nameTimer)
  abort?.abort()
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
    background-color: var(--text-highlight-bg);
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
