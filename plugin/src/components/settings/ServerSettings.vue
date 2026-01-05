<template>
  <div class="abele-settings__server">
    <Setting name="Backend URL" desc="The base URL of your Abele backend server.">
      <Input
        :model-value="baseUrl"
        placeholder="https://your-server.com"
        @update:model-value="baseUrlChanged"
      />
    </Setting>

    <Setting name="API Token" desc="Authentication token for the backend API.">
      <Input
        :model-value="apiToken"
        type="password"
        placeholder="Enter your API token"
        @update:model-value="apiTokenChanged"
      />
    </Setting>

    <Setting name="Verify Connection" desc="Test the connection to your backend server.">
      <div class="abele-settings__verify">
        <Button
          :text="isVerifying ? 'Verifying...' : 'Verify Connection'"
          :disabled="isVerifying || !baseUrl || !apiToken"
          @click="verifyConnection"
        />
        <Icon
          v-if="connectionStatus"
          :icon="connectionStatus.success ? 'check' : 'x'"
          class="abele-settings__verify-icon"
          :class="
            connectionStatus.success
              ? 'abele-settings__verify-icon_success'
              : 'abele-settings__verify-icon_error'
          "
        />
      </div>
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { VerifyConnectionApi } from '@/api/VerifyConnnection'
import { debounce } from 'obsidian'

const baseUrl = ref(AbeleConfig.getInstance().baseUrl)
const apiToken = ref(AbeleConfig.getInstance().apiToken)
const isVerifying = ref(false)
const connectionStatus = ref<{ success: boolean; message: string } | null>(null)

const saveSettings = debounce(async () => {
  const config = AbeleConfig.getInstance()
  config.baseUrl = baseUrl.value.trim()
  config.apiToken = apiToken.value.trim()
  await config.saveSettings()
}, 500)

const baseUrlChanged = (value: string) => {
  baseUrl.value = value
  connectionStatus.value = null
  saveSettings()
}

const apiTokenChanged = (value: string) => {
  apiToken.value = value
  connectionStatus.value = null
  saveSettings()
}

const verifyConnection = async () => {
  if (isVerifying.value) return

  isVerifying.value = true
  connectionStatus.value = null

  try {
    const api = new VerifyConnectionApi(AbeleConfig.getInstance())
    const result = await api.verifyConnection()

    connectionStatus.value = {
      success: result.success,
      message: result.success ? 'Connection successful!' : result.error || 'Connection failed',
    }
  } catch (error: any) {
    connectionStatus.value = {
      success: false,
      message: error.message || 'Connection failed',
    }
  } finally {
    isVerifying.value = false
  }
}
</script>

<style lang="scss">
.abele-settings__verify {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-settings__verify-icon {
  &_success {
    color: var(--text-success);
  }

  &_error {
    color: var(--text-error);
  }
}
</style>
