<template>
  <div class="abele-folder-picker" @keydown="onKey">
    <Input
      ref="field"
      v-model="query"
      icon="folder-search"
      class="abele-folder-picker__path"
      placeholder="~/"
      :invalid="!!listing.error"
      :aria-label="t('streamB.folderPath.98bca2')"
      autocomplete="off"
      spellcheck="false"
      aria-controls="abele-folder-picker-list"
    />
    <div v-if="listing.error" class="abele-folder-picker__error" role="alert">
      <NodeErrorText :error="listing.error" />
    </div>

    <div
      id="abele-folder-picker-list"
      class="abele-folder-picker__list"
      role="listbox"
      :aria-label="t('streamB.foldersIn.442bd6', { v0: String(dir) })"
    >
      <div
        v-for="(row, i) in rows"
        :key="row.path"
        class="abele-folder-picker__row"
        :class="{
          'is-selected': keyboard && i === index,
          'abele-folder-picker__row_up': row.up,
          'abele-folder-picker__row_create': row.create,
        }"
        role="option"
        :aria-selected="i === index"
        @click="row.create ? emit('create', row.path) : go(row.path)"
      >
        <span class="abele-folder-picker__icon"
          ><Icon
            :icon="
              row.create
                ? 'folder-plus'
                : row.up
                  ? 'corner-left-up'
                  : row.git
                    ? 'folder-git-2'
                    : 'folder'
            "
            size="xs"
            :interactive="false"
        /></span>
        <span class="abele-folder-picker__name">{{
          row.up
            ? '..'
            : row.create
              ? t('streamB.newFolder.98de54', { v0: String(row.name) })
              : row.name
        }}</span>
        <span v-if="row.git" class="abele-folder-picker__branch">{{ row.git.branch }}</span>
        <StatusDot v-if="row.open" tone="accent" :label="t('streamB.alreadyOpen.390a95')" />
      </div>
      <div v-if="!rows.length && !listing.error" class="abele-folder-picker__empty">
        {{ t('streamB.noFoldersHereTypeANameTo.186077') }}
      </div>
    </div>

    <div class="abele-folder-picker__preview" aria-live="polite">
      <template v-if="target && !listing.error">
        <Icon
          :icon="target.create ? 'folder-plus' : target.git ? 'folder-git-2' : 'folder'"
          size="xs"
          :interactive="false"
        />
        <span class="abele-folder-picker__preview-path">{{ target.path }}</span>
        <span class="abele-folder-picker__preview-facts">{{ facts(target) }}</span>
      </template>
    </div>

    <div class="modal-button-container">
      <Button
        :text="t('streamB.cancel.19766e')"
        :tooltip="t('streamB.closeWithoutOpening.6ac107')"
        @click="emit('cancel')"
      />
      <Button
        v-if="target?.open"
        :text="t('streamB.show.0df6f1')"
        accent
        :tooltip="t('streamB.showThisFolderInTheNodePanel.956b62')"
        @click="emit('show', target.path)"
      />
      <Button
        v-else-if="target?.create"
        :text="t('streamB.create.475949')"
        accent
        :tooltip="t('streamB.makeThisFolderOnTheNodeAnd.2f40a6')"
        @click="emit('create', target.path)"
      />
      <Button
        v-else
        :text="t('streamB.open.ed077f')"
        accent
        :disabled="!target || !!listing.error"
        :tooltip="t('streamB.openThisFolderInAbele.ffbcdf')"
        @click="target && emit('open', target.path)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { streamBCount } from '@/i18n/streamBCounts'
import { t } from '@/i18n'
// Choosing a folder on the node: a path field over the folders it leads to, the way Obsidian's
// own pickers put the input over the list. Typing filters and completes, arrows move, Enter goes
// into the highlighted folder, Backspace on an empty segment goes up. The line under the list
// says what the folder is before it is opened.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import Input from '../obsidian/Input.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import type { NodeDirectory } from './types'

const props = withDefaults(
  defineProps<{
    /** Lists the folders in a folder of the node, or says why it cannot. */
    browse: (
      dir: string
    ) => { entries: NodeDirectory[]; error?: undefined } | { entries?: undefined; error: string }
    /** Where the dialog starts. */
    start?: string
  }>(),
  { start: '~/' }
)

const emit = defineEmits<{
  (e: 'open', path: string): void
  (e: 'show', path: string): void
  (e: 'create', path: string): void
  (e: 'cancel'): void
}>()

const query = ref(props.start)
const index = ref(0)
// The highlight shows only once the arrows are used; the pointer marks rows by hover alone.
const keyboard = ref(false)
const field = ref<InstanceType<typeof Input>>()

// The folder being listed is everything up to the last slash; the rest filters it.
const dir = computed(() => query.value.slice(0, query.value.lastIndexOf('/') + 1) || '/')
const filter = computed(() => query.value.slice(query.value.lastIndexOf('/') + 1).toLowerCase())
const listing = computed(() => props.browse(dir.value))
const parent = computed(() => {
  const trimmed = dir.value.replace(/\/$/, '')
  const cut = trimmed.lastIndexOf('/')
  return cut < 0 || trimmed === '~' || trimmed === '' ? null : trimmed.slice(0, cut + 1)
})

interface Row extends NodeDirectory {
  up?: boolean
  /** Not there yet: picking it makes the folder. */
  create?: boolean
}
const rows = computed<Row[]>(() => {
  const found = (listing.value.entries ?? []).filter((e) =>
    e.name.toLowerCase().startsWith(filter.value)
  )
  // A name that is no folder here yet is offered as a new one, the way the quick switcher
  // offers to create a note.
  const raw = query.value.slice(query.value.lastIndexOf('/') + 1).trim()
  const fresh =
    raw && !/[\\:*?"<>|]/.test(raw) && listing.value.entries && !found.length
      ? [{ name: raw, path: `${dir.value}${raw}`, create: true }]
      : []
  return !filter.value && parent.value
    ? [{ name: '..', path: parent.value, up: true }, ...found]
    : [...found, ...fresh]
})
watch(
  rows,
  () => {
    // The keyboard highlight starts again on the first folder after the list changes.
    index.value = rows.value[0]?.up && rows.value.length > 1 ? 1 : 0
  },
  { immediate: true }
)

// What Open opens: the folder one stands in. Described under the list at all times, so the
// line never comes and goes and the dialog keeps its height.
const target = computed<Row | null>(() => {
  // A name typed down to one folder means that folder; a name of none, a new one.
  const only = rows.value.filter((r) => !r.up && !r.create)
  if (filter.value && only.length === 1) return only[0]
  const fresh = rows.value.find((r) => r.create)
  if (fresh && !only.length) return fresh
  const path = dir.value.replace(/\/$/, '')
  if (!path || path === '~') return null
  const known = parent.value
    ? props.browse(parent.value).entries?.find((e) => e.path === path)
    : undefined
  return known ?? { name: path.slice(path.lastIndexOf('/') + 1), path, inspected: false }
})

const facts = (d: Row) =>
  d.create
    ? t('streamB.newFolder.cf28f4')
    : d.inspected === false
      ? t('streamB.folderOnTheNodeInspectedWhenOpened.1d38f2')
      : d.git
        ? t('streamB.gitRepository.7012e9', {
            v0: String(d.git.branch),
            v1: String(d.git.copies > 1 ? ` · ${streamBCount(d.git.copies, 'copy')}` : ''),
          })
        : t('streamB.plainFolderFilesOnly.94ca51')

function go(path: string) {
  query.value = path.endsWith('/') ? path : `${path}/`
  void nextTick(() => field.value?.inputRef?.focus())
}

const choose = (translationItem: Row) =>
  emit(
    translationItem.create ? 'create' : translationItem.open ? 'show' : 'open',
    translationItem.path
  )

function onKey(e: KeyboardEvent) {
  const row = rows.value[index.value]
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    keyboard.value = true
    const n = rows.value.length || 1
    index.value = (index.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
  } else if (e.key === 'Tab' && row && !e.shiftKey && filter.value) {
    e.preventDefault()
    go(row.path)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (e.metaKey || e.ctrlKey) {
      if (target.value) choose(target.value)
    } else if (row && keyboard.value) row.create ? emit('create', row.path) : go(row.path)
    else if (target.value) choose(target.value)
  } else if (e.key === 'Backspace' && !filter.value && parent.value) {
    e.preventDefault()
    go(parent.value)
  }
}

onMounted(() => window.setTimeout(() => field.value?.inputRef?.focus()))
</script>

<style lang="scss">
.abele-folder-picker {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}
.abele-folder-picker__error {
  color: var(--text-error);
  font-size: var(--font-ui-smaller);
}

// The list is a suggestion list: rows the height of Obsidian's suggestions, the highlight its own.
.abele-folder-picker__list {
  display: flex;
  flex-direction: column;
  height: calc(var(--size-4-8) * 8);
  overflow-y: auto;
  padding: var(--size-4-1);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-m);
}
.abele-folder-picker__row {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-2);
  border-radius: var(--radius-s);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  cursor: var(--cursor);

  &:hover,
  &.is-selected {
    background-color: var(--background-modifier-hover);
  }
}
body.is-phone .abele-folder-picker__row {
  min-height: var(--touch-size-m);
}
.abele-folder-picker__row_create {
  color: var(--text-accent);

  .abele-folder-picker__icon {
    color: inherit;
  }
}
.abele-folder-picker__row_up {
  color: var(--text-muted);
}
.abele-folder-picker__icon {
  display: flex;
  color: var(--icon-color);

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-folder-picker__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-folder-picker__branch {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
.abele-folder-picker__empty {
  padding: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

// What will be opened, in one line under the list.
.abele-folder-picker__preview {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  min-height: calc(var(--font-ui-smaller) * var(--line-height-normal));
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-folder-picker__preview-path {
  min-width: 0;
  overflow: hidden;
  color: var(--text-normal);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-folder-picker__preview-facts {
  flex: 0 0 auto;
}
.abele-folder-picker .modal-button-container {
  margin-top: var(--size-4-2);
}

// A desktop dialog is as tall as the list and its buttons, the way Obsidian's own pickers are. On
// a phone it is their sheet, the height of the screen: the list takes the room the field, the line
// and the buttons leave, and the buttons stand at the bottom of the sheet, not half way up it.
body.is-phone .modal.mod-lg .abele-folder-picker-dialog {
  display: flex;
  flex-direction: column;
  height: 100%;
}
body.is-phone .modal.mod-lg .abele-folder-picker {
  flex: 1 1 0;
  min-height: 0;
}
// From nothing, not from its rows: grown from all of them it pushed the buttons off the screen.
body.is-phone .modal.mod-lg .abele-folder-picker__list {
  flex: 1 1 0;
  height: auto;
  min-height: calc(var(--touch-size-m) * 4);
}
</style>
