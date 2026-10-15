<template>
  <!-- An environment's values as a note's properties: the plain ones written into its file, the
       secrets (a token taken from an answer) kept in memory and never written, and whether a
       request sent into a recording says which step it is. -->
  <Modal :title="`Environment ${name}`" size="tall" close-in-footer @close="emit('close')">
    <Section title="Values" desc="Put into requests as {{name}}. Written into the project's file.">
      <RequestPairs
        :pairs="plain"
        label="Values"
        adding="Add a value"
        @change="(i, p) => (plain[i] = p)"
        @remove="(i) => plain.splice(i, 1)"
        @add="(p) => plain.push(p)"
      />
    </Section>
    <Section
      title="Kept in memory"
      desc="Tokens from an answer: never written, blanked wherever they show, gone when Obsidian closes."
    >
      <div class="abele-http-env__secrets" role="table" aria-label="Kept in memory">
        <div v-for="(s, i) in secret" :key="i" class="abele-http-env__secret" role="row">
          <input
            type="text"
            class="abele-http-env__key"
            :value="s.key"
            :aria-label="`Name of secret ${i + 1}`"
            spellcheck="false"
            @change="s.key = ($event.target as HTMLInputElement).value.trim()"
          />
          <input
            type="password"
            class="abele-http-env__value"
            :value="s.value"
            :placeholder="s.value ? '' : 'Not set'"
            :aria-label="`Value of ${s.key}`"
            autocomplete="off"
            @change="s.value = ($event.target as HTMLInputElement).value"
          />
          <Icon icon="x" size="xs" :tooltip="`Remove ${s.key}`" @click="secret.splice(i, 1)" />
        </div>
        <Button
          plain
          icon="plus"
          text="Add a secret"
          @click="secret.push({ key: '', value: '' })"
        />
      </div>
    </Section>
    <Section title="Recording">
      <Setting
        name="Say the step"
        desc="A request sent into a recording carries X-Abele-Step, so a record point can take it."
      >
        <Checkbox :is-enabled="stepHeader" @toggle="stepHeader = !stepHeader" />
      </Setting>
    </Section>
    <template #footer>
      <Button warning text="Delete" @click="emit('remove')" />
      <span class="abele-http-env__gap" />
      <Button text="Cancel" @click="emit('close')" />
      <Button accent text="Save" @click="save" />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import Button from '../../obsidian/Button.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Icon from '../../obsidian/Icon.vue'
import Modal from '../../obsidian/Modal.vue'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import RequestPairs from './RequestPairs.vue'
import type { HttpEnvironmentEdit, HttpPair } from './types'

type EnvironmentEdit = HttpEnvironmentEdit

const props = defineProps<{
  environment: EnvironmentEdit
  /** The secrets' values in memory, by name. */
  secrets: Record<string, string>
}>()
const emit = defineEmits<{
  (e: 'save', environment: EnvironmentEdit): void
  (e: 'remove'): void
  (e: 'close'): void
}>()

const name = props.environment.name
const plain = reactive<HttpPair[]>(
  props.environment.vars
    .filter((v) => !v.secret)
    .map((v) => ({ key: v.key, value: v.value ?? '', ...(v.off ? { off: true } : {}) }))
)
const secret = reactive(
  props.environment.vars
    .filter((v) => v.secret)
    .map((v) => ({ key: v.key, value: props.secrets[v.key] ?? '' }))
)
const stepHeader = ref(!!props.environment.stepHeader)

function save() {
  emit('save', {
    name,
    vars: [
      ...plain
        .filter((p) => p.key.trim())
        .map((p) => ({ key: p.key.trim(), value: p.value, ...(p.off ? { off: true } : {}) })),
      ...secret
        .filter((s) => s.key)
        .map((s) => ({ key: s.key, secret: true, ...(s.value ? { value: s.value } : {}) })),
    ],
    stepHeader: stepHeader.value,
  })
}
</script>

<style lang="scss">
.abele-http-env__secrets {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--size-2-2);
}
.abele-http-env__secret {
  display: grid;
  grid-template-columns: minmax(6em, 10em) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--size-4-2);
  width: 100%;
  input {
    min-width: 0;
    font-family: var(--font-monospace);
    font-size: var(--font-ui-small);
  }
}
.abele-http-env__gap {
  flex: 1 1 auto;
}
</style>
