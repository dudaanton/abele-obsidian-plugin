<template>
  <!-- An environment's values as a note's properties: the plain ones written into its file, the
       secrets (a token taken from an answer) kept in memory and never written, and whether a
       request sent into a recording says which step it is. -->
  <Modal
    :title="t('streamC.4ef2f9a018360102', { v1: String(name) })"
    size="tall"
    close-in-footer
    @close="emit('close')"
  >
    <Section
      :title="t('streamC.53b09e104f608daa')"
      :desc="t('streamC.3a0b102a6e0cb082', { v1: '{{name}}' })"
    >
      <RequestPairs
        :pairs="plain"
        :label="t('streamC.53b09e104f608daa')"
        :adding="t('streamC.e2f9f33fe2df84f9')"
        @change="(i, p) => (plain[i] = p)"
        @remove="(i) => plain.splice(i, 1)"
        @add="(p) => plain.push(p)"
      />
    </Section>
    <Section :title="t('streamC.d45a7bc8fc3980d1')" :desc="t('streamC.34151736952f73f8')">
      <div class="abele-http-env__secrets" role="table" :aria-label="t('streamC.d45a7bc8fc3980d1')">
        <div v-for="(s, i) in secret" :key="i" class="abele-http-env__secret" role="row">
          <input
            type="text"
            class="abele-http-env__key"
            :value="s.key"
            :aria-label="t('streamC.7c57c42466c69494', { v1: String(i + 1) })"
            spellcheck="false"
            @change="s.key = ($event.target as HTMLInputElement).value.trim()"
          />
          <input
            type="password"
            class="abele-http-env__value"
            :value="s.value"
            :placeholder="s.value ? '' : t('settings.SecretsListModal.not_set.4895f731')"
            :aria-label="t('streamC.f311f28dffba3c36', { v1: String(s.key) })"
            autocomplete="off"
            @change="s.value = ($event.target as HTMLInputElement).value"
          />
          <Icon
            icon="x"
            size="xs"
            :tooltip="t('streamC.77f34651d2fffa76', { v1: String(s.key) })"
            @click="secret.splice(i, 1)"
          />
        </div>
        <Button
          plain
          icon="plus"
          :text="t('streamC.98aa52b34c8f07fd')"
          @click="secret.push({ key: '', value: '' })"
        />
      </div>
    </Section>
    <Section :title="t('streamC.80e8dd1a5a05f707')">
      <Setting :name="t('streamC.5cd3eca6c2dabe8c')" :desc="t('streamC.9e218b3fae23df71')">
        <Checkbox :is-enabled="stepHeader" @toggle="stepHeader = !stepHeader" />
      </Setting>
    </Section>
    <template #footer>
      <Button warning :text="t('kit.delete')" @click="emit('remove')" />
      <span class="abele-http-env__gap" />
      <Button :text="t('kit.cancel')" @click="emit('close')" />
      <Button accent :text="t('settings.GithubConnectionEditor.save.1509f561')" @click="save" />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

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
