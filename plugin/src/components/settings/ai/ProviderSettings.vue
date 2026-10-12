<template>
  <!-- A provider as a row, as Obsidian lists its plugins: its name, whether its key is in and
       how many models it brings, and the rest in a window of its own. -->
  <Setting class="abele-ai-provider">
    <template #name>{{ name || 'Unnamed provider' }}</template>
    <template #desc
      ><span :class="{ 'mod-warning': !secretValue }">{{
        [secretValue ? 'Key saved' : 'No key yet', summary].filter(Boolean).join(' · ')
      }}</span></template
    >
    <Icon icon="settings" tooltip="Change this provider and its models" @click="open = true" />
  </Setting>
  <ObsidianModal v-if="open" :title="name || 'New provider'" @close="open = false">
    <slot name="identity" />
    <Setting name="Name">
      <Input :model-value="name" @update:model-value="emit('update:name', $event)" />
    </Setting>
    <slot name="endpoint" />
    <Setting name="Client name" :desc="CLIENT_NAME_DESCRIPTION">
      <Input
        :model-value="clientName || ''"
        placeholder="Default"
        @update:model-value="emit('update:client-name', $event)"
      />
    </Setting>
    <Setting name="API key" desc="Kept in the keychain of this device.">
      <SecretField
        :value="secretValue"
        :model-value="secretInput"
        placeholder="sk-..."
        @update:model-value="emit('update:secret-input', $event)"
        @save="emit('save-secret')"
      />
    </Setting>
    <Setting heading name="Models"><slot name="model-actions" /></Setting>
    <slot />
    <template #footer>
      <div class="abele-modal__actions">
        <Button
          text="Delete"
          warning
          tooltip="Remove this provider and its models"
          class="abele-ai-provider__delete"
          @click="emit('remove')"
        />
        <Button
          text="Done"
          accent
          tooltip="Close this window; changes are kept as you make them"
          @click="open = false"
        />
      </div>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import Setting from '../../obsidian/Setting.vue'
import Input from '../../obsidian/Input.vue'
import Icon from '../../obsidian/Icon.vue'
import Button from '../../obsidian/Button.vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import { ref } from 'vue'
import SecretField from '../SecretField.vue'
import { CLIENT_NAME_DESCRIPTION } from '@/ai/client/clientName'

defineProps<{
  name: string
  clientName?: string
  secretValue: string
  secretInput: string
  /** What the row says after the key: how many models, say. */
  summary?: string
}>()

const open = ref(false)
const emit = defineEmits<{
  'update:name': [value: string]
  'update:client-name': [value: string]
  'update:secret-input': [value: string]
  'save-secret': []
  remove: []
}>()
</script>

<style lang="scss">
.abele-ai-provider__delete {
  margin-inline-end: auto;
}
</style>
