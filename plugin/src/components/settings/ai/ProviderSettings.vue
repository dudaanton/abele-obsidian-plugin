<template>
  <div class="abele-ai-provider">
    <div class="abele-ai-provider__header">
      <strong class="abele-ai-provider__name">{{ name || 'Unnamed Provider' }}</strong>
      <Icon icon="trash" tooltip="Remove this provider and its models" @click="emit('remove')" />
    </div>
    <slot name="identity" />
    <Setting name="Name" desc="Display name for this provider.">
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
    <Setting name="API Key" desc="Stored securely in keychain.">
      <SecretField
        :value="secretValue"
        :model-value="secretInput"
        placeholder="sk-..."
        @update:model-value="emit('update:secret-input', $event)"
        @save="emit('save-secret')"
      />
    </Setting>
    <div class="abele-ai-provider__models">
      <div class="abele-ai-provider__models-header">
        <span>Models</span>
        <div class="abele-ai-provider__models-actions"><slot name="model-actions" /></div>
      </div>
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import Setting from '../../obsidian/Setting.vue'
import Input from '../../obsidian/Input.vue'
import Icon from '../../obsidian/Icon.vue'
import SecretField from '../SecretField.vue'
import { CLIENT_NAME_DESCRIPTION } from '@/ai/client/clientName'

defineProps<{
  name: string
  clientName?: string
  secretValue: string
  secretInput: string
}>()
const emit = defineEmits<{
  'update:name': [value: string]
  'update:client-name': [value: string]
  'update:secret-input': [value: string]
  'save-secret': []
  remove: []
}>()
</script>

<style lang="scss">
.abele-ai-provider {
  padding: var(--size-4-3) 0;
  border-bottom: 1px solid var(--background-modifier-border);

  &:last-child {
    border-bottom: none;
  }
}

.abele-ai-provider__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--size-4-1);
  margin-bottom: var(--size-4-2);
}

.abele-ai-provider__name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.abele-ai-provider__models {
  margin-top: var(--size-4-4);
}

.abele-ai-provider__models-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--size-4-2);
  font-size: var(--font-small);
  color: var(--text-muted);
}

.abele-ai-provider__models-actions {
  display: flex;
  gap: var(--size-4-1);
}
</style>
