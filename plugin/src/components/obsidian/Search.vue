<template>
  <div
    ref="el"
    class="abele-obsidian-search"
    :class="{
      'abele-obsidian-search_disabled': disabled,
      'abele-obsidian-search_filled': !!modelValue,
    }"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { AbstractInputSuggest } from 'obsidian'
import { SearchComponent } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'

const props = defineProps<{
  modelValue: string
  /** Accessible name on the native field rather than the containing div. */
  label?: string
  placeholder?: string
  suggester?: typeof FileSuggest | typeof FolderSuggest
  /** A suggester that needs more than the field to be built — the note picker's filtered one. */
  makeSuggest?: (inputEl: HTMLInputElement) => unknown
  disabled?: boolean
  /** Puts the cursor in the field as it appears — for a field opened by pressing something. */
  autofocus?: boolean
  /** A short result code in the native field's end, instead of its clear control. */
  suffix?: string
  suffixLabel?: string
  /** Optional compatibility/style hook on the result code. */
  suffixClass?: string
}>()

const el = ref<HTMLElement>()
const search = ref<SearchComponent>()
let suggest: { close: () => void } | undefined
const closeSuggest = () => {
  suggest?.close()
  suggest = undefined
}
defineExpose({
  focus: () => search.value?.inputEl.focus(),
  select: () => search.value?.inputEl.select(),
  get inputRef() {
    return search.value?.inputEl
  },
})
onBeforeUnmount(closeSuggest)

const initSearch = () => {
  if (!el.value) return
  // The field owns its suggester, including a custom selection adapter.
  closeSuggest()
  if (search.value) {
    el.value.empty()
    search.value = undefined
  }
  search.value = new SearchComponent(el.value)
  // Obsidian builds the parts; the names are ours, so a snippet can reach each one.
  search.value.inputEl.parentElement?.classList.add('abele-obsidian-search__container')
  search.value.inputEl.classList.add('abele-obsidian-search__base')
  search.value.clearButtonEl.classList.add('abele-obsidian-search__clear')
  // A field with nothing to suggest is still a field: a script's plain search box has none.
  if (props.suggester)
    suggest = new props.suggester(GlobalStore.getInstance().app, search.value.inputEl)
  else if (props.makeSuggest) {
    const created = props.makeSuggest(search.value.inputEl) as
      | Partial<AbstractInputSuggest<unknown>>
      | undefined
    if (typeof created?.close === 'function') suggest = created as AbstractInputSuggest<unknown>
  }
  if (props.label) search.value.inputEl.setAttribute('aria-label', props.label)
  if (props.modelValue) {
    search.value.setValue(props.modelValue)
  }
  updateSuffix()
  search.value.onChange((value) => {
    emit('update:model-value', value)
  })
  if (props.placeholder) {
    search.value.setPlaceholder(props.placeholder)
  }
  if (props.disabled !== undefined) {
    search.value.setDisabled(props.disabled)
  }
  if (props.autofocus) search.value.inputEl.focus()
}

const updateSuffix = () => {
  const container = search.value?.inputEl.parentElement
  if (!container) return
  let suffix = container.querySelector<HTMLElement>('.abele-obsidian-search__suffix')
  if (props.suffix === undefined) suffix?.remove()
  else {
    suffix ??= container.createSpan({ cls: 'abele-obsidian-search__suffix' })
    suffix.className = ['abele-obsidian-search__suffix', props.suffixClass]
      .filter(Boolean)
      .join(' ')
    suffix.textContent = props.suffix
    suffix.setAttribute('aria-live', 'polite')
    suffix.setAttribute('aria-label', props.suffixLabel ?? props.suffix)
  }
  container.classList.toggle(
    'abele-obsidian-search__container_with-suffix',
    props.suffix !== undefined
  )
}
watch(() => [props.suffix, props.suffixLabel, props.suffixClass], updateSuffix)
onMounted(initSearch)

watch(
  () => props.modelValue,
  (val) => {
    if (!search.value) return
    if (search.value.getValue() !== val) {
      search.value.setValue(val ?? '')
    }
  }
)

watch(
  () => props.placeholder,
  (placeholder) => search.value?.setPlaceholder(placeholder ?? '')
)

watch(
  () => props.label,
  (label) => {
    if (label) search.value?.inputEl.setAttribute('aria-label', label)
    else search.value?.inputEl.removeAttribute('aria-label')
  }
)

watch(
  () => props.disabled,
  () => {
    if (search.value && props.disabled !== undefined) {
      search.value.setDisabled(props.disabled)
    }
  }
)

const emit = defineEmits<{
  (e: 'update:model-value', value: string): void
}>()
</script>

<style>
.abele-obsidian-search__container_with-suffix .abele-obsidian-search__clear {
  display: none;
}
.abele-obsidian-search__container_with-suffix input {
  padding-inline-end: var(--size-4-12);
}
.abele-obsidian-search__suffix {
  position: absolute;
  inset-inline-end: var(--size-4-3);
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
/* A field that takes no input offers nothing to clear. */
.abele-obsidian-search_disabled .abele-obsidian-search__clear {
  display: none;
}
</style>
