<template>
  <div class="abele-property-list-field">
    <div v-show="!fallback" ref="host" class="abele-property-list-field__widget" />
    <ObsidianInput
      v-if="fallback"
      :model-value="modelValue.join(', ')"
      :placeholder="placeholder"
      @update:model-value="onFallback"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * A list property — `groups` — drawn by Obsidian's own list field, the one above every note:
 * each value a pill, a link shown as a link, `[[` offering notes. That field is Obsidian's
 * insides too (see `editor/embeddedEditor.ts`), so where it cannot be had the list is typed as
 * text, comma between the values.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ObsidianInput from './obsidian/Input.vue'
import { GlobalStore } from '@/stores/GlobalStore'

const props = defineProps<{
  modelValue: string[]
  /** The property's name, which Obsidian's field is told it edits. */
  propertyKey: string
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

interface TypeWidget {
  render(
    el: HTMLElement,
    value: unknown,
    ctx: {
      app: unknown
      key: string
      sourcePath: string
      blur(): void
      onChange(value: unknown): void
    }
  ): { focus?(): void } | void
}

const host = ref<HTMLElement | null>(null)
const fallback = ref(false)

const toList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value == null ? [] : [value])
    .map((v) => String(v).trim())
    .filter(Boolean)

const onFallback = (text: string) => {
  emit(
    'update:modelValue',
    text
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  )
}

onMounted(() => {
  const { app } = GlobalStore.getInstance()
  const widgets = (
    app as unknown as {
      metadataTypeManager?: { registeredTypeWidgets?: Record<string, TypeWidget> }
    }
  ).metadataTypeManager?.registeredTypeWidgets
  const widget = widgets?.multitext
  if (!host.value || typeof widget?.render !== 'function') {
    fallback.value = true
    return
  }
  try {
    widget.render(host.value, [...props.modelValue], {
      app,
      key: props.propertyKey,
      sourcePath: '',
      blur: () => {},
      onChange: (value) => emit('update:modelValue', toList(value)),
    })
  } catch (error) {
    console.debug('[Abele] Obsidian list field not available:', error)
    host.value.empty()
    fallback.value = true
  }
})

onBeforeUnmount(() => {
  host.value?.empty()
})
</script>

<style lang="scss">
/* Obsidian's field is drawn for a row of the properties table; here it is a field of its own. */
.abele-property-list-field__widget {
  border: var(--input-border-width) solid var(--background-modifier-border);
  border-radius: var(--input-radius);
  padding: var(--size-2-2) var(--size-4-2);
  min-height: var(--input-height);
  background: var(--background-modifier-form-field);

  &:focus-within {
    border-color: var(--background-modifier-border-focus);
  }
}
</style>
