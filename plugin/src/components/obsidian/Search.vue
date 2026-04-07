<template>
  <div ref="el" class="abele-obsidian-search" />
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { SearchComponent } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  suggester?: typeof FileSuggest | typeof FolderSuggest
  disabled?: boolean
}>()

const el = ref<HTMLElement>()
const search = ref<SearchComponent>()

const initSearch = () => {
  if (!el.value) return
  // Clear previous instance
  if (search.value) {
    el.value.empty()
    search.value = undefined
  }
  search.value = new SearchComponent(el.value)
  new props.suggester(GlobalStore.getInstance().app, search.value.inputEl)
  search.value.onChange((value) => {
    emit('update:model-value', value)
  })
  if (props.placeholder) {
    search.value.setPlaceholder(props.placeholder)
  }
  if (props.disabled !== undefined) {
    search.value.setDisabled(props.disabled)
  }
}

onMounted(initSearch)

watch(
  () => props.modelValue,
  (val) => {
    // When value is reset externally, recreate the search component
    if (val === '' && search.value) {
      initSearch()
    }
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
