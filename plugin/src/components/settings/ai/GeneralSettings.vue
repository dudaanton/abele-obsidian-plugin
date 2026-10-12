<template>
  <div class="abele-settings__ai">
    <Setting
      v-if="page === 'general'"
      name="AI Agent"
      desc="Enable AI agent features including the chat sidebar."
    >
      <Checkbox :is-enabled="enabled" @toggle="toggleEnabled" />
    </Setting>

    <!-- The agent's own settings over three tabs: General for what it is and where its things
         live, Models for what it talks to, Prompts for the words it uses — the rare part. -->
    <EmptyState
      v-if="!enabled && page !== 'general'"
      text="The AI agent is off. Turn it on under General."
    />
    <template v-if="enabled && page === 'general'">
      <template v-if="Platform.isMobile">
        <Setting
          name="Keep running in background while agents work"
          desc="Play silent audio while a turn is running. May use more battery; background execution depends on the system."
        >
          <Checkbox :is-enabled="backgroundWhileAgents" @toggle="toggleBackground('whileAgents')" />
        </Setting>
        <Setting
          name="Keep running in background always"
          desc="Play silent audio even when agents are idle. Off by default; may use more battery."
        >
          <Checkbox :is-enabled="backgroundAlways" @toggle="toggleBackground('always')" />
        </Setting>
      </template>
      <Setting
        name="Key destinations"
        desc="Review addresses changed outside this device before sending keys there."
      >
        <Button
          text="Review"
          tooltip="Review and confirm where this device sends keys"
          @click="reviewKeyDestinations"
        />
      </Setting>
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
          name="Rewind space (MB)"
          desc="How much room, on this device, the copies may take that let a chat put back the
            files its agent changed. Chats written to least recently lose theirs first. 0 keeps
            nothing, and chats cannot rewind."
        >
          <Input
            :model-value="String(rewindLimitMb)"
            placeholder="100"
            @update:model-value="updateField('rewindLimitMb', $event)"
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

        <Setting
          name="Comment agent"
          desc="Which agent answers comment chats. Utility agents are offered too — the one
            seeded for comments is one."
        >
          <Dropdown
            :model-value="commentAgentId"
            :options="commentAgentOptions"
            @update:model-value="updateField('commentAgentId', $event)"
          />
        </Setting>

        <Setting name="Comment folder" desc="Where comment chats are stored">
          <Input
            :model-value="commentFolder"
            placeholder="AI/Comments"
            @update:model-value="updateField('commentFolder', $event)"
          />
        </Setting>
      </Section>

      <Section title="Skills">
        <Setting
          name="Skills folder"
          desc="Skills here are offered to every agent. Elsewhere, only skills in the chat's scope are offered; loading another skill asks first. The agent's skill selection still applies."
        >
          <Input
            :model-value="skillsFolder"
            placeholder="AI/Skills"
            @update:model-value="updateField('skillsFolder', $event)"
          />
        </Setting>
      </Section>

      <Section title="Integrations">
        <Setting name="Brave Search API Key" desc="Stored securely in keychain.">
          <SecretField
            :value="storedSecret(braveSearchApiKey)"
            :model-value="braveSecretInput"
            :placeholder="'BSA...'"
            @update:model-value="braveSecretInput = $event"
            @save="applyBraveSecret"
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
            :key="secret.id"
            :title="secret.name || '(unnamed)'"
            :subtitle="
              editingSecretIdx === sIdx ? undefined : getSecretDisplay(secret.keyId) || '(not set)'
            "
            :clickable="editingSecretIdx !== sIdx"
            @click="startEditSecret(sIdx)"
          >
            <!--
              Clicks inside the open editor must not reach the card, which would read them as
              "open me". Save and Cancel both close the card, and the browser runs a microtask
              checkpoint between two listeners of one click — long enough for Vue to re-render
              the card as clickable again before the click finishes bubbling into it.
            -->
            <div v-if="editingSecretIdx === sIdx" class="abele-ai-secret__editor" @click.stop>
              <Input
                :model-value="secret.name"
                placeholder="Secret name"
                @update:model-value="(v: string) => updateSecretName(sIdx, v)"
              />
              <SecretField
                :value="storedSecret(secret.keyId)"
                :model-value="secretValueInputs[secret.id] || ''"
                placeholder="Value..."
                replace-placeholder="Value..."
                @update:model-value="secretValueInputs[secret.id] = $event"
                @save="applySecretValue(sIdx)"
              />
              <Setting
                name="Allowed addresses"
                desc="Add an address from a request's confirmation. Each saved-key request still asks."
              >
                <div>
                  <div v-for="origin in secret.allowedOrigins || []" :key="origin">
                    <span>{{ origin }}</span>
                    <Button
                      text="Remove"
                      tooltip="Remove this address from the key's allowed list"
                      @click="removeSecretOrigin(sIdx, origin)"
                    />
                  </div>
                  <span v-if="!secret.allowedOrigins?.length">None yet</span>
                </div>
              </Setting>
              <div class="abele-ai-secret__row">
                <Icon icon="trash" tooltip="Remove this secret" @click="askRemoveSecret(sIdx)" />
                <Icon
                  icon="x"
                  tooltip="Cancel — leave the stored value as it is"
                  @click="cancelEditSecret(sIdx)"
                />
              </div>
            </div>
          </Card>
        </CardGrid>

        <div class="abele-settings__ai-actions">
          <Button text="Add secret" tooltip="Add another named secret" @click="addSecret" />
        </div>
      </Section>
    </template>

    <template v-if="enabled && page === 'models'">
      <Section title="Providers">
        <ProviderSettings
          v-for="(provider, pIdx) in providers"
          :key="provider.id"
          :name="provider.name"
          :client-name="provider.clientName"
          :secret-value="storedSecret(provider.apiKeyId)"
          :secret-input="secretInputs[provider.id] || ''"
          :summary="modelCount(provider.models?.length ?? 0)"
          @update:name="updateProvider(pIdx, 'name', $event)"
          @update:client-name="updateProvider(pIdx, 'clientName', $event)"
          @update:secret-input="secretInputs[provider.id] = $event"
          @save-secret="applyProviderSecret(pIdx)"
          @remove="askRemoveProvider(pIdx)"
        >
          <template #endpoint>
            <Setting name="Base URL" desc="OpenAI-compatible API endpoint.">
              <Input
                :model-value="provider.baseUrl"
                placeholder="https://api.openai.com/v1"
                @update:model-value="updateProvider(pIdx, 'baseUrl', $event)"
              />
            </Setting>
          </template>

          <template #model-actions>
            <Icon
              icon="download"
              tooltip="Fetch models from API"
              :disabled="!provider.baseUrl || !provider.apiKeyId || fetchingModels === pIdx"
              @click="fetchModels(pIdx)"
            />
            <Icon icon="plus" tooltip="Add model manually" @click="addModel(pIdx)" />
          </template>

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
                  @click.stop
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
        </ProviderSettings>

        <Setting
          :name="providers.length ? 'Add another provider' : 'No providers yet'"
          desc="Any service that speaks the OpenAI API: its address, a key and its models."
        >
          <Button
            text="Add provider"
            tooltip="Add another OpenAI-compatible provider"
            @click="addProvider"
          />
        </Setting>
      </Section>

      <Section
        title="Background Model"
        desc="Chat models are chosen per agent, on the Agents tab. This one is used for the
          plugin's own background work — naming chats and compacting long conversations."
      >
        <Setting
          name="Auxiliary Model"
          desc="Used for chat titles and compaction. Left unset, each chat uses the model it is
            already talking to; an agent can name one of its own, which wins over this."
        >
          <Dropdown
            :model-value="auxModelKey"
            :options="[{ value: '', display: 'Same as the chat' }, ...modelOptions]"
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

      <Section
        title="When a request fails"
        desc="Only failures that pass on their own are repeated — a rate limit, an overloaded provider, a dropped connection. A rejected key or a bad request is not tried again."
      >
        <Setting name="Try again automatically" desc="How many further tries after the first.">
          <Dropdown
            :model-value="String(retry.attempts)"
            :options="[
              { value: '0', display: 'Off' },
              { value: '1', display: 'Once' },
              { value: '2', display: 'Twice' },
              { value: '3', display: 'Three times' },
              { value: '5', display: 'Five times' },
            ]"
            @update:model-value="setRetry('attempts', Number($event))"
          />
        </Setting>

        <Setting
          v-if="retry.attempts > 0"
          name="First wait"
          desc="Seconds before the first retry. Each one after doubles it, up to a minute."
        >
          <Input
            :model-value="String(Math.round(retry.firstDelayMs / 1000))"
            @update:model-value="setRetry('firstDelayMs', Math.max(1, Number($event) || 1) * 1000)"
          />
        </Setting>
      </Section>
      <Setting
        name="Request timeout (seconds)"
        desc="Wait for the model to connect or send the next response chunk, not for the whole answer. 1–3600 seconds; empty restores 60. Used for chat and background models without their own timeout."
      >
        <Input
          :model-value="timeoutInput"
          :aria-invalid="timeoutError ? 'true' : undefined"
          placeholder="60"
          @update:model-value="setRequestTimeout($event)"
        />
        <div v-if="timeoutError" class="setting-item-description" role="alert">
          {{ timeoutError }}
        </div>
      </Setting>

      <Section
        title="Voice input"
        desc="Dictate into the chat, or into a note with the “Dictate into the note” command. OpenRouter has no transcription endpoint, so the audio goes to a model that hears — these two were picked for price, for running in Europe, and for not training on what is sent."
      >
        <Setting name="Model" desc="What turns speech into text.">
          <Dropdown
            :model-value="voiceModelChoice"
            :options="voiceModelOptions"
            @update:model-value="chooseVoiceModel"
          />
        </Setting>

        <Setting v-if="voiceModelNote" :name="voiceModelName" :desc="voiceModelNote" />

        <template v-if="voiceModelChoice === 'custom'">
          <Setting name="Model id" desc="Any model that accepts audio, as its provider names it.">
            <Input
              :model-value="voice.modelId"
              placeholder="vendor/model"
              @update:model-value="setVoice('modelId', $event)"
            />
          </Setting>
          <Setting name="Endpoint" desc="Left empty, OpenRouter's chat completions.">
            <Input
              :model-value="voice.endpoint"
              placeholder="https://openrouter.ai/api/v1/chat/completions"
              @update:model-value="setVoice('endpoint', $event)"
            />
          </Setting>
        </template>

        <Setting
          name="Language"
          desc="Told to the model as a hint. Left empty, it works it out from the audio."
        >
          <Input
            :model-value="voice.language"
            placeholder="Russian"
            @update:model-value="setVoice('language', $event)"
          />
        </Setting>

        <Setting name="Client name" :desc="CLIENT_NAME_DESCRIPTION">
          <Input
            :model-value="voice.clientName || ''"
            placeholder="Default"
            @update:model-value="setVoice('clientName', $event)"
          />
        </Setting>

        <Setting
          name="OpenRouter API key"
          desc="Stored in the keychain, shared with image generation."
        >
          <SecretField
            :value="storedSecret(voiceKeyName)"
            :model-value="voiceSecretInput"
            :placeholder="'sk-or-...'"
            @update:model-value="voiceSecretInput = $event"
            @save="applyVoiceSecret"
          />
        </Setting>
      </Section>

      <Section title="Image Generation">
        <ProviderSettings
          v-for="(ip, ipIdx) in imageProviders"
          :key="ipIdx"
          :name="ip.name"
          :client-name="ip.clientName"
          :secret-value="storedSecret(ip.apiKeyId)"
          :secret-input="imgSecretInputs[ip.id] || ''"
          :summary="modelCount(ip.models?.length ?? 0)"
          @update:name="updateImageProvider(ipIdx, 'name', $event)"
          @update:client-name="updateImageProvider(ipIdx, 'clientName', $event)"
          @update:secret-input="imgSecretInputs[ip.id] = $event"
          @save-secret="applyImageProviderSecret(ipIdx)"
          @remove="askRemoveImageProvider(ipIdx)"
        >
          <template #identity>
            <Setting
              name="ID"
              desc="Short identifier used in model keys (e.g. openai, openrouter)."
            >
              <Input
                :model-value="ip.id"
                placeholder="e.g. openai"
                @update:model-value="updateImageProvider(ipIdx, 'id', $event)"
              />
            </Setting>
          </template>
          <template #endpoint>
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
          </template>

          <template #model-actions>
            <Icon icon="plus" tooltip="Add model" @click="addImageModel(ipIdx)" />
          </template>

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
        </ProviderSettings>

        <Setting
          :name="imageProviders.length ? 'Add another image provider' : 'No image providers yet'"
          desc="A service that makes pictures from words, for the agent to draw with."
        >
          <Button
            text="Add image provider"
            tooltip="Add another image generation provider"
            @click="addImageProvider"
          />
        </Setting>

        <Setting name="Default Image Model" desc="Used when agent doesn't specify a model.">
          <Dropdown
            :model-value="defaultImageModel"
            :options="[{ value: '', display: 'Not configured' }, ...imageModelOptions]"
            @update:model-value="selectDefaultImageModel"
          />
        </Setting>
      </Section>
    </template>

    <template v-if="enabled && page === 'prompts'">
      <!-- What the plugin tells the models, rarely changed: a prompt a row, saying whether it is
           still the plugin's own, and its words in a window of their own. -->
      <Section
        title="Prompts"
        desc="What the plugin says to the models for its own work. Each starts as the plugin's own; change one only to change how that work comes out."
      >
        <Setting
          name="Tool descriptions"
          desc="What each tool tells the model about itself, shared by every agent. Which tools an agent may use is set per agent."
        >
          <StatusDot
            v-if="toolDescriptionsChanged"
            tone="accent"
            :label="`${toolDescriptionsChanged} changed from the plugin's own`"
          />
          <Icon
            icon="pencil"
            tooltip="Change what the tools tell the model"
            @click="editingTools = true"
          />
        </Setting>
        <Setting v-for="row in PROMPT_ROWS" :key="row.key" :name="row.name" :desc="row.desc">
          <StatusDot
            v-if="isChanged(row.key)"
            tone="accent"
            label="Changed from the plugin's own words"
          />
          <Icon
            icon="pencil"
            :tooltip="`Change the ${row.name.toLowerCase()} prompt`"
            @click="editPrompt(row)"
          />
        </Setting>
      </Section>

      <ObsidianModal v-if="editingPrompt" :title="editingPrompt.name" @close="editingPrompt = null">
        <p class="abele-ai-prompts__about">{{ editingPrompt.desc }}</p>
        <Input
          v-model="promptDraft"
          as-text-area
          class="abele-ai-prompts__text"
          :rows="12"
          :placeholder="defaultPrompts[editingPrompt.key]"
          :aria-label="editingPrompt.name"
        />
        <template #footer>
          <Button
            text="Use the default"
            tooltip="Go back to the plugin's own words"
            :disabled="!promptDraft"
            @click="promptDraft = ''"
          />
          <Button
            text="Cancel"
            tooltip="Close this and change nothing"
            @click="editingPrompt = null"
          />
          <Button text="Save" tooltip="Use these words from now on" accent @click="savePrompt" />
        </template>
      </ObsidianModal>

      <ObsidianModal
        v-if="editingTools"
        title="Tool descriptions"
        size="wide"
        @close="editingTools = false"
      >
        <ToolDescriptions
          :descriptions="customToolDescriptions"
          @update="onToolDescriptionUpdate"
        />
        <template #footer>
          <Button text="Done" tooltip="Close this window" accent @click="editingTools = false" />
        </template>
      </ObsidianModal>
    </template>

    <template v-if="enabled">
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
import { DEFAULT_REWIND_LIMIT_MB } from '@/ai/rewind/ChatRewind'
import { mobileBackground } from '@/ai/mobileBackground'
import { keyDestinations, acceptIntroducedDestinations } from '@/secrets/destinations'
import { reviewKeyDestinations } from '@/secrets/destinationReview'
import { secrets as secretStore } from '@/secrets/SecretStore'
import { MEMORY_PLACEHOLDER } from '@/ai/agents/memory'
import { ref, computed, reactive, watch, onBeforeUnmount } from 'vue'
import { Notice, Platform, debounce } from 'obsidian'
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
import ToolDescriptions from './ToolDescriptions.vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import ModelEditModal from '../ModelEditModal.vue'
import ImageModelEditModal from '../ImageModelEditModal.vue'
import Icon from '../../obsidian/Icon.vue'
import StatusDot from '../../obsidian/StatusDot.vue'
import SecretField from '../SecretField.vue'
import ProviderSettings from './ProviderSettings.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { savedKeysWithIds } from '@/ai/savedKeyIds'
import { TRANSCRIPTION_MODELS } from '@/ai/transcription'
import { DEFAULT_RETRY, type RetrySettings } from '@/ai/retry'
import { DEFAULT_VOICE_SETTINGS, voiceKeyId, type VoiceSettings } from '@/ai/transcriptionSettings'
import { CLIENT_NAME_DESCRIPTION } from '@/ai/client/clientName'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { useAiProviderModels } from '@/composables/useAiProviderModels'
import { useAiImageModels } from '@/composables/useAiImageModels'
import type { AiProvider, AiPrompts, AiSecret } from '@/ai/types'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { requestTimeoutSeconds, MAX_REQUEST_TIMEOUT_SECONDS } from '@/ai/requestTimeout'

/** Written out in script: nested moustaches in the template confuse the Vue parser. */
const NAME_TOKEN = '{{name}}'
const DATE_TOKEN = '{{date:YYYY-MM-DD}}'
const MESSAGES_TOKEN = '{{messages}}'
const MEMORY_TOKEN = MEMORY_PLACEHOLDER

const IMAGE_API_TYPES = [
  { value: 'openai', display: 'OpenAI' },
  { value: 'openrouter', display: 'OpenRouter' },
]

/**
 * The question standing between a trash icon and something being gone. One slot: only one
 * dialog can be open, and holding the action itself keeps the wiring in one place.
 */
withDefaults(
  defineProps<{
    /** Which tab of the agent's settings this is. */
    page?: 'general' | 'models' | 'prompts'
  }>(),
  { page: 'general' }
)

const pendingRemoval = ref<{ title: string; message: string; run: () => void } | null>(null)

function askRemoval(title: string, message: string, run: () => void): void {
  pendingRemoval.value = { title, message, run }
}

const config = AbeleConfig.getInstance()
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
const skillsFolder = ref(config.ai.skillsFolder ?? '')
const rewindLimitMb = ref(config.ai.rewindLimitMb ?? DEFAULT_REWIND_LIMIT_MB)
const commentAgentId = ref(config.ai.commentAgentId ?? '')
const commentFolder = ref(config.ai.commentFolder ?? DEFAULT_AI_SETTINGS.commentFolder)

/**
 * Utility agents are on this list on purpose, unlike the chat picker's: a comment agent is
 * meant to be a utility one, and the agent seeded for comments is created that way. The empty
 * value is the default agent, not "none" — a comment always runs on something.
 */
const commentAgentOptions = computed(() => [
  { value: '', display: 'Default agent' },
  ...AgentRegistry.getInstance()
    .list({ includeUtility: true })
    .map((agent) => ({ value: agent.id, display: agent.name })),
])
const braveSearchApiKey = ref(config.ai.braveSearchApiKey)
const imageProviders = ref(JSON.parse(JSON.stringify(config.ai.imageProviders || [])))
const defaultImageModel = ref(config.ai.defaultImageModel || '')
const imgSecretInputs = reactive<Record<string, string>>({})
const secretRows = (items: AiSecret[]) =>
  savedKeysWithIds(JSON.parse(JSON.stringify(items)) as AiSecret[])
const secrets = ref(secretRows(config.ai.secrets || []))
const secretValueInputs = reactive<Record<string, string>>({})
const auxiliaryModelId = ref(config.ai.auxiliaryModelId)
const sequentialAuxiliary = ref(config.ai.sequentialAuxiliary)
const modelRequestTimeout = ref(requestTimeoutSeconds(config.ai.requestTimeoutSeconds))
const timeoutInput = ref(String(modelRequestTimeout.value))
const timeoutError = computed(() => {
  const seconds = Number(timeoutInput.value)
  return timeoutInput.value.trim() !== '' &&
    (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_REQUEST_TIMEOUT_SECONDS)
    ? 'Enter 1–3600 seconds. This value has not been saved.'
    : ''
})

const setRequestTimeout = (value: string) => {
  timeoutInput.value = value
  if (timeoutError.value) return
  const seconds = value.trim() === '' ? requestTimeoutSeconds(undefined) : Number(value)
  modelRequestTimeout.value = seconds
  save()
}
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

const {
  remoteModels,
  fetchingModels,
  fetchError,
  modelFilter,
  filteredRemoteModels,
  auxModelKey,
  modelOptions,
  addProvider,
  askRemoveProvider,
  updateProvider,
  fetchModels,
  isModelAdded,
  toggleRemoteModel,
  editingModel,
  addModel,
  openModelEdit,
  onModelSave,
  removeModel,
  formatTokens,
  selectAuxModel,
} = useAiProviderModels({ config, providers, auxiliaryModelId, save: () => save(), askRemoval })

let pendingSave = false
const write = () => {
  pendingSave = false
  void config
    .saveSettings()
    .catch((err) => console.error('[Abele] Failed to save AI settings', err))
}
const persist = debounce(write, 500, true)
const save = () => {
  config.editSettings(() => {
    const before = keyDestinations(config)
    applyFields()
    acceptIntroducedDestinations(before, keyDestinations(config))
  })
  pendingSave = true
  persist()
}

const applyFields = () => {
  // Merged, never rebuilt. This tab owns providers, keys and background prompts; agents,
  // scripts and chat history belong to other screens, and a wholesale rebuild would silently
  // drop whatever this component does not happen to know about.
  config.ai = {
    ...config.ai,
    enabled: enabled.value,
    backgroundWhileAgents: backgroundWhileAgents.value,
    backgroundAlways: backgroundAlways.value,
    providers: JSON.parse(JSON.stringify(providers.value)),
    auxiliaryModelId: auxiliaryModelId.value,
    sequentialAuxiliary: sequentialAuxiliary.value,
    requestTimeoutSeconds: modelRequestTimeout.value,
    chatFolder: chatFolder.value,
    rewindLimitMb: rewindLimitMb.value,
    commentAgentId: commentAgentId.value,
    commentFolder: commentFolder.value,
    skillsFolder: skillsFolder.value.trim().replace(/^\/+|\/+$/g, ''),
    braveSearchApiKey: braveSearchApiKey.value,
    imageProviders: JSON.parse(JSON.stringify(imageProviders.value)),
    defaultImageModel: defaultImageModel.value,
    secrets: JSON.parse(JSON.stringify(secrets.value)),
    prompts: JSON.parse(JSON.stringify(prompts.value)),
    autoRetry: { ...retry.value },
    voice: { ...voice.value },
  }
}

watch(config.version, () => {
  enabled.value = config.ai.enabled
  backgroundWhileAgents.value = config.ai.backgroundWhileAgents === true
  backgroundAlways.value = config.ai.backgroundAlways === true
  providers.value = JSON.parse(JSON.stringify(config.ai.providers))
  auxiliaryModelId.value = config.ai.auxiliaryModelId
  sequentialAuxiliary.value = config.ai.sequentialAuxiliary
  modelRequestTimeout.value = requestTimeoutSeconds(config.ai.requestTimeoutSeconds)
  timeoutInput.value = String(modelRequestTimeout.value)
  chatFolder.value = config.ai.chatFolder
  rewindLimitMb.value = config.ai.rewindLimitMb ?? DEFAULT_REWIND_LIMIT_MB
  commentAgentId.value = config.ai.commentAgentId ?? ''
  commentFolder.value = config.ai.commentFolder ?? DEFAULT_AI_SETTINGS.commentFolder
  braveSearchApiKey.value = config.ai.braveSearchApiKey
  imageProviders.value = JSON.parse(JSON.stringify(config.ai.imageProviders || []))
  defaultImageModel.value = config.ai.defaultImageModel || ''
  secrets.value = secretRows(config.ai.secrets || [])
  const retained = new Set(secrets.value.map((secret) => secret.id))
  for (const id of Object.keys(secretValueInputs))
    if (!retained.has(id)) delete secretValueInputs[id]
  if (editingSecretId.value && !retained.has(editingSecretId.value)) {
    editingSecretId.value = null
    secretIsNew = false
  }
  pendingRemoval.value = null
  prompts.value = JSON.parse(JSON.stringify(config.ai.prompts || {}))
  retry.value = { ...DEFAULT_RETRY, ...(config.ai.autoRetry ?? {}) }
  voice.value = { ...DEFAULT_VOICE_SETTINGS, ...(config.ai.voice ?? {}) }
})

onBeforeUnmount(() => {
  persist.cancel?.()
  if (pendingSave) write()
})

const backgroundWhileAgents = ref(config.ai.backgroundWhileAgents === true)
const backgroundAlways = ref(config.ai.backgroundAlways === true)
const toggleBackground = (mode: 'whileAgents' | 'always') => {
  const value = mode === 'whileAgents' ? backgroundWhileAgents : backgroundAlways
  value.value = !value.value
  save()
  mobileBackground.configure(Platform.isMobile, {
    whileAgents: backgroundWhileAgents.value,
    always: backgroundAlways.value,
  })
}

const toggleEnabled = () => {
  enabled.value = !enabled.value
  save()
}

const toggleSequentialAuxiliary = () => {
  sequentialAuxiliary.value = !sequentialAuxiliary.value
  save()
}

// ── Secret helpers ──────────────────────────────────────────

/** The key stored under an id, re-read whenever the keys change. */
const storedSecret = (secretId: string): string => {
  void secretStore().version.value
  return secretId ? secretStore().get(secretId) : ''
}

const getSecretDisplay = (secretId: string): string => {
  if (!secretId) return ''
  const secret = secretStore().get(secretId)
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
  secretStore().set(provider.apiKeyId, value)
  secretInputs[provider.id] = ''
  save()
}

const applyBraveSecret = () => {
  if (!braveSecretInput.value) return
  braveSearchApiKey.value = 'abele-brave-search'
  secretStore().set('abele-brave-search', braveSecretInput.value)
  braveSecretInput.value = ''
  save()
}

// ── Retrying a failed request ───────────────────────────────

const retry = ref<RetrySettings>({ ...DEFAULT_RETRY, ...(config.ai.autoRetry ?? {}) })

const setRetry = (key: keyof RetrySettings, value: number) => {
  retry.value = { ...retry.value, [key]: value }
  save()
}

// ── Voice input ─────────────────────────────────────────────

const voice = ref<VoiceSettings>({ ...DEFAULT_VOICE_SETTINGS, ...(config.ai.voice ?? {}) })
const voiceSecretInput = ref('')

const voiceKeyName = computed(() => voiceKeyId(voice.value))

const voiceModelOptions = [
  ...TRANSCRIPTION_MODELS.map((model) => ({ value: model.id, display: model.name })),
  { value: 'custom', display: 'Something else…' },
]

/** A model that is not one of the two is shown as "something else", with its id spelled out. */
const voiceModelChoice = computed(() =>
  TRANSCRIPTION_MODELS.some((model) => model.id === voice.value.modelId)
    ? voice.value.modelId
    : 'custom'
)

const voiceModelName = computed(
  () => TRANSCRIPTION_MODELS.find((m) => m.id === voice.value.modelId)?.name ?? ''
)

const voiceModelNote = computed(
  () => TRANSCRIPTION_MODELS.find((m) => m.id === voice.value.modelId)?.note ?? ''
)

const saveVoice = () => save()

const setVoice = (key: keyof VoiceSettings, value: string) => {
  voice.value = { ...voice.value, [key]: value }
  saveVoice()
}

const chooseVoiceModel = (value: string) => {
  // "Something else" keeps whatever id was there rather than blanking it, so switching back
  // and forth does not lose what was typed.
  if (value !== 'custom') setVoice('modelId', value)
  else if (voiceModelChoice.value !== 'custom') setVoice('modelId', '')
}

const applyVoiceSecret = () => {
  if (!voiceSecretInput.value) return
  secretStore().set(voiceKeyName.value, voiceSecretInput.value)
  voiceSecretInput.value = ''
  saveVoice()
}

const {
  imgEndpointDefault,
  imageModelOptions,
  addImageProvider,
  askRemoveImageProvider,
  updateImageProvider,
  applyImageProviderSecret,
  editingImageModel,
  addImageModel,
  openImageModelEdit,
  onImageModelSave,
  removeImageModel,
  selectDefaultImageModel,
} = useAiImageModels({
  config,
  imageProviders,
  defaultImageModel,
  imgSecretInputs,
  voice,
  save,
  askRemoval,
})

// ── User secrets ────────────────────────────────────────────

const editingSecretId = ref<string | null>(null)
const editingSecretIdx = computed(() =>
  secrets.value.findIndex((secret) => secret.id === editingSecretId.value)
)

/** The name the open card started with, so that cancelling puts it back. */
let secretNameBefore = ''
/** A secret added but never stored — cancelling it should leave nothing behind. */
let secretIsNew = false

const getSecretFullValue = (secretId: string): string => {
  if (!secretId) return ''
  return secretStore().get(secretId) || ''
}

const addSecret = () => {
  secrets.value.push({ id: nanoid(), name: '', keyId: '' })
  startEditSecret(secrets.value.length - 1)
  secretIsNew = true
}

const startEditSecret = (idx: number) => {
  const secret = secrets.value[idx]
  editingSecretId.value = secret.id
  secretNameBefore = secret.name
  secretIsNew = false
  secretValueInputs[secret.id] = secret.keyId ? getSecretFullValue(secret.keyId) : ''
}

/** Closes the card and undoes the sitting, unsaved edit — the name included. */
const cancelEditSecret = (idx: number) => {
  editingSecretId.value = null
  secretValueInputs[secrets.value[idx].id] = ''
  if (secretIsNew) {
    secrets.value.splice(idx, 1)
  } else {
    secrets.value[idx].name = secretNameBefore
  }
  secretIsNew = false
  save()
}

const askRemoveSecret = (idx: number) => {
  const secret = secrets.value[idx]
  askRemoval(
    'Remove secret',
    `Remove ${secret.name || '(unnamed)'}? Any fetch call referring to it by name will stop ` +
      'working, and the stored value is gone from the keychain.',
    () => {
      const current = secrets.value.findIndex((entry) => entry.id === secret.id)
      if (current !== -1) removeSecret(current)
    }
  )
}

const removeSecret = (idx: number) => {
  const secret = secrets.value[idx]
  if (secret.keyId) {
    try {
      secretStore().set(secret.keyId, '')
    } catch {
      // Invalid keyId from older version — skip keychain cleanup
    }
  }
  secrets.value.splice(idx, 1)
  // Row indices changed: neither an open editor nor a reveal choice belongs to its neighbour.
  editingSecretId.value = null
  secretIsNew = false
  for (const key of Object.keys(secretValueInputs)) delete secretValueInputs[key]
  save()
}

const removeSecretOrigin = (idx: number, origin: string) => {
  secrets.value[idx].allowedOrigins = (secrets.value[idx].allowedOrigins ?? []).filter(
    (entry: string) => entry !== origin
  )
  save()
}

const updateSecretName = (idx: number, name: string) => {
  secrets.value[idx].name = name
  save()
}

const applySecretValue = (idx: number) => {
  const secret = secrets.value[idx]
  if (!secret || secret.id !== editingSecretId.value) return
  const value = secretValueInputs[secret.id]
  if (!value) return
  if (!secret.keyId || !/^[a-z0-9-]+$/.test(secret.keyId)) {
    secret.keyId = `abele-secret-${nanoid(8)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '0')}`
  }
  secretStore().set(secret.keyId, value)
  secretValueInputs[secret.id] = ''
  editingSecretId.value = null
  secretIsNew = false
  // Force re-render so getSecretDisplay() re-evaluates with the new keychain value
  secrets.value = [...secrets.value]
  save()
  new Notice(`Saved ${secret.name || 'the secret'} to the keychain`)
}

const updateField = (field: string, value: string) => {
  switch (field) {
    case 'chatFolder':
      chatFolder.value = value
      break
    case 'rewindLimitMb': {
      const mb = Number(value.trim())
      // Half-typed or nonsense: the last good number stays until the field reads as one.
      if (value.trim() === '' || !Number.isFinite(mb) || mb < 0) return
      rewindLimitMb.value = mb
      break
    }
    case 'commentAgentId':
      commentAgentId.value = value
      break
    case 'skillsFolder':
      skillsFolder.value = value
      break
    case 'commentFolder':
      commentFolder.value = value
      // Ids that failed to load under the old folder deserve another try under the new one.
      CommentService.getInstance().resetMissing()
      break
  }
  save()
}

const updatePrompt = (field: keyof Omit<AiPrompts, 'toolDescriptions'>, value: string) => {
  prompts.value = { ...prompts.value, [field]: value }
  save()
}

type PromptKey = keyof Omit<AiPrompts, 'toolDescriptions'>
interface PromptRow {
  key: PromptKey
  name: string
  desc: string
}

/** The plugin's own prompts, each in the words of the work it does. */
const PROMPT_ROWS: PromptRow[] = [
  {
    key: 'memoryTemplate',
    name: 'Agent memory',
    desc: `How what an agent was asked to remember is added to its system prompt; ${MEMORY_TOKEN} is where the items go.`,
  },
  {
    key: 'titleGeneration',
    name: 'Chat titles',
    desc: `Names a chat from its first messages; ${MESSAGES_TOKEN} is where they go.`,
  },
  {
    key: 'titleSystem',
    name: 'Chat titles, system',
    desc: 'What the model that names chats is told it is.',
  },
  {
    key: 'recapPrompt',
    name: 'Chat recap',
    desc: `The sentence on a chat's card under a note it changed; ${MESSAGES_TOKEN} is where the messages go.`,
  },
  {
    key: 'summaryPrompt',
    name: 'Chat summary',
    desc: `The short line under a chat's title in the history; ${MESSAGES_TOKEN} is where the messages go.`,
  },
  {
    key: 'compactPrompt',
    name: 'Compacting',
    desc: `How a long conversation is summed up so it can go on; ${MESSAGES_TOKEN} is where it goes.`,
  },
]

const editingPrompt = ref<PromptRow | null>(null)
const promptDraft = ref('')
const editPrompt = (row: PromptRow) => {
  promptDraft.value = prompts.value[row.key] || ''
  editingPrompt.value = row
}
/** Saved as typed; left empty, the plugin's own words are used again. */
const savePrompt = () => {
  if (editingPrompt.value) updatePrompt(editingPrompt.value.key, promptDraft.value)
  editingPrompt.value = null
}

const editingTools = ref(false)
const toolDescriptionsChanged = computed(
  () => Object.values(customToolDescriptions.value).filter(Boolean).length
)

/** Changed means other words than the plugin's own; the same words typed in are not a change. */
const isChanged = (key: PromptKey) => {
  const own = prompts.value[key]
  return !!own && own.trim() !== (defaultPrompts[key] || '').trim()
}

const modelCount = (n: number) => (n === 1 ? '1 model' : `${n} models`)
</script>

<style lang="scss">
.abele-ai-prompts__about {
  margin-top: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-ai-prompts__text {
  width: 100%;
}

.modal .abele-ai-prompts__text textarea.abele-obsidian-input__base {
  width: 100%;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
}

/** Was a bare `<template>`; the wrapper keeps the card's own column layout. */
.abele-ai-secret__editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
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
