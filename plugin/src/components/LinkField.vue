<template>
  <ObsidianInput
    ref="input"
    class="abele-link-field"
    :model-value="text"
    :placeholder="placeholder"
    @update:model-value="onType"
    @blur="commit"
  />
</template>

<script setup lang="ts">
/**
 * One link to a note, typed by name with the matching notes offered beneath — an account, a
 * category. The field shows the name; what it holds is the link. A name nobody offered becomes
 * a link to a note of that name, the way a link typed into a note would.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AbstractInputSuggest, type App } from 'obsidian'
import ObsidianInput from './obsidian/Input.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { extractAliasOrNameFromWikilink } from '@/helpers/pathsHelpers'

export interface LinkOption {
  /** What is written: a wikilink. */
  link: string
  /** What is shown and typed. */
  name: string
  /** A second, quieter line under the name — a currency, a balance. */
  detail?: string
}

const props = defineProps<{
  /** A wikilink, or null for none. */
  modelValue: string | null
  options: (query: string) => LinkOption[]
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | null): void
}>()

const nameOf = (link: string | null) => (link ? (extractAliasOrNameFromWikilink(link) ?? link) : '')

const input = ref<{ $el: HTMLInputElement } | null>(null)
const text = ref(nameOf(props.modelValue))

watch(
  () => props.modelValue,
  (link) => {
    if (nameOf(link) !== text.value.trim()) text.value = nameOf(link)
  }
)

const onType = (value: string) => {
  text.value = value
}

/** The typed name, as a link: the offered one it names, or a new one. */
const commit = () => {
  const name = text.value.trim()
  if (!name) {
    if (props.modelValue !== null) emit('update:modelValue', null)
    return
  }
  if (name === nameOf(props.modelValue)) return
  const match = props.options(name).find((o) => o.name.toLowerCase() === name.toLowerCase())
  emit('update:modelValue', match ? match.link : `[[${name}]]`)
}

class LinkSuggest extends AbstractInputSuggest<LinkOption> {
  constructor(
    app: App,
    private readonly el: HTMLInputElement
  ) {
    super(app, el)
  }

  protected getSuggestions(query: string): LinkOption[] {
    return props.options(query)
  }

  renderSuggestion(option: LinkOption, el: HTMLElement): void {
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: option.name })
    if (option.detail) content.createDiv({ cls: 'suggestion-note', text: option.detail })
  }

  selectSuggestion(option: LinkOption): void {
    text.value = option.name
    this.el.value = option.name
    emit('update:modelValue', option.link)
    this.close()
  }
}

let suggest: LinkSuggest | null = null

onMounted(() => {
  const el = input.value?.$el
  if (el) suggest = new LinkSuggest(GlobalStore.getInstance().app, el)
})

onBeforeUnmount(() => {
  suggest?.close()
  suggest = null
})
</script>
