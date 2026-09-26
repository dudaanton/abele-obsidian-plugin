<template>
  <div class="abele-note-picker">
    <div v-if="picked.length" class="abele-note-picker__picked">
      <div
        v-for="file in picked"
        :key="file.path"
        class="multi-select-pill abele-note-picker__pill"
        :data-path="file.path"
      >
        <div class="multi-select-pill-content abele-note-picker__pill-content">
          <span class="abele-note-picker__title">{{ titleOf(app, file) }}</span>
          <span v-if="folderOf(file)" class="abele-note-picker__folder">{{ folderOf(file) }}</span>
        </div>
        <Icon
          icon="x"
          tooltip="Take this note out"
          class="multi-select-pill-remove-button abele-note-picker__remove"
          @click="remove(file.path)"
        />
      </div>
    </div>
    <Search
      :model-value="''"
      :placeholder="fieldPlaceholder"
      :make-suggest="makeSuggest"
      :disabled="disabled"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { TFile, type EventRef, type TAbstractFile } from 'obsidian'
import Icon from './Icon.vue'
import Search from './Search.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { FilteredNoteSuggest } from '@/helpers/suggesters/FilteredNoteSuggest'
import {
  createPickedNote,
  folderOf,
  titleOf,
  type NoteFilter,
  type NotePick,
} from '@/helpers/noteFilter'

/**
 * Choosing notes out of a filtered part of the vault — the wallets, the people, the notes of
 * one project — by typing, as in the quick switcher. What is chosen stands above the field as
 * Obsidian's own pills, title and folder, each with a way to take it out. `modelValue` is the
 * chosen notes' paths; with `multiple` unset a new pick replaces the one before.
 */
const props = defineProps<{
  modelValue: string[]
  filter?: NoteFilter
  multiple?: boolean
  /** Offer to make a note of a name nothing matches, inside the filter. */
  create?: boolean
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:model-value', value: string[]): void
}>()

const { app } = GlobalStore.getInstance()

/**
 * Kept here as well as in the parent, because the suggester asks what is taken the moment a pick
 * lands — before the parent has had a chance to pass the new list back down.
 */
const paths = ref<string[]>([...props.modelValue])
watch(
  () => props.modelValue,
  (value) => {
    paths.value = [...value]
  }
)

/** Re-read whenever a note is renamed or its title changes, which `version` stands for. */
const version = ref(0)
const picked = computed<TFile[]>(() => {
  void version.value
  return paths.value
    .map((p) => app.vault.getAbstractFileByPath(p))
    .filter((f): f is TFile => f instanceof TFile)
})

/** A chosen note renamed while the field is up is still the chosen note, under its new path. */
const refs: Array<[{ offref(ref: EventRef): void }, EventRef]> = [
  [
    app.vault,
    app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (paths.value.includes(oldPath)) {
        commit(paths.value.map((p) => (p === oldPath ? file.path : p)))
      }
      version.value++
    }),
  ],
  [app.metadataCache, app.metadataCache.on('changed', () => version.value++)],
]
onBeforeUnmount(() => {
  for (const [source, ref] of refs) source.offref(ref)
})

const fieldPlaceholder = computed(() => {
  if (props.placeholder) return props.placeholder
  if (picked.value.length && !props.multiple) return 'Pick another note…'
  return props.multiple && picked.value.length ? 'Add a note…' : 'Find a note…'
})

function commit(next: string[]) {
  paths.value = next
  emit('update:model-value', next)
}

async function take(pick: NotePick) {
  const file = 'create' in pick ? await createPickedNote(app, pick.create, props.filter) : pick.file
  version.value++
  commit(props.multiple ? [...paths.value.filter((p) => p !== file.path), file.path] : [file.path])
}

function remove(path: string) {
  commit(paths.value.filter((p) => p !== path))
}

const makeSuggest = (inputEl: HTMLInputElement) =>
  new FilteredNoteSuggest(app, inputEl, {
    filter: props.filter,
    create: props.create,
    taken: () => new Set(paths.value),
    keepOpen: props.multiple,
    onPick: (pick) => void take(pick),
  })
</script>

<style lang="scss">
.abele-note-picker {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
}

.abele-note-picker__picked {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
}

// Obsidian's pill is sized for one word in a property; a note's title with its folder beside it
// is longer, so it may wrap inside the pill rather than push the row past the field's edge.
.abele-note-picker__pill {
  max-width: 100%;
  height: auto;
}

.abele-note-picker__pill-content {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--size-4-1);
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

.abele-note-picker__folder {
  color: var(--text-faint);
  font-size: var(--font-smallest);
}

.abele-note-picker__remove {
  flex: 0 0 auto;
}
</style>
