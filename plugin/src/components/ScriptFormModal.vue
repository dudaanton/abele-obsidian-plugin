<template>
  <!-- A document gets the wider column: a reference full of code reads badly in a form's. -->
  <ObsidianModal :title="title" :size="asksSomething ? 'default' : 'wide'" @close="onCancel">
    <form :id="formId" ref="formEl" class="abele-script-form" @submit.prevent="onSubmit">
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
        <NotePicker
          v-else-if="field.type === 'note-picker'"
          v-model="picks[field.name]"
          :filter="field.filter"
          :multiple="field.multiple"
          :create="field.create"
          :placeholder="field.placeholder"
        />
        <NoteEditorField
          v-else-if="field.type === 'note'"
          v-model="values[field.name]"
          @submit="onSubmit"
        />
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
    </form>
    <!-- Under the body, in sight however long the form or the document runs: a reference runs to
         thousands of pixels, and on a phone a long form ran under the keyboard with its Run. -->
    <template #footer>
      <!-- Nothing to fill in means nothing to run: the form is something to read. -->
      <Button
        v-if="asksSomething"
        text="Run"
        accent
        type="submit"
        :form="formId"
        tooltip="Run the script with these answers"
      />
      <Button
        :text="asksSomething ? 'Cancel' : 'Close'"
        type="button"
        :tooltip="asksSomething ? 'Close this and run nothing' : 'Close this'"
        @click="onCancel"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, reactive, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Button from './obsidian/Button.vue'
import Markdown from './obsidian/Markdown.vue'
import NoteEditorField from './NoteEditorField.vue'
import NotePicker from './obsidian/NotePicker.vue'
import type { FormField } from '@/scripting/types'
import { pickItems, resolveNote } from '@/helpers/noteFilter'
import { GlobalStore } from '@/stores/GlobalStore'
import { genid } from '@/helpers/vueUtils'

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

/** The Run button stands in the pinned row, outside the form, and submits it by its id. */
const formId = `abele-script-form-${genid()}`

const values = reactive<Record<string, string>>({})
/** A note picker's chosen paths, kept as a list until the form is sent. */
const picks = reactive<Record<string, string[]>>({})
for (const field of props.fields) {
  if (field.type === 'markdown') continue
  if (field.type === 'note-picker') {
    const { app } = GlobalStore.getInstance()
    picks[field.name] = pickItems(field.default)
      .map((item) => resolveNote(app, item)?.path)
      .filter((p): p is string => !!p)
    continue
  }
  const given = Array.isArray(field.default) ? field.default.join('\n') : field.default
  values[field.name] = given ?? (field.type === 'boolean' ? 'false' : '')
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

/**
 * A picker answers the way an agent would: one path, or a JSON list of them. The script's
 * `form()` turns either into the note or notes in the shape the field asked for.
 */
function onSubmit() {
  const answers: Record<string, string> = { ...values }
  for (const field of props.fields) {
    if (field.type !== 'note-picker') continue
    const chosen = picks[field.name] ?? []
    answers[field.name] = field.multiple ? JSON.stringify(chosen) : (chosen[0] ?? '')
  }
  props.resolve(answers)
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
 * It does not scroll: the dialog's body already does, so a second bounded box inside it gave a
 * long document two scrollbars side by side and stopped the dialog short of the height it was
 * allowed.
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
</style>
