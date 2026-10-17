<template>
  <!-- A provider as a row, as Obsidian lists its plugins: its name, whether its key is in and
       how many models it brings, and the rest in a window of its own. -->
  <Setting class="abele-ai-provider">
    <template #name>{{
      name || t('settings.ai.ProviderSettings.unnamed_provider.1b003656')
    }}</template>
    <template #desc
      ><span :class="{ 'mod-warning': !secretValue }">{{
        [secretValue ? t('settings.terms.keySaved') : t('settings.terms.noKeyYet'), summary]
          .filter(Boolean)
          .join(' · ')
      }}</span></template
    >
    <Icon
      icon="settings"
      :tooltip="t('settings.ai.ProviderSettings.change_this_provider_and_its.6b743289')"
      @click="open = true"
    />
  </Setting>
  <ObsidianModal
    v-if="open"
    :title="name || t('settings.ai.ProviderSettings.new_provider.38a96a6a')"
    @close="open = false"
  >
    <slot name="identity" />
    <Setting :name="t('settings.ai.ProviderSettings.name.dcd1d522')">
      <Input :model-value="name" @update:model-value="emit('update:name', $event)" />
    </Setting>
    <slot name="endpoint" />
    <Setting
      :name="t('settings.ai.ProviderSettings.client_name.b6626cd7')"
      :desc="settingsLabel(CLIENT_NAME_DESCRIPTION)"
    >
      <Input
        :model-value="clientName || ''"
        :placeholder="t('settings.ai.ProviderSettings.default.21b111cb')"
        @update:model-value="emit('update:client-name', $event)"
      />
    </Setting>
    <Setting
      :name="t('settings.ai.ProviderSettings.api_key.16f0ee47')"
      :desc="t('settings.ai.ProviderSettings.kept_in_the_keychain_of.27a8c578')"
    >
      <SecretField
        :value="secretValue"
        :model-value="secretInput"
        placeholder="sk-..."
        @update:model-value="emit('update:secret-input', $event)"
        @save="emit('save-secret')"
      />
    </Setting>
    <Setting heading :name="t('settings.ai.ProviderSettings.models.d17d2d78')"
      ><slot name="model-actions"
    /></Setting>
    <slot />
    <template #footer>
      <div class="abele-modal__actions">
        <Button
          :text="t('settings.ai.ProviderSettings.delete.e2d0a549')"
          warning
          :tooltip="t('settings.ai.ProviderSettings.remove_this_provider_and_its.e1aeea6b')"
          class="abele-ai-provider__delete"
          @click="emit('remove')"
        />
        <Button
          :text="t('settings.ai.ProviderSettings.done.11a6767d')"
          accent
          :tooltip="t('settings.ai.ProviderSettings.close_this_window_changes_are.91342d87')"
          @click="open = false"
        />
      </div>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { settingsLabel } from '@/i18n/settingsLabels'
import { t } from '@/i18n'
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
