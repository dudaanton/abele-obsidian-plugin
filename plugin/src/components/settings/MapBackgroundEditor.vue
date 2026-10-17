<template>
  <ObsidianModal
    :title="isNew ? 'New background' : 'Edit background'"
    close-in-footer
    @close="emit('close')"
  >
    <div class="abele-map-bg-editor">
      <Setting name="Name" :error="nameError">
        <Input v-model="name" placeholder="Topographic" />
      </Setting>
      <!-- Addresses are long: each field under its words, the dialog's full width. -->
      <div class="abele-map-bg-editor__field">
        <div class="setting-item-name">Light</div>
        <div class="setting-item-description">
          One address per line: a style.json, or tile templates with {z}/{x}/{y}. Several templates
          are drawn as layers, one over the other.
        </div>
        <textarea
          v-model="light"
          class="abele-map-bg-editor__urls"
          rows="3"
          spellcheck="false"
          placeholder="https://tiles.example.com/{z}/{x}/{y}.png"
        />
        <div v-if="lightError" class="abele-map-bg-editor__error">{{ lightError }}</div>
      </div>
      <div class="abele-map-bg-editor__field">
        <div class="setting-item-name">Dark</div>
        <div class="setting-item-description">Optional. Without it the light one is used in a dark theme too.</div>
        <textarea
          v-model="dark"
          class="abele-map-bg-editor__urls"
          rows="3"
          spellcheck="false"
          placeholder="https://tiles.example.com/dark/{z}/{x}/{y}.png"
        />
      </div>
    </div>
    <template #footer>
      <div class="modal-button-container">
        <Button text="Cancel" tooltip="Close without saving" @click="emit('close')" />
        <Button text="Save" accent tooltip="Save the background" @click="save" />
      </div>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
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
const nameError = computed(() => (tried.value && !name.value.trim() ? 'Give it a name' : ''))
const lightError = computed(() =>
  tried.value && !lines(light.value).length ? 'At least one address is needed' : ''
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
