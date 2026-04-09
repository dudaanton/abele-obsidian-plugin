<template>
  <div class="abele-settings__ai">
    <Setting name="AI Agent" desc="Enable AI agent features including the chat sidebar.">
      <Checkbox :is-enabled="enabled" @toggle="toggleEnabled" />
    </Setting>

    <template v-if="enabled">
      <h3>Providers</h3>

      <div v-for="(provider, pIdx) in providers" :key="provider.id" class="abele-ai-provider">
        <div class="abele-ai-provider__header">
          <strong>{{ provider.name || 'Unnamed Provider' }}</strong>
          <Icon icon="trash" @click="removeProvider(pIdx)" />
        </div>

        <Setting name="Name" desc="Display name for this provider.">
          <Input
            :model-value="provider.name"
            @update:model-value="updateProvider(pIdx, 'name', $event)"
          />
        </Setting>

        <Setting name="Base URL" desc="OpenAI-compatible API endpoint.">
          <Input
            :model-value="provider.baseUrl"
            placeholder="https://api.openai.com/v1"
            @update:model-value="updateProvider(pIdx, 'baseUrl', $event)"
          />
        </Setting>

        <Setting name="API Key" desc="Stored securely in keychain.">
          <div class="abele-ai-provider__secret">
            <span v-if="getSecretDisplay(provider.apiKeyId)" class="abele-ai-provider__secret-mask">
              {{ getSecretDisplay(provider.apiKeyId) }}
            </span>
            <div class="abele-ai-provider__secret-row">
              <input
                type="password"
                class="abele-ai-provider__secret-input"
                :value="secretInputs[provider.id] || ''"
                :placeholder="getSecretDisplay(provider.apiKeyId) ? 'New key...' : 'sk-...'"
                @input="secretInputs[provider.id] = ($event.target as HTMLInputElement).value"
                @keydown.enter="applyProviderSecret(pIdx)"
              />
              <Icon
                v-if="secretInputs[provider.id]"
                icon="check"
                with-bg
                @click="applyProviderSecret(pIdx)"
              />
            </div>
          </div>
        </Setting>

        <div class="abele-ai-provider__models">
          <div class="abele-ai-provider__models-header">
            <span>Models</span>
            <div class="abele-ai-provider__models-actions">
              <Button
                :text="fetchingModels === pIdx ? 'Loading...' : 'Fetch Models'"
                :disabled="!provider.baseUrl || !provider.apiKeyId || fetchingModels === pIdx"
                @click="fetchModels(pIdx)"
              />
              <Button text="Add Manually" @click="addModel(pIdx)" />
            </div>
          </div>

          <!-- Fetched models picker -->
          <div v-if="remoteModels[provider.id]?.length" class="abele-ai-provider__remote-models">
            <div class="abele-ai-provider__remote-label">
              {{ remoteModels[provider.id].length }} models available
            </div>
            <input
              type="text"
              class="abele-ai-provider__remote-filter"
              placeholder="Filter models..."
              :value="modelFilter[provider.id] || ''"
              @input="modelFilter[provider.id] = ($event.target as HTMLInputElement).value"
            />
            <div class="abele-ai-provider__remote-list">
              <div
                v-for="rm in filteredRemoteModels(provider.id)"
                :key="rm.id"
                class="abele-ai-provider__remote-item"
                :class="{
                  'abele-ai-provider__remote-item_added': isModelAdded(pIdx, rm.id),
                }"
                @click="toggleRemoteModel(pIdx, rm.id)"
              >
                <div
                  class="checkbox-container"
                  :class="{ 'is-enabled': isModelAdded(pIdx, rm.id) }"
                />
                <span>{{ rm.id }}</span>
                <span v-if="rm.owned_by" class="abele-ai-provider__remote-owner">{{
                  rm.owned_by
                }}</span>
              </div>
            </div>
          </div>

          <!-- Fetch error -->
          <div v-if="fetchError[provider.id]" class="abele-ai-provider__fetch-error">
            {{ fetchError[provider.id] }}
          </div>

          <!-- Added models (editable details) -->
          <div v-for="(model, mIdx) in provider.models" :key="model.id" class="abele-ai-model">
            <div class="abele-ai-model__header">
              <span class="abele-ai-model__id">{{ model.id }}</span>
              <Icon icon="trash" @click="removeModel(pIdx, mIdx)" />
            </div>
            <Setting name="Display name" desc="Optional label shown in model selector.">
              <Input
                :model-value="model.name"
                placeholder="e.g. GPT-4o"
                @update:model-value="updateModel(pIdx, mIdx, 'name', $event)"
              />
            </Setting>
            <Setting name="Context window" desc="Maximum input tokens the model supports.">
              <Input
                :model-value="String(model.contextWindow)"
                @update:model-value="
                  updateModel(pIdx, mIdx, 'contextWindow', parseInt($event) || 0)
                "
              />
            </Setting>
            <Setting name="Max output tokens" desc="Maximum tokens in a single response.">
              <Input
                :model-value="String(model.maxTokens)"
                @update:model-value="updateModel(pIdx, mIdx, 'maxTokens', parseInt($event) || 0)"
              />
            </Setting>
            <Setting name="Reasoning" desc="Enable reasoning/thinking for supported models.">
              <Checkbox
                :is-enabled="model.supportsReasoning"
                @toggle="updateModel(pIdx, mIdx, 'supportsReasoning', !model.supportsReasoning)"
              />
            </Setting>
          </div>
        </div>
      </div>

      <Button text="Add Provider" @click="addProvider" />

      <h3>Active Configuration</h3>

      <Setting name="Primary Model" desc="The main model used for chat.">
        <Dropdown
          :model-value="activeModelKey"
          :options="modelOptions"
          @update:model-value="selectActiveModel($event)"
        />
      </Setting>

      <Setting name="Auxiliary Model" desc="Used for summarization and compaction.">
        <Dropdown
          :model-value="auxModelKey"
          :options="[{ value: '', display: 'Same as primary' }, ...modelOptions]"
          @update:model-value="selectAuxModel($event)"
        />
      </Setting>

      <Setting
        name="Wise Model"
        desc="Powerful model the agent can consult for complex analysis via the wise_model tool."
      >
        <Dropdown
          :model-value="wiseModelKey"
          :options="[{ value: '', display: 'Not configured' }, ...modelOptions]"
          @update:model-value="selectWiseModel($event)"
        />
      </Setting>

      <Setting
        name="Sequential Auxiliary"
        desc="Run auxiliary tasks after the main model finishes. Enable for local models with limited throughput."
      >
        <Checkbox :is-enabled="sequentialAuxiliary" @toggle="toggleSequentialAuxiliary" />
      </Setting>

      <h3>Chat Storage</h3>

      <Setting
        name="Chat path template"
        desc="Path template for chat files. Variables: {{name}}, {{date:YYYY-MM-DD}}."
      >
        <Input
          :model-value="chatFolder"
          placeholder="AI/Chats/{{name}}"
          @update:model-value="updateField('chatFolder', $event)"
        />
      </Setting>

      <Setting
        name="Migrate chats"
        desc="Move existing chat files to match the current path template."
      >
        <Button
          :text="migrating ? 'Migrating...' : 'Migrate'"
          :disabled="migrating"
          @click="migrateChats"
        />
      </Setting>

      <h3>Integrations</h3>

      <Setting name="Brave Search API Key" desc="Stored securely in keychain.">
        <div class="abele-ai-provider__secret">
          <span v-if="getSecretDisplay(braveSearchApiKey)" class="abele-ai-provider__secret-mask">
            {{ getSecretDisplay(braveSearchApiKey) }}
          </span>
          <div class="abele-ai-provider__secret-row">
            <input
              type="password"
              class="abele-ai-provider__secret-input"
              :value="braveSecretInput"
              :placeholder="getSecretDisplay(braveSearchApiKey) ? 'New key...' : 'BSA...'"
              @input="braveSecretInput = ($event.target as HTMLInputElement).value"
              @keydown.enter="applyBraveSecret"
            />
            <Icon v-if="braveSecretInput" icon="check" with-bg @click="applyBraveSecret" />
          </div>
        </div>
      </Setting>

      <Setting
        name="OpenRouter API Key"
        desc="Used for image generation/editing. Stored securely in keychain."
      >
        <div class="abele-ai-provider__secret">
          <span v-if="getSecretDisplay(openRouterApiKey)" class="abele-ai-provider__secret-mask">
            {{ getSecretDisplay(openRouterApiKey) }}
          </span>
          <div class="abele-ai-provider__secret-row">
            <input
              type="password"
              class="abele-ai-provider__secret-input"
              :value="openRouterSecretInput"
              :placeholder="getSecretDisplay(openRouterApiKey) ? 'New key...' : 'sk-or-...'"
              @input="openRouterSecretInput = ($event.target as HTMLInputElement).value"
              @keydown.enter="applyOpenRouterSecret"
            />
            <Icon
              v-if="openRouterSecretInput"
              icon="check"
              with-bg
              @click="applyOpenRouterSecret"
            />
          </div>
        </div>
      </Setting>

      <Setting name="Image Model" desc="OpenRouter model for image generation/editing.">
        <Input
          :model-value="imageModel"
          placeholder="google/gemini-2.5-flash-preview:thinking"
          @update:model-value="updateImageModel"
        />
      </Setting>

      <h3>Default Scope</h3>

      <AiScopeEditor
        :entries="defaultScope"
        :full-vault-access="defaultFullVaultAccess"
        @update:entries="updateDefaultScope"
        @update:full-vault-access="updateDefaultFullVault"
      />

      <h3>Default Permissions</h3>

      <Setting
        name="Allow web search"
        desc="Default for new chats. Can be changed per chat in the scope manager."
      >
        <Checkbox :is-enabled="defaultAllowWebSearch" @toggle="toggleDefault('allowWebSearch')" />
      </Setting>

      <Setting
        name="Allow fetch"
        desc="Default for new chats. Can be changed per chat in the scope manager."
      >
        <Checkbox :is-enabled="defaultAllowFetch" @toggle="toggleDefault('allowFetch')" />
      </Setting>

      <Setting
        name="Allow wise model"
        desc="Default for new chats. Can be changed per chat in the scope manager."
      >
        <Checkbox :is-enabled="defaultAllowWiseModel" @toggle="toggleDefault('allowWiseModel')" />
      </Setting>

      <Setting
        name="Allow image generation"
        desc="Default for new chats. Can be changed per chat in the scope manager."
      >
        <Checkbox
          :is-enabled="defaultAllowImageGeneration"
          @toggle="toggleDefault('allowImageGeneration')"
        />
      </Setting>

      <Setting
        name="Allow eval JS"
        desc="Default for new chats. Can be changed per chat in the scope manager."
      >
        <Checkbox :is-enabled="defaultAllowEvalJs" @toggle="toggleDefault('allowEvalJs')" />
      </Setting>

      <h3>Prompts</h3>

      <Setting name="System Prompt (base)" desc="The base system prompt sent to the AI agent.">
        <Input
          :model-value="prompts.system || ''"
          as-text-area
          :placeholder="defaultPrompts.system"
          @update:model-value="updatePrompt('system', $event)"
        />
      </Setting>

      <Setting
        name="Title Generation Prompt"
        desc="Prompt for generating chat titles. Use {{messages}} as placeholder."
      >
        <Input
          :model-value="prompts.titleGeneration || ''"
          as-text-area
          :placeholder="defaultPrompts.titleGeneration"
          @update:model-value="updatePrompt('titleGeneration', $event)"
        />
      </Setting>

      <Setting name="Title System Prompt" desc="System prompt for the title generation model.">
        <Input
          :model-value="prompts.titleSystem || ''"
          as-text-area
          :placeholder="defaultPrompts.titleSystem"
          @update:model-value="updatePrompt('titleSystem', $event)"
        />
      </Setting>

      <Setting
        name="Compact Prompt"
        desc="Prompt for summarizing conversation history. Use {{messages}} as placeholder."
      >
        <Input
          :model-value="prompts.compactPrompt || ''"
          as-text-area
          :placeholder="defaultPrompts.compactPrompt"
          @update:model-value="updatePrompt('compactPrompt', $event)"
        />
      </Setting>

      <div class="abele-ai-prompts__tools">
        <div
          class="abele-ai-prompts__tools-header"
          @click="toolDescriptionsOpen = !toolDescriptionsOpen"
        >
          <Icon :icon="toolDescriptionsOpen ? 'chevron-down' : 'chevron-right'" />
          <span>Tool Descriptions</span>
        </div>

        <template v-if="toolDescriptionsOpen">
          <Setting
            v-for="(desc, toolName) in defaultPrompts.toolDescriptions"
            :key="toolName"
            :name="toolName"
            :desc="`Description sent to the model for the '${toolName}' tool.`"
          >
            <Input
              :model-value="prompts.toolDescriptions?.[toolName] || ''"
              as-text-area
              :placeholder="desc"
              @update:model-value="updateToolDescription(toolName, $event)"
            />
          </Setting>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { Notice, debounce } from 'obsidian'
import { nanoid } from 'nanoid'
import AiScopeEditor from '../AiScopeEditor.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Icon from '../obsidian/Icon.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatStorage } from '@/ai/ChatStorage'
import { OpenAIClient } from '@/ai/client'
import type { RemoteModel } from '@/ai/client'
import type { AiProvider, AiModelConfig, AiPrompts } from '@/ai/types'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

const DEFAULT_CONTEXT_WINDOW = 128000
const DEFAULT_MAX_TOKENS = 4096

const config = AbeleConfig.getInstance()
const { app } = GlobalStore.getInstance()
const client = new OpenAIClient()
const migrating = ref(false)

const migrateChats = async () => {
  migrating.value = true
  try {
    const count = await ChatStorage.getInstance().migrateChats()
    new Notice(`Migrated ${count} chat(s)`)
  } catch (err: unknown) {
    new Notice(`Migration failed: ${err instanceof Error ? err.message : err}`)
  } finally {
    migrating.value = false
  }
}

const defaultAllowWebSearch = ref(config.ai.allowWebSearch)
const defaultAllowFetch = ref(config.ai.allowFetch)
const defaultAllowWiseModel = ref(config.ai.allowWiseModel)
const defaultAllowImageGeneration = ref(config.ai.allowImageGeneration)
const defaultAllowEvalJs = ref(config.ai.allowEvalJs)
const defaultScope = ref(JSON.parse(JSON.stringify(config.ai.defaultScope || [])))
const defaultFullVaultAccess = ref(config.ai.defaultFullVaultAccess)

const updateDefaultScope = (entries: any[]) => {
  defaultScope.value = entries
  save()
}

const updateDefaultFullVault = (value: boolean) => {
  defaultFullVaultAccess.value = value
  save()
}

const enabled = ref(config.ai.enabled)
const providers = ref<AiProvider[]>(JSON.parse(JSON.stringify(config.ai.providers)))
const chatFolder = ref(config.ai.chatFolder)
const braveSearchApiKey = ref(config.ai.braveSearchApiKey)
const openRouterApiKey = ref(config.ai.openRouterApiKey)
const imageModel = ref(config.ai.imageModel)
const openRouterSecretInput = ref('')
const activeProviderId = ref(config.ai.activeProviderId)
const activeModelId = ref(config.ai.activeModelId)
const auxiliaryModelId = ref(config.ai.auxiliaryModelId)
const wiseModelId = ref(config.ai.wiseModelId)
const sequentialAuxiliary = ref(config.ai.sequentialAuxiliary)
const prompts = ref<Partial<AiPrompts>>(
  config.ai.prompts ? JSON.parse(JSON.stringify(config.ai.prompts)) : {}
)
const defaultPrompts = DEFAULT_AI_SETTINGS.prompts
const toolDescriptionsOpen = ref(false)

// Remote models state
const remoteModels = reactive<Record<string, RemoteModel[]>>({})
const fetchingModels = ref<number | null>(null)
const fetchError = reactive<Record<string, string>>({})
const modelFilter = reactive<Record<string, string>>({})

const filteredRemoteModels = (providerId: string): RemoteModel[] => {
  const all = remoteModels[providerId] || []
  const filter = (modelFilter[providerId] || '').toLowerCase()
  if (!filter) return all
  return all.filter(
    (m) => m.id.toLowerCase().includes(filter) || m.owned_by?.toLowerCase().includes(filter)
  )
}

const activeModelKey = computed(() =>
  activeProviderId.value && activeModelId.value
    ? `${activeProviderId.value}::${activeModelId.value}`
    : ''
)

const auxModelKey = computed(() =>
  activeProviderId.value && auxiliaryModelId.value
    ? `${activeProviderId.value}::${auxiliaryModelId.value}`
    : ''
)

const wiseModelKey = computed(() => {
  if (!wiseModelId.value) return ''
  for (const p of providers.value) {
    if (p.models.some((m) => m.id === wiseModelId.value)) {
      return `${p.id}::${wiseModelId.value}`
    }
  }
  return ''
})

const modelOptions = computed(() => {
  const options: { value: string; display: string }[] = []
  for (const p of providers.value) {
    for (const m of p.models) {
      options.push({
        value: `${p.id}::${m.id}`,
        display: `${p.name} / ${m.name || m.id}`,
      })
    }
  }
  return options
})

const save = debounce(async () => {
  config.ai = {
    enabled: enabled.value,
    providers: JSON.parse(JSON.stringify(providers.value)),
    activeProviderId: activeProviderId.value,
    activeModelId: activeModelId.value,
    auxiliaryModelId: auxiliaryModelId.value,
    wiseModelId: wiseModelId.value,
    sequentialAuxiliary: sequentialAuxiliary.value,
    permissionMode: config.ai.permissionMode,
    allowWebSearch: defaultAllowWebSearch.value,
    allowFetch: defaultAllowFetch.value,
    allowWiseModel: defaultAllowWiseModel.value,
    allowImageGeneration: defaultAllowImageGeneration.value,
    allowEvalJs: defaultAllowEvalJs.value,
    defaultScope: JSON.parse(JSON.stringify(defaultScope.value)),
    defaultFullVaultAccess: defaultFullVaultAccess.value,
    chatFolder: chatFolder.value,
    chatHistory: config.ai.chatHistory || [],
    braveSearchApiKey: braveSearchApiKey.value,
    openRouterApiKey: openRouterApiKey.value,
    imageModel: imageModel.value,
    prompts: JSON.parse(JSON.stringify(prompts.value)),
  }
  await config.saveSettings()
}, 500)

const toggleEnabled = () => {
  enabled.value = !enabled.value
  save()
}

const toggleSequentialAuxiliary = () => {
  sequentialAuxiliary.value = !sequentialAuxiliary.value
  save()
}

const toggleDefault = (
  key: 'allowWebSearch' | 'allowFetch' | 'allowWiseModel' | 'allowImageGeneration' | 'allowEvalJs'
) => {
  if (key === 'allowWebSearch') defaultAllowWebSearch.value = !defaultAllowWebSearch.value
  if (key === 'allowFetch') defaultAllowFetch.value = !defaultAllowFetch.value
  if (key === 'allowWiseModel') defaultAllowWiseModel.value = !defaultAllowWiseModel.value
  if (key === 'allowImageGeneration')
    defaultAllowImageGeneration.value = !defaultAllowImageGeneration.value
  if (key === 'allowEvalJs') defaultAllowEvalJs.value = !defaultAllowEvalJs.value
  save()
}

// ── Secret helpers ──────────────────────────────────────────

const getSecretDisplay = (secretId: string): string => {
  if (!secretId) return ''
  const secret = app.secretStorage.getSecret(secretId)
  if (!secret) return ''
  if (secret.length <= 8) return '••••••••'
  return secret.slice(0, 4) + '••••' + secret.slice(-4)
}

const secretInputs = reactive<Record<string, string>>({})
const braveSecretInput = ref('')

const applyProviderSecret = (pIdx: number) => {
  const provider = providers.value[pIdx]
  const value = secretInputs[provider.id]
  if (!value) return
  if (!provider.apiKeyId || !provider.apiKeyId.startsWith('abele-')) {
    provider.apiKeyId = `abele-provider-${provider.id.toLowerCase().replace(/[^a-z0-9-]/g, '')}`
  }
  app.secretStorage.setSecret(provider.apiKeyId, value)
  secretInputs[provider.id] = ''
  save()
}

const applyBraveSecret = () => {
  if (!braveSecretInput.value) return
  braveSearchApiKey.value = 'abele-brave-search'
  app.secretStorage.setSecret('abele-brave-search', braveSecretInput.value)
  braveSecretInput.value = ''
  save()
}

const updateImageModel = (val: string) => {
  imageModel.value = val
  save()
}

const applyOpenRouterSecret = () => {
  if (!openRouterSecretInput.value) return
  openRouterApiKey.value = 'abele-openrouter'
  app.secretStorage.setSecret('abele-openrouter', openRouterSecretInput.value)
  openRouterSecretInput.value = ''
  save()
}

// ── Provider management ─────────────────────────────────────

const addProvider = () => {
  const id = nanoid(8)
  providers.value.push({
    id,
    name: '',
    baseUrl: '',
    apiKeyId: `abele-provider-${id.toLowerCase().replace(/[^a-z0-9-]/g, '')}`,
    models: [],
  })
  save()
}

const removeProvider = (idx: number) => {
  const provider = providers.value[idx]
  if (provider.apiKeyId?.startsWith('abele-')) {
    // deleteSecret exists at runtime but is missing from obsidian.d.ts (as of 1.12.3)
    ;(app.secretStorage as any).deleteSecret(provider.apiKeyId)
  }
  providers.value.splice(idx, 1)
  delete remoteModels[provider.id]
  delete fetchError[provider.id]
  save()
}

const updateProvider = (idx: number, field: keyof AiProvider, value: string) => {
  ;(providers.value[idx] as Record<string, unknown>)[field] = value
  save()
}

const fetchModels = async (pIdx: number) => {
  const provider = providers.value[pIdx]
  if (!provider.baseUrl || !provider.apiKeyId) return
  const apiKey = app.secretStorage.getSecret(provider.apiKeyId)
  if (!apiKey) return

  fetchingModels.value = pIdx
  delete fetchError[provider.id]

  try {
    const models = await client.fetchModels(provider.baseUrl, apiKey)
    remoteModels[provider.id] = models
  } catch (err: unknown) {
    fetchError[provider.id] = err instanceof Error ? err.message : String(err)
  } finally {
    fetchingModels.value = null
  }
}

const isModelAdded = (pIdx: number, modelId: string): boolean => {
  return providers.value[pIdx].models.some((m) => m.id === modelId)
}

const toggleRemoteModel = (pIdx: number, modelId: string) => {
  const provider = providers.value[pIdx]
  const existingIdx = provider.models.findIndex((m) => m.id === modelId)

  if (existingIdx !== -1) {
    provider.models.splice(existingIdx, 1)
  } else {
    provider.models.push({
      id: modelId,
      name: '',
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
      supportsReasoning: false,
    })
  }
  save()
}

const addModel = (providerIdx: number) => {
  providers.value[providerIdx].models.push({
    id: '',
    name: '',
    contextWindow: 128000,
    maxTokens: 4096,
    supportsReasoning: false,
  })
  save()
}

const removeModel = (pIdx: number, mIdx: number) => {
  providers.value[pIdx].models.splice(mIdx, 1)
  save()
}

const updateModel = (
  pIdx: number,
  mIdx: number,
  field: keyof AiModelConfig,
  value: string | number | boolean
) => {
  ;(providers.value[pIdx].models[mIdx] as Record<string, unknown>)[field] = value
  save()
}

const selectActiveModel = (key: string) => {
  const [pId, mId] = key.split('::')
  activeProviderId.value = pId || ''
  activeModelId.value = mId || ''
  save()
}

const selectAuxModel = (key: string) => {
  if (!key) {
    auxiliaryModelId.value = ''
  } else {
    const [, mId] = key.split('::')
    auxiliaryModelId.value = mId || ''
  }
  save()
}

const selectWiseModel = (key: string) => {
  if (!key) {
    wiseModelId.value = ''
  } else {
    const [, mId] = key.split('::')
    wiseModelId.value = mId || ''
  }
  save()
}

const updateField = (field: string, value: string) => {
  switch (field) {
    case 'chatFolder':
      chatFolder.value = value
      break
  }
  save()
}

const updatePrompt = (field: keyof Omit<AiPrompts, 'toolDescriptions'>, value: string) => {
  prompts.value = { ...prompts.value, [field]: value }
  save()
}

const updateToolDescription = (toolName: string, value: string) => {
  const descs = { ...(prompts.value.toolDescriptions || {}) }
  if (value) {
    descs[toolName] = value
  } else {
    delete descs[toolName]
  }
  prompts.value = { ...prompts.value, toolDescriptions: descs }
  save()
}
</script>

<style lang="scss">
.abele-ai-provider {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-3);
  margin-bottom: var(--size-4-3);
}

.abele-ai-provider__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--size-4-2);
}

.abele-ai-provider__secret {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-ai-provider__secret-mask {
  font-family: var(--font-monospace);
  font-size: var(--font-small);
  color: var(--text-muted);
}

.abele-ai-provider__secret-row {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
}

.abele-ai-provider__secret-input {
  flex: 1;
}

.abele-ai-provider__models {
  margin-top: var(--size-4-2);
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

.abele-ai-provider__remote-models {
  margin-bottom: var(--size-4-2);
}

.abele-ai-provider__remote-label {
  font-size: var(--font-small);
  color: var(--text-muted);
  margin-bottom: var(--size-4-1);
}

.abele-ai-provider__remote-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
}

.abele-ai-provider__remote-item {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-2);
  cursor: pointer;
  font-size: var(--font-small);

  &:hover {
    background-color: var(--background-modifier-hover);
  }

  &_added {
    background-color: var(--background-secondary);
  }
}

.abele-ai-provider__remote-owner {
  color: var(--text-faint);
  margin-left: auto;
}

.abele-ai-provider__fetch-error {
  color: var(--text-error);
  font-size: var(--font-small);
  padding: var(--size-4-1);
}

.abele-ai-provider__remote-filter {
  width: 100%;
  margin-bottom: var(--size-4-1);
}

.abele-ai-model {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-2);
  margin-bottom: var(--size-4-2);
}

.abele-ai-model__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--size-4-1);
}

.abele-ai-model__id {
  font-family: var(--font-monospace);
  font-size: var(--font-small);
  color: var(--text-accent);
}

.abele-ai-prompts__tools {
  margin-top: var(--size-4-2);
}

.abele-ai-prompts__tools-header {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  cursor: pointer;
  padding: var(--size-4-2) 0;
  font-weight: var(--font-semibold);
  color: var(--text-normal);

  &:hover {
    color: var(--text-accent);
  }
}
</style>
