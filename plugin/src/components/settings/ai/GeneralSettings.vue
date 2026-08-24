<template>
  <div class="abele-settings__ai">
    <Setting name="AI Agent" desc="Enable AI agent features including the chat sidebar.">
      <Checkbox :is-enabled="enabled" @toggle="toggleEnabled" />
    </Setting>

    <template v-if="enabled">
      <Section title="Providers">
        <div v-for="(provider, pIdx) in providers" :key="provider.id" class="abele-ai-provider">
          <div class="abele-ai-provider__header">
            <strong class="abele-ai-provider__name">{{
              provider.name || 'Unnamed Provider'
            }}</strong>
            <Icon
              icon="trash"
              tooltip="Remove this provider and its models"
              @click="askRemoveProvider(pIdx)"
            />
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
              <span
                v-if="getSecretDisplay(provider.apiKeyId)"
                class="abele-ai-provider__secret-mask"
              >
                {{ getSecretDisplay(provider.apiKeyId) }}
              </span>
              <div class="abele-ai-provider__secret-row">
                <input
                  type="password"
                  class="abele-obsidian-input"
                  :value="secretInputs[provider.id] || ''"
                  :placeholder="getSecretDisplay(provider.apiKeyId) ? 'New key...' : 'sk-...'"
                  @input="secretInputs[provider.id] = ($event.target as HTMLInputElement).value"
                  @keydown.enter="applyProviderSecret(pIdx)"
                />
                <Icon
                  v-if="secretInputs[provider.id]"
                  icon="check"
                  with-bg
                  tooltip="Save key"
                  @click="applyProviderSecret(pIdx)"
                />
              </div>
            </div>
          </Setting>

          <div class="abele-ai-provider__models">
            <div class="abele-ai-provider__models-header">
              <span>Models</span>
              <div class="abele-ai-provider__models-actions">
                <Icon
                  icon="download"
                  tooltip="Fetch models from API"
                  :disabled="!provider.baseUrl || !provider.apiKeyId || fetchingModels === pIdx"
                  @click="fetchModels(pIdx)"
                />
                <Icon icon="plus" tooltip="Add model manually" @click="addModel(pIdx)" />
              </div>
            </div>

            <!-- Fetched models picker -->
            <div v-if="remoteModels[provider.id]?.length" class="abele-ai-provider__remote-models">
              <div class="abele-ai-provider__remote-label">
                {{ remoteModels[provider.id].length }} models available
              </div>
              <input
                type="text"
                class="abele-obsidian-input"
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
                  <Checkbox
                    :is-enabled="isModelAdded(pIdx, rm.id)"
                    @toggle="toggleRemoteModel(pIdx, rm.id)"
                  />
                  <span>{{ rm.id }}</span>
                  <span v-if="rm.owned_by" class="abele-ai-provider__remote-owner">
                    {{ rm.owned_by }}
                  </span>
                </div>
              </div>
            </div>

            <div v-if="fetchError[provider.id]" class="abele-ai-provider__fetch-error">
              {{ fetchError[provider.id] }}
            </div>

            <CardGrid>
              <Card
                v-for="(model, mIdx) in provider.models"
                :key="mIdx"
                :title="model.name || model.id"
                :subtitle="model.id"
                :meta="[
                  formatTokens(model.contextWindow) + ' ctx',
                  formatTokens(model.maxTokens) + ' out',
                ]"
                clickable
                @click="openModelEdit(pIdx, mIdx)"
              >
                <template #badges>
                  <Badge v-if="model.supportsReasoning" text="reasoning" />
                </template>
              </Card>
            </CardGrid>

            <EmptyState v-if="!provider.models.length" text="No models yet." />

            <ModelEditModal
              v-if="editingModel?.pIdx === pIdx"
              :model="editingModel.model"
              :is-new="editingModel.isNew"
              @save="onModelSave(pIdx, editingModel.mIdx, $event)"
              @delete="removeModel(pIdx, editingModel.mIdx)"
              @close="editingModel = null"
            />
          </div>
        </div>

        <div class="abele-settings__ai-actions">
          <Button
            text="Add Provider"
            tooltip="Add another OpenAI-compatible provider"
            @click="addProvider"
          />
        </div>
      </Section>

      <Section
        title="Background Model"
        desc="Chat models are chosen per agent, on the Agents tab. This one is used for the
          plugin's own background work — naming chats and compacting long conversations."
      >
        <Setting name="Auxiliary Model" desc="Used for chat titles and compaction.">
          <Dropdown
            :model-value="auxModelKey"
            :options="[{ value: '', display: 'First available' }, ...modelOptions]"
            @update:model-value="selectAuxModel($event)"
          />
        </Setting>

        <Setting
          name="Sequential Auxiliary"
          desc="Run auxiliary tasks after the main model finishes. Enable for local models with limited throughput."
        >
          <Checkbox :is-enabled="sequentialAuxiliary" @toggle="toggleSequentialAuxiliary" />
        </Setting>
      </Section>

      <Section title="Chat Storage">
        <Setting
          name="Chat path template"
          :desc="`Path template for chat files. Variables: ${NAME_TOKEN}, ${DATE_TOKEN}.`"
        >
          <Input
            :model-value="chatFolder"
            placeholder="AI/Chats"
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
            tooltip="Move existing chat files to match the template above"
            @click="migrateChats"
          />
        </Setting>
      </Section>

      <Section title="Integrations">
        <Setting name="Brave Search API Key" desc="Stored securely in keychain.">
          <div class="abele-ai-provider__secret">
            <span v-if="getSecretDisplay(braveSearchApiKey)" class="abele-ai-provider__secret-mask">
              {{ getSecretDisplay(braveSearchApiKey) }}
            </span>
            <div class="abele-ai-provider__secret-row">
              <input
                type="password"
                class="abele-obsidian-input"
                :value="braveSecretInput"
                :placeholder="getSecretDisplay(braveSearchApiKey) ? 'New key...' : 'BSA...'"
                @input="braveSecretInput = ($event.target as HTMLInputElement).value"
                @keydown.enter="applyBraveSecret"
              />
              <Icon
                v-if="braveSecretInput"
                icon="check"
                with-bg
                tooltip="Save key"
                @click="applyBraveSecret"
              />
            </div>
          </div>
        </Setting>
      </Section>

      <Section title="Image Generation">
        <div v-for="(ip, ipIdx) in imageProviders" :key="ipIdx" class="abele-ai-provider">
          <div class="abele-ai-provider__header">
            <strong class="abele-ai-provider__name">{{ ip.name || 'Unnamed Provider' }}</strong>
            <Icon
              icon="trash"
              tooltip="Remove this provider and its models"
              @click="askRemoveImageProvider(ipIdx)"
            />
          </div>

          <Setting name="ID" desc="Short identifier used in model keys (e.g. openai, openrouter).">
            <Input
              :model-value="ip.id"
              placeholder="e.g. openai"
              @update:model-value="updateImageProvider(ipIdx, 'id', $event)"
            />
          </Setting>

          <Setting name="Name" desc="Display name for this provider.">
            <Input
              :model-value="ip.name"
              @update:model-value="updateImageProvider(ipIdx, 'name', $event)"
            />
          </Setting>

          <Setting
            name="API Type"
            desc="OpenAI uses /v1/images/generations, OpenRouter uses chat completions."
          >
            <Dropdown
              :model-value="ip.apiType"
              :options="IMAGE_API_TYPES"
              @update:model-value="updateImageProvider(ipIdx, 'apiType', $event)"
            />
          </Setting>

          <Setting
            name="Endpoint"
            :desc="'Leave empty for default: ' + imgEndpointDefault(ip.apiType)"
          >
            <Input
              :model-value="ip.endpoint"
              :placeholder="imgEndpointDefault(ip.apiType)"
              @update:model-value="updateImageProvider(ipIdx, 'endpoint', $event)"
            />
          </Setting>

          <Setting name="API Key" desc="Stored securely in keychain.">
            <div class="abele-ai-provider__secret">
              <span v-if="getSecretDisplay(ip.apiKeyId)" class="abele-ai-provider__secret-mask">
                {{ getSecretDisplay(ip.apiKeyId) }}
              </span>
              <div class="abele-ai-provider__secret-row">
                <input
                  type="password"
                  class="abele-obsidian-input"
                  :value="imgSecretInputs[ip.id] || ''"
                  :placeholder="getSecretDisplay(ip.apiKeyId) ? 'New key...' : 'sk-...'"
                  @input="imgSecretInputs[ip.id] = ($event.target as HTMLInputElement).value"
                  @keydown.enter="applyImageProviderSecret(ipIdx)"
                />
                <Icon
                  v-if="imgSecretInputs[ip.id]"
                  icon="check"
                  with-bg
                  tooltip="Save key"
                  @click="applyImageProviderSecret(ipIdx)"
                />
              </div>
            </div>
          </Setting>

          <div class="abele-ai-provider__models">
            <div class="abele-ai-provider__models-header">
              <span>Models</span>
              <Icon icon="plus" tooltip="Add model" @click="addImageModel(ipIdx)" />
            </div>

            <CardGrid>
              <Card
                v-for="(im, imIdx) in ip.models"
                :key="imIdx"
                :title="im.name || im.id"
                :subtitle="`${ip.id}::${im.id}`"
                :meta="ip.apiType === 'openai' ? [im.size, im.quality, im.outputFormat] : []"
                clickable
                @click="openImageModelEdit(ipIdx, imIdx)"
              />
            </CardGrid>

            <ImageModelEditModal
              v-if="editingImageModel?.pIdx === ipIdx"
              :model="editingImageModel.model"
              :is-new="editingImageModel.isNew"
              :is-open-ai="ip.apiType === 'openai'"
              @save="onImageModelSave(ipIdx, editingImageModel.mIdx, $event)"
              @delete="removeImageModel(ipIdx, editingImageModel.mIdx)"
              @close="editingImageModel = null"
            />
          </div>
        </div>

        <div class="abele-settings__ai-actions">
          <Button
            text="Add Image Provider"
            tooltip="Add another image generation provider"
            @click="addImageProvider"
          />
        </div>

        <Setting name="Default Image Model" desc="Used when agent doesn't specify a model.">
          <Dropdown
            :model-value="defaultImageModel"
            :options="[{ value: '', display: 'Not configured' }, ...imageModelOptions]"
            @update:model-value="selectDefaultImageModel"
          />
        </Setting>
      </Section>

      <Section title="Secrets">
        <template #desc>
          Keys and tokens for API requests. AI agent uses <code>${abele_key:name}</code> in fetch
          calls, which is replaced with the actual value. Stored securely in keychain.
        </template>

        <CardGrid>
          <Card
            v-for="(secret, sIdx) in secrets"
            :key="sIdx"
            :title="secret.name || '(unnamed)'"
            :subtitle="
              editingSecretIdx === sIdx ? undefined : getSecretDisplay(secret.keyId) || '(not set)'
            "
            :clickable="editingSecretIdx !== sIdx"
            @click="startEditSecret(sIdx)"
          >
            <template v-if="editingSecretIdx === sIdx">
              <Input
                :model-value="secret.name"
                placeholder="Secret name"
                @update:model-value="(v: string) => updateSecretName(sIdx, v)"
              />
              <div class="abele-ai-secret__row">
                <input
                  :type="revealedInputs[sIdx] ? 'text' : 'password'"
                  class="abele-obsidian-input"
                  :value="secretValueInputs[sIdx] || ''"
                  placeholder="Value..."
                  @input="secretValueInputs[sIdx] = ($event.target as HTMLInputElement).value"
                  @keydown.enter="applySecretValue(sIdx)"
                />
                <Icon
                  :icon="revealedInputs[sIdx] ? 'eye-off' : 'eye'"
                  :tooltip="revealedInputs[sIdx] ? 'Hide' : 'Reveal'"
                  @click="revealedInputs[sIdx] = !revealedInputs[sIdx]"
                />
                <Icon icon="copy" tooltip="Copy" @click="copySecret(secret.keyId)" />
              </div>
              <div class="abele-ai-secret__row">
                <Button
                  text="Save"
                  :disabled="!secretValueInputs[sIdx]"
                  tooltip="Store this value in the keychain"
                  @click="applySecretValue(sIdx)"
                />
                <Icon icon="trash" tooltip="Remove this secret" @click="askRemoveSecret(sIdx)" />
                <Icon icon="x" tooltip="Done" @click="editingSecretIdx = -1" />
              </div>
            </template>
          </Card>
        </CardGrid>

        <div class="abele-settings__ai-actions">
          <Button text="Add secret" tooltip="Add another named secret" @click="addSecret" />
        </div>
      </Section>

      <Section
        title="Tool Descriptions"
        desc="What each tool tells the model about itself. Shared by every agent — which tools an
          agent may use is set per agent, on the Agents tab."
      >
        <ToolModesEditor
          :tool-modes="{}"
          :descriptions-only="true"
          :show-descriptions="true"
          :tool-descriptions="customToolDescriptions"
          @update-description="onToolDescriptionUpdate"
        />
      </Section>

      <Section title="Background Prompts">
        <Setting
          name="Title Generation Prompt"
          :desc="`Prompt for generating chat titles. Use ${MESSAGES_TOKEN} as placeholder.`"
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
          :desc="`Prompt for summarizing conversation history. Use ${MESSAGES_TOKEN} as placeholder.`"
        >
          <Input
            :model-value="prompts.compactPrompt || ''"
            as-text-area
            :placeholder="defaultPrompts.compactPrompt"
            @update:model-value="updatePrompt('compactPrompt', $event)"
          />
        </Setting>
      </Section>

      <ConfirmModal
        v-if="pendingRemoval"
        :title="pendingRemoval.title"
        :message="pendingRemoval.message"
        :confirm-tooltip="pendingRemoval.title"
        @confirm="pendingRemoval.run()"
        @close="pendingRemoval = null"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { Notice, debounce } from 'obsidian'
import { nanoid } from 'nanoid'
import Setting from '../../obsidian/Setting.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import Section from '../../obsidian/Section.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Badge from '../../obsidian/Badge.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import ToolModesEditor from '../../ToolModesEditor.vue'
import ModelEditModal from '../ModelEditModal.vue'
import ImageModelEditModal from '../ImageModelEditModal.vue'
import Icon from '../../obsidian/Icon.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatStorage } from '@/ai/ChatStorage'
import { OpenAIClient } from '@/ai/client'
import type { RemoteModel } from '@/ai/client'
import type { AiProvider, AiModelConfig, AiPrompts } from '@/ai/types'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

/** Written out in script: nested moustaches in the template confuse the Vue parser. */
const NAME_TOKEN = '{{name}}'
const DATE_TOKEN = '{{date:YYYY-MM-DD}}'
const MESSAGES_TOKEN = '{{messages}}'

const IMAGE_API_TYPES = [
  { value: 'openai', display: 'OpenAI' },
  { value: 'openrouter', display: 'OpenRouter' },
]

/**
 * The question standing between a trash icon and something being gone. One slot: only one
 * dialog can be open, and holding the action itself keeps the wiring in one place.
 */
const pendingRemoval = ref<{ title: string; message: string; run: () => void } | null>(null)

function askRemoval(title: string, message: string, run: () => void): void {
  pendingRemoval.value = { title, message, run }
}

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

const enabled = ref(config.ai.enabled)
const providers = ref<AiProvider[]>(JSON.parse(JSON.stringify(config.ai.providers)))
const chatFolder = ref(config.ai.chatFolder)
const braveSearchApiKey = ref(config.ai.braveSearchApiKey)
const imageProviders = ref(JSON.parse(JSON.stringify(config.ai.imageProviders || [])))
const defaultImageModel = ref(config.ai.defaultImageModel || '')
const imgSecretInputs = reactive<Record<string, string>>({})
const secrets = ref(JSON.parse(JSON.stringify(config.ai.secrets || [])))
const secretValueInputs = reactive<Record<number, string>>({})
const auxiliaryModelId = ref(config.ai.auxiliaryModelId)
const sequentialAuxiliary = ref(config.ai.sequentialAuxiliary)
const prompts = ref<Partial<AiPrompts>>(
  config.ai.prompts ? JSON.parse(JSON.stringify(config.ai.prompts)) : {}
)
const defaultPrompts = DEFAULT_AI_SETTINGS.prompts
const customToolDescriptions = computed(() => prompts.value.toolDescriptions || {})

const onToolDescriptionUpdate = (toolName: string, value: string) => {
  const descs = { ...(prompts.value.toolDescriptions || {}) }
  if (value) {
    descs[toolName] = value
  } else {
    delete descs[toolName]
  }
  prompts.value = { ...prompts.value, toolDescriptions: descs }
  save()
}

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

const auxModelKey = computed(() => {
  if (!auxiliaryModelId.value) return ''
  for (const p of providers.value) {
    if (p.models.some((m) => m.id === auxiliaryModelId.value)) {
      return `${p.id}::${auxiliaryModelId.value}`
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
  // Merged, never rebuilt. This tab owns providers, keys and background prompts; agents,
  // scripts and chat history belong to other screens, and a wholesale rebuild would silently
  // drop whatever this component does not happen to know about.
  config.ai = {
    ...config.ai,
    enabled: enabled.value,
    providers: JSON.parse(JSON.stringify(providers.value)),
    auxiliaryModelId: auxiliaryModelId.value,
    sequentialAuxiliary: sequentialAuxiliary.value,
    chatFolder: chatFolder.value,
    braveSearchApiKey: braveSearchApiKey.value,
    imageProviders: JSON.parse(JSON.stringify(imageProviders.value)),
    defaultImageModel: defaultImageModel.value,
    secrets: JSON.parse(JSON.stringify(secrets.value)),
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

// ── Image providers ─────────────────────────────────────────

const imgEndpointDefault = (apiType: string) => {
  const defaults: Record<string, string> = {
    openai: 'https://api.openai.com/v1/images/generations',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  }
  return defaults[apiType] || ''
}

const imageModelOptions = computed(() => {
  const options: { value: string; display: string }[] = []
  for (const p of imageProviders.value) {
    for (const m of p.models) {
      options.push({
        value: `${p.id}::${m.id}`,
        display: `${p.name} / ${m.name || m.id}`,
      })
    }
  }
  return options
})

const addImageProvider = () => {
  const id = `img-${Date.now()}`
  imageProviders.value.push({
    id,
    name: '',
    apiType: 'openai',
    endpoint: '',
    apiKeyId: '',
    models: [],
  })
  save()
}

const removeImageProvider = (idx: number) => {
  imageProviders.value.splice(idx, 1)
  save()
}

const askRemoveImageProvider = (idx: number) => {
  const provider = imageProviders.value[idx]
  askRemoval(
    'Remove provider',
    `Remove ${provider.name || provider.id || 'this provider'} and its ` +
      `${provider.models.length} model(s)? This cannot be undone.`,
    () => removeImageProvider(idx)
  )
}

const updateImageProvider = (idx: number, key: string, val: string) => {
  ;(imageProviders.value[idx] as any)[key] = val
  save()
}

const applyImageProviderSecret = (idx: number) => {
  const provider = imageProviders.value[idx]
  const val = imgSecretInputs[provider.id]
  if (!val) return
  const keyId = `abele-img-${provider.id.toLowerCase().replace(/[^a-z0-9-]/g, '')}`
  provider.apiKeyId = keyId
  app.secretStorage.setSecret(keyId, val)
  imgSecretInputs[provider.id] = ''
  save()
}

const editingImageModel = ref<{
  pIdx: number
  mIdx: number
  model: any
  isNew: boolean
} | null>(null)

const addImageModel = (pIdx: number) => {
  const newModel = { id: '', name: '', size: '1024x1024', outputFormat: 'png', quality: 'medium' }
  editingImageModel.value = {
    pIdx,
    mIdx: imageProviders.value[pIdx].models.length,
    model: newModel,
    isNew: true,
  }
}

const openImageModelEdit = (pIdx: number, mIdx: number) => {
  editingImageModel.value = {
    pIdx,
    mIdx,
    model: { ...imageProviders.value[pIdx].models[mIdx] },
    isNew: false,
  }
}

const onImageModelSave = (pIdx: number, mIdx: number, model: any) => {
  const models = imageProviders.value[pIdx].models
  if (mIdx >= models.length) {
    models.push(model)
  } else {
    models[mIdx] = model
  }
  save()
}

const removeImageModel = (pIdx: number, mIdx: number) => {
  imageProviders.value[pIdx].models.splice(mIdx, 1)
  editingImageModel.value = null
  save()
}

const selectDefaultImageModel = (key: string) => {
  defaultImageModel.value = key
  save()
}

// ── User secrets ────────────────────────────────────────────

const editingSecretIdx = ref(-1)

const getSecretFullValue = (secretId: string): string => {
  if (!secretId) return ''
  return app.secretStorage.getSecret(secretId) || ''
}

const revealedInputs = reactive<Record<number, boolean>>({})

const copySecret = (secretId: string) => {
  const value = getSecretFullValue(secretId)
  if (value) navigator.clipboard.writeText(value)
}

const addSecret = () => {
  secrets.value.push({ name: '', keyId: '' })
  editingSecretIdx.value = secrets.value.length - 1
}

const startEditSecret = (idx: number) => {
  editingSecretIdx.value = idx
  const keyId = secrets.value[idx].keyId
  secretValueInputs[idx] = keyId ? getSecretFullValue(keyId) : ''
}

const askRemoveSecret = (idx: number) => {
  const secret = secrets.value[idx]
  askRemoval(
    'Remove secret',
    `Remove ${secret.name || '(unnamed)'}? Any fetch call referring to it by name will stop ` +
      'working, and the stored value is gone from the keychain.',
    () => removeSecret(idx)
  )
}

const removeSecret = (idx: number) => {
  const secret = secrets.value[idx]
  if (secret.keyId) {
    try {
      app.secretStorage.setSecret(secret.keyId, '')
    } catch {
      // Invalid keyId from older version — skip keychain cleanup
    }
  }
  secrets.value.splice(idx, 1)
  delete secretValueInputs[idx]
  save()
}

const updateSecretName = (idx: number, name: string) => {
  secrets.value[idx].name = name
  save()
}

const applySecretValue = (idx: number) => {
  const value = secretValueInputs[idx]
  if (!value) return
  const secret = secrets.value[idx]
  if (!secret.keyId || !/^[a-z0-9-]+$/.test(secret.keyId)) {
    secret.keyId = `abele-secret-${nanoid(8)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '0')}`
  }
  app.secretStorage.setSecret(secret.keyId, value)
  secretValueInputs[idx] = ''
  editingSecretIdx.value = -1
  // Force re-render so getSecretDisplay() re-evaluates with the new keychain value
  secrets.value = [...secrets.value]
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

const askRemoveProvider = (idx: number) => {
  const provider = providers.value[idx]
  askRemoval(
    'Remove provider',
    `Remove ${provider.name || 'this provider'} and its ${provider.models.length} model(s)? ` +
      'Agents pointing at those models will have no model until one is chosen again.',
    () => removeProvider(idx)
  )
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

const editingModel = ref<{
  pIdx: number
  mIdx: number
  model: AiModelConfig
  isNew: boolean
} | null>(null)

const addModel = (providerIdx: number) => {
  const model: AiModelConfig = {
    id: '',
    name: '',
    contextWindow: 128000,
    maxTokens: 4096,
    supportsReasoning: false,
  }
  editingModel.value = {
    pIdx: providerIdx,
    mIdx: providers.value[providerIdx].models.length,
    model,
    isNew: true,
  }
}

const openModelEdit = (pIdx: number, mIdx: number) => {
  editingModel.value = {
    pIdx,
    mIdx,
    model: { ...providers.value[pIdx].models[mIdx] },
    isNew: false,
  }
}

const onModelSave = (pIdx: number, mIdx: number, model: AiModelConfig) => {
  const models = providers.value[pIdx].models
  if (mIdx >= models.length) {
    models.push(model)
  } else {
    models[mIdx] = model
  }
  save()
}

// The edit modal asks before it emits, so there is no second question here.
const removeModel = (pIdx: number, mIdx: number) => {
  providers.value[pIdx].models.splice(mIdx, 1)
  editingModel.value = null
  save()
}

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
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

.abele-ai-secret__row {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  min-width: 0;
}

.abele-settings__ai-actions {
  margin-top: var(--size-4-4);
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

.abele-ai-provider__remote-models {
  margin-bottom: var(--size-4-2);
}

.abele-ai-provider__remote-label {
  font-size: var(--font-small);
  color: var(--text-muted);
  margin-bottom: var(--size-4-1);
}

.abele-ai-provider__remote-list {
  max-height: 12em;
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
  min-width: 0;

  > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

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
</style>
