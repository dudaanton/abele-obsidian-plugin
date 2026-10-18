<template>
  <ObsidianModal
    :size="Platform.isPhone ? 'tall' : undefined"
    :title="isNew ? t('maps.newBackground') : t('maps.editBackground')"
    close-in-footer
    @close="emit('close')"
  >
    <div class="abele-map-bg-editor">
      <Setting :name="t('maps.name')" :error="nameError">
        <Input v-model="name" :placeholder="t('maps.name')" />
      </Setting>
      <!-- Addresses are long: each field under its words, the dialog's full width. -->
      <div class="abele-map-bg-editor__field">
        <div class="setting-item-name">{{ t('maps.light') }}</div>
        <div class="setting-item-description">
          {{ t('maps.addressHint') }}
        </div>
        <Input
          v-model="light"
          as-text-area
          class="abele-map-bg-editor__urls"
          :rows="3"
          spellcheck="false"
          :placeholder="t('maps.lightAddressExample')"
        />
        <div v-if="lightError" class="abele-map-bg-editor__error">{{ lightError }}</div>
      </div>
      <div class="abele-map-bg-editor__field">
        <div class="setting-item-name">{{ t('maps.dark') }}</div>
        <div class="setting-item-description">{{ t('maps.darkHint') }}</div>
        <Input
          v-model="dark"
          as-text-area
          class="abele-map-bg-editor__urls"
          :rows="3"
          spellcheck="false"
          :placeholder="t('maps.darkAddressExample')"
        />
      </div>
    </div>
    <template #footer>
      <div class="modal-button-container">
        <Button :text="t('maps.cancel')" :tooltip="t('kit.cancelTooltip')" @click="emit('close')" />
        <Button :text="t('maps.save')" accent :tooltip="t('maps.save')" @click="save" />
      </div>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { Platform } from 'obsidian'
// One background's name and addresses. Nothing is saved until Save; Cancel and Escape leave the
// list as it was. A name and at least one light address are needed.
import { computed, ref } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import type { MapBackground } from '../mapBase/places'

const props = defineProps<{ background?: MapBackground; showErrors?: boolean }>()
const emit = defineEmits<{ close: []; save: [bg: MapBackground] }>()

const isNew = !props.background
const name = ref(props.background?.name ?? '')
const light = ref(props.background?.light.join('\n') ?? '')
const dark = ref(props.background?.dark.join('\n') ?? '')
const tried = ref(!!props.showErrors)
const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
const nameError = computed(() => (tried.value && !name.value.trim() ? t('maps.giveName') : ''))
const lightError = computed(() =>
  tried.value && !lines(light.value).length ? t('maps.needAddress') : ''
)

function save() {
  tried.value = true
  if (nameError.value || lightError.value) return
  emit('save', {
    id: props.background?.id ?? `bg-${Date.now()}`,
    name: name.value.trim(),
    light: lines(light.value),
    dark: lines(dark.value),
  })
}
</script>

<style>
.abele-map-bg-editor__field {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  padding: var(--size-4-3) 0;
  border-top: var(--border-width) solid var(--background-modifier-border);
}
.abele-map-bg-editor__urls {
  width: 100%;
  margin-top: var(--size-2-2);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  resize: vertical;
}
.abele-map-bg-editor__error {
  color: var(--text-error);
  font-size: var(--font-ui-smaller);
}
</style>
