<template>
  <ObsidianModal :title="title" @close="onCancel">
    <form class="abele-script-form" @submit.prevent="onSubmit">
      <div v-for="field in fields" :key="field.name" class="abele-script-form__field">
        <label v-if="field.label" class="abele-script-form__label">
          {{ field.label }}
          <span v-if="field.required" class="abele-script-form__required">*</span>
        </label>
        <Markdown
          v-if="field.type === 'markdown'"
          :text="field.text || field.default || ''"
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
      <div class="abele-script-form__actions">
        <!-- Nothing to fill in means nothing to run: the form is something to read. -->
        <button v-if="asksSomething" type="submit" class="mod-cta">Run</button>
        <button type="button" @click="onCancel">{{ asksSomething ? 'Cancel' : 'Close' }}</button>
      </div>
    </form>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, reactive, onMounted } from 'vue'
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

/** "Script Parameters" is the wrong heading for something that asks for no parameters. */
const title = computed(() => (asksSomething.value ? 'Script Parameters' : 'Script'))

const values = reactive<Record<string, string>>({})
for (const field of props.fields) {
  if (field.type === 'markdown') continue
  values[field.name] = field.default ?? (field.type === 'boolean' ? 'false' : '')
}

onMounted(() => {
  window.setTimeout(() => {
    const input = document.querySelector<HTMLInputElement>('.abele-script-form__input')
    input?.focus()
  }, 100)
})

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
 * meant to be copied out of has to say otherwise. Bounded and scrollable, because a script
 * can produce a document and the modal should not grow past the window.
 */
.abele-script-form__markdown {
  user-select: text;
  -webkit-user-select: text;
  max-height: 60vh;
  overflow-y: auto;
  overflow-wrap: break-word;
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
</style>
