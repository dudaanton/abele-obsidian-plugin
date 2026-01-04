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

const updateSearch = () => {
  if (el.value) {
    if (!search.value) {
      search.value = new SearchComponent(el.value)
      new props.suggester(GlobalStore.getInstance().app, search.value.inputEl)
      search.value.onChange((value) => {
        emit('update:model-value', value)
      })
    }

    search.value.setValue(props.modelValue)

    if (props.disabled !== undefined) {
      search.value.setDisabled(props.disabled)
    }

    if (props.placeholder) {
      search.value.setPlaceholder(props.placeholder)
    }
  }
}

onMounted(() => {
  updateSearch()
})
watch(() => [props.modelValue, props.disabled], updateSearch)

const emit = defineEmits<{
  (e: 'update:model-value', value: string): void
}>()
</script>
