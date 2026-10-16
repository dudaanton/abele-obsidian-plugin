<template>
  <div class="abele-scope-editor">
    <Setting
      name="Full vault access"
      :desc="
        fullVaultAccess
          ? 'The agent may read and change every file in the vault.'
          : 'The agent sees only what is listed below.'
      "
    >
      <Checkbox
        :is-enabled="fullVaultAccess"
        @toggle="emit('update:fullVaultAccess', !fullVaultAccess)"
      />
    </Setting>

    <template v-if="!fullVaultAccess">
      <Progress v-if="loadingCounts" label="Counting group members" />
      <EmptyState v-if="lookupError" :text="lookupError" />
      <!-- What the agent may reach, first: each place by its glyph, a group by how many notes
           it holds and open to show them, removed under the pointer. -->
      <div class="abele-scope-mgr__entries" role="list" aria-label="What the agent can reach">
        <template v-for="entry in entries" :key="`${entry.type}:${entry.path}`">
          <div
            class="abele-scope-mgr__entry"
            :class="{ 'abele-scope-mgr__entry_group': entry.type === 'group' }"
            role="listitem"
            :tabindex="entry.type === 'group' ? 0 : undefined"
            :aria-expanded="entry.type === 'group' ? previewEntry?.path === entry.path : undefined"
            @click="togglePreview(entry)"
            @keydown.enter="togglePreview(entry)"
          >
            <Icon :icon="entryIcon(entry.type)" />
            <span class="abele-scope-mgr__entry-path">{{ entry.path }}</span>
            <span v-if="entry.type === 'group'" class="abele-scope-mgr__entry-type">
              {{ groupCounts.get(entry.path) ?? '…' }}
            </span>
            <Icon
              class="abele-scope-mgr__entry-remove"
              icon="x"
              :tooltip="`Remove ${entry.path} from scope`"
              @click.stop="removeEntry(entry)"
            />
          </div>
          <div
            v-if="previewEntry && previewEntry.path === entry.path"
            class="abele-scope-mgr__preview"
          >
            <Progress v-if="loadingPreview" label="Loading group members" />
            <div
              v-for="p in previewPaths.slice(0, previewLimit)"
              :key="p"
              class="abele-scope-mgr__preview-item"
            >
              {{ p }}
            </div>
            <Button
              v-if="previewPaths.length > previewLimit"
              text="Show more"
              @click="previewLimit += 100"
            />
          </div>
        </template>
        <EmptyState v-if="!entries.length" text="Nothing yet: the agent sees no files." />
      </div>

      <!-- One field adds any kind of place, as the quick switcher mixes its kinds: the open
           note first, a pattern once the text has a * in it, then folders, groups and files,
           each by its glyph with its kind in a word. -->
      <Search
        class="abele-scope-mgr__field"
        model-value=""
        label="Add to what the agent can reach"
        placeholder="Add a note, folder, group or pattern…"
        :make-suggest="suggestPlace"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Search from './obsidian/Search.vue'
import Setting from './obsidian/Setting.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Icon from './obsidian/Icon.vue'
import Progress from './obsidian/Progress.vue'
import Button from './obsidian/Button.vue'
import { ScopeSuggest } from '@/helpers/suggesters/ScopeSuggest'
import { ScopeResolver } from '@/ai/ScopeResolver'
import type { ScopeEntry } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'

const props = withDefaults(
  defineProps<{
    entries: ScopeEntry[]
    fullVaultAccess: boolean
  }>(),
  {}
)

const emit = defineEmits<{
  (e: 'update:entries', entries: ScopeEntry[]): void
  (e: 'update:fullVaultAccess', value: boolean): void
}>()

const { app } = GlobalStore.getInstance()

const previewEntry = ref<ScopeEntry | null>(null)

const addEntry = (entry: ScopeEntry) => {
  if (props.entries.some((e) => e.type === entry.type && e.path === entry.path)) return
  emit('update:entries', [...props.entries, entry])
}

const removeEntry = (entry: ScopeEntry) => {
  emit(
    'update:entries',
    props.entries.filter((e) => !(e.type === entry.type && e.path === entry.path))
  )
  if (previewEntry.value?.path === entry.path) previewEntry.value = null
}

const suggestPlace = (input: HTMLInputElement) =>
  new ScopeSuggest(app, input, () => props.entries, addEntry)

const resolver = ScopeResolver.getInstance()
const groupCounts = ref(new Map<string, number>())
const loadingCounts = ref(false)
const loadingPreview = ref(false)
const lookupError = ref('')
const previewPaths = ref<string[]>([])
const previewLimit = ref(100)

watch(
  () => [
    props.fullVaultAccess,
    props.entries.map((e) => `${e.type}:${e.path}`).join('\n'),
    resolver.groupVersion.value,
  ],
  async (_value, _old, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    groupCounts.value = new Map()
    lookupError.value = ''
    const paths = props.fullVaultAccess
      ? []
      : props.entries.filter((e) => e.type === 'group').map((e) => e.path)
    loadingCounts.value = paths.length > 0
    if (!paths.length) return
    try {
      const counts = await resolver.groupCountsAsync(paths, controller.signal)
      if (!controller.signal.aborted) groupCounts.value = counts
    } catch (error) {
      if (!controller.signal.aborted && (error as Error).name !== 'AbortError') {
        console.debug('[scope] Group counts failed', error)
        lookupError.value = 'Could not count group members. Reopen Access to try again.'
      }
    } finally {
      if (!controller.signal.aborted) loadingCounts.value = false
    }
  },
  { immediate: true }
)

const entryIcon = (type: string) => {
  switch (type) {
    case 'file':
      return 'file-text'
    case 'folder':
      return 'folder'
    case 'group':
      return 'users'
    default:
      return 'regex'
  }
}

watch(
  () => [previewEntry.value?.path, props.fullVaultAccess, resolver.groupVersion.value],
  async (_value, _old, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    previewPaths.value = []
    previewLimit.value = 100
    loadingPreview.value = !!previewEntry.value && !props.fullVaultAccess
    if (!loadingPreview.value) return
    try {
      const paths = await resolver.resolveGroupPathsAsync(
        previewEntry.value.path,
        controller.signal
      )
      if (!controller.signal.aborted) previewPaths.value = paths
    } catch (error) {
      if (!controller.signal.aborted && (error as Error).name !== 'AbortError') {
        console.debug('[scope] Group preview failed', error)
        lookupError.value = 'Could not load group members. Close and reopen the group to try again.'
      }
    } finally {
      if (!controller.signal.aborted) loadingPreview.value = false
    }
  }
)

const togglePreview = (entry: ScopeEntry) => {
  if (entry.type !== 'group') {
    previewEntry.value = null
    return
  }
  previewEntry.value = previewEntry.value?.path === entry.path ? null : entry
}
</script>

<style lang="scss">
.abele-scope-editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

/* The places as rows of a tree, as the file explorer lists them. */
.abele-scope-mgr__entries {
  display: flex;
  flex-direction: column;

  &:empty {
    display: none;
  }

  .abele-empty-state {
    padding: var(--size-2-2) 0;
  }
}

.abele-scope-mgr__entry {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  min-height: var(--input-height);
  padding: 0 var(--size-4-1) 0 var(--size-4-2);
  border-radius: var(--radius-s);
  color: var(--nav-item-color);
  font-size: var(--nav-item-size);

  &:hover {
    background-color: var(--nav-item-background-hover);
    color: var(--nav-item-color-hover);
  }

  .abele-obsidian-icon:first-child {
    color: var(--text-faint);
  }
}

.abele-scope-mgr__entry_group {
  cursor: var(--cursor);
}

.abele-scope-mgr__entry-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-scope-mgr__entry-type {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}

.abele-scope-mgr__entry-remove {
  opacity: 0;
}

.abele-scope-mgr__entry:hover .abele-scope-mgr__entry-remove,
.abele-scope-mgr__entry-remove:focus-visible,
body.is-mobile .abele-scope-mgr__entry-remove {
  opacity: 1;
}

/* A group's notes under it, indented as a folder's children. */
.abele-scope-mgr__preview {
  margin-inline-start: var(--size-4-4);
  padding-inline-start: var(--size-4-4);
  border-inline-start: var(--nav-indentation-guide-width) solid var(--nav-indentation-guide-color);
  font-size: var(--font-ui-smaller);
}

.abele-scope-mgr__preview-item {
  padding: var(--size-2-1) 0;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-scope-mgr__field {
  min-width: 0;

  input {
    width: 100%;
  }
}
.abele-scope-suggest__kind {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
</style>
