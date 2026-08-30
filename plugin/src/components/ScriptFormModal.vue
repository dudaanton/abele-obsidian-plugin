<template>
  <!-- A document gets the wider column: a reference full of code reads badly in a form's. -->
  <ObsidianModal :title="title" :size="asksSomething ? 'default' : 'wide'" @close="onCancel">
    <form ref="formEl" class="abele-script-form" @submit.prevent="onSubmit">
      <div v-for="field in fields" :key="field.name" class="abele-script-form__field">
        <label v-if="field.label && field !== titleField" class="abele-script-form__label">
          {{ field.label }}
          <span v-if="field.required" class="abele-script-form__required">*</span>
        </label>
        <Markdown
          v-if="field.type === 'markdown'"
          :text="bodyOf(field)"
          :as-document="!asksSomething"
          class="abele-script-form__markdown"
        />
        <select
          v-else-if="field.type === 'select' && field.options"
          v-model="values[field.name]"
          class="dropdown"
        >
          <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <textarea
          v-else-if="field.type === 'textarea'"
          v-model="values[field.name]"
          class="abele-script-form__textarea"
          rows="4"
        />
        <Checkbox
          v-else-if="field.type === 'boolean'"
          :is-enabled="values[field.name] === 'true'"
          @toggle="values[field.name] = values[field.name] === 'true' ? 'false' : 'true'"
        />
        <input v-else v-model="values[field.name]" type="text" class="abele-script-form__input" />
      </div>
      <div
        class="abele-script-form__actions"
        :class="{ 'abele-script-form__actions_sticky': !asksSomething }"
      >
        <!-- Nothing to fill in means nothing to run: the form is something to read. -->
        <button v-if="asksSomething" type="submit" class="mod-cta">Run</button>
        <button type="button" @click="onCancel">{{ asksSomething ? 'Cancel' : 'Close' }}</button>
      </div>
    </form>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, reactive, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Markdown from './obsidian/Markdown.vue'
import type { FormField } from '@/scripting/types'

const props = defineProps<{
  fields: FormField[]
  resolve: (result: Record<string, string> | null) => void
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

/** A `markdown` field is there to be read, so it is not a value the form collects. */
const asksSomething = computed(() => props.fields.some((f) => f.type !== 'markdown'))

/**
 * A form that asks nothing is a document, and a document's heading belongs in the title bar
 * of the window rather than repeated above its own text. The field keeping that heading is
 * therefore rendered without its label.
 */
const titleField = computed(() =>
  asksSomething.value ? null : (props.fields.find((f) => f.label) ?? null)
)

/**
 * A document that opens with a top-level heading is naming itself, and a name belongs in the
 * title bar. Used when the script named nothing itself; stripped from the text below either
 * way, so the window never carries the same heading twice.
 */
const LEADING_HEADING = /^\s*#[^\S\n]+(.+?)[^\S\n]*(?:\n|$)\n*/

const documentField = computed(() =>
  asksSomething.value ? null : (props.fields.find((f) => f.type === 'markdown') ?? null)
)

const ownHeading = computed(() => {
  const field = documentField.value
  if (!field) return ''
  return LEADING_HEADING.exec(field.text || field.default || '')?.[1] ?? ''
})

/** "Script Parameters" is the wrong heading for something that asks for no parameters. */
const title = computed(() => {
  if (asksSomething.value) return 'Script Parameters'
  return titleField.value?.label || ownHeading.value || 'Script'
})

const bodyOf = (field: FormField): string => {
  const text = field.text || field.default || ''
  const named = field === documentField.value && ownHeading.value === title.value
  return named ? text.replace(LEADING_HEADING, '') : text
}

const values = reactive<Record<string, string>>({})
for (const field of props.fields) {
  if (field.type === 'markdown') continue
  values[field.name] = field.default ?? (field.type === 'boolean' ? 'false' : '')
}

/**
 * Puts the cursor in the first field, once the modal has been teleported into place.
 *
 * Inside the form rather than through the global `document`: a modal opened from the settings
 * window belongs to that window, and the global lookup would find whatever field happened to
 * be on the main one. The timer is cleared on the way out — a modal dismissed inside the
 * hundred milliseconds used to leave it running, reaching for a document no longer there.
 */
const formEl = useTemplateRef<HTMLFormElement>('formEl')
let focusTimer = 0

onMounted(() => {
  focusTimer = window.setTimeout(() => {
    formEl.value?.querySelector<HTMLInputElement>('.abele-script-form__input')?.focus()
  }, 100)
})

onBeforeUnmount(() => window.clearTimeout(focusTimer))

function onSubmit() {
  props.resolve({ ...values })
  emit('close')
}

function onCancel() {
  props.resolve(null)
  emit('close')
}
</script>

<style lang="scss">
.abele-script-form {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  padding-top: var(--size-4-2);
}

.abele-script-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-script-form__label {
  font-weight: var(--font-semibold);
}

/**
 * Text a script wants read, rather than answered.
 *
 * Selectable on purpose: Obsidian sets `user-select: none` across its interface, so a block
 * meant to be copied out of has to say otherwise.
 *
 * It does not scroll: Obsidian's own modal is already capped at 85vh and scrolls what it
 * holds, so a second bounded box inside it gave a long document two scrollbars side by side
 * and stopped the modal short of the height it was allowed. One box scrolls, and it is the
 * one with the close button on it.
 */
.abele-script-form__markdown {
  user-select: text;
  -webkit-user-select: text;
  overflow-wrap: break-word;

  // `overflow-wrap` above breaks a long line of code where it has to, so the only thing left
  // that cannot be made narrower is a table. Without this the modal is what scrolls sideways,
  // and every line of prose in it travels with the one wide table.
  table {
    display: block;
    width: fit-content;
    max-width: 100%;
    overflow-x: auto;
  }
}

.abele-script-form__required {
  color: var(--text-error);
}

.abele-script-form__input,
.abele-script-form__textarea {
  width: 100%;
}

.abele-script-form__actions {
  display: flex;
  gap: var(--size-4-2);
  justify-content: flex-end;
}

/**
 * A reference runs to thousands of pixels, and a button at the end of it is a button nobody
 * reaches. Obsidian scrolls the modal itself, so the row sticks to the bottom of that.
 *
 * The offset is the modal's own padding, `.modal { padding: var(--size-4-4) }`: text is drawn
 * into that padding as it scrolls past, so a row stopping at the content edge leaves a strip
 * of it showing underneath. The row reaches the bottom edge and carries the padding itself.
 */
.abele-script-form__actions_sticky {
  position: sticky;
  bottom: calc(var(--size-4-4) * -1);
  padding: var(--size-4-3) 0 var(--size-4-4);
  border-top: 1px solid var(--background-modifier-border);
  background-color: var(--modal-background, var(--background-primary));
}
</style>
