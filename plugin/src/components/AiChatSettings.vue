<template>
  <!-- By how often each is changed: the model, the prompt, the interceptor, then the rest. -->
  <div class="abele-chat-settings">
    <Setting
      :name="t('streamB.model.5e2c61')"
      :desc="t('streamB.theOneThisChatAnswersWith.87902f')"
    >
      <AgentOverrideNotice field="modelId" compact />
      <Dropdown
        :model-value="modelKey"
        :options="modelOptions"
        @update:model-value="selectModel($event)"
      />
    </Setting>
    <Setting
      :name="t('streamB.systemPrompt.561257')"
      :desc="t('streamB.theGlobalOneANoteOrWords.1ed3c2')"
    >
      <Dropdown
        :model-value="promptMode"
        :options="promptModes"
        @update:model-value="setPromptMode($event as PromptMode)"
      />
    </Setting>
    <Setting
      v-if="promptMode === 'note'"
      :name="t('streamB.note.d8da2c')"
      :desc="t('streamB.readTheSystemPromptFromThisNote.55cfc7')"
    >
      <Search
        :model-value="notePath"
        :label="t('streamB.systemPromptNote.ac9d27')"
        :placeholder="t('streamB.pathToNote.ef6763')"
        :suggester="FileSuggest"
        @update:model-value="updateNotePath"
      />
    </Setting>
    <Setting
      v-if="promptMode === 'custom'"
      :name="t('streamB.prompt.5c3912')"
      :desc="t('streamB.onlyThisChatUsesThisText.54cd9a')"
    >
      <Input
        :model-value="customText"
        as-text-area
        :aria-label="t('streamB.systemPromptForThisChat.b8e244')"
        :placeholder="t('streamB.enterSystemPrompt.d27123')"
        @update:model-value="updateCustomText"
      />
    </Setting>
    <!-- The agent's interceptors, this chat's own list, or none: the same list as the agent's. -->
    <Setting :name="t('streamB.interceptors.803987')" :desc="interceptorDesc">
      <Dropdown
        :model-value="chatListMode"
        :options="chatListOptions"
        @update:model-value="chooseChatList"
      />
    </Setting>
    <InterceptorList
      v-if="chatListMode === OWN_LIST && session"
      :entries="session.interceptor.entries.value"
      :choices="interceptorOptions"
      :narrow="Platform.isPhone"
      :headed="false"
      @update:entries="setChatEntries"
    />
    <Setting
      :name="t('streamB.hideReasoning.d1ba69')"
      :desc="t('streamB.showOnlyASpinnerWhileTheModel.7190c4')"
    >
      <Checkbox :is-enabled="hideReasoning" @toggle="toggleHideReasoning" />
    </Setting>
    <!-- Read grants can outlive the current scope or come from the agent's scope. -->
    <Setting
      :name="t('streamB.nodeRepositoryAccess.6872c0')"
      :desc="t('streamB.revokeThisChatSRepositoryReadGrants.bbd7b8')"
    >
      <Button
        :text="t('streamB.revokeRepositoryAccess.e74a4e')"
        :tooltip="t('streamB.requireNewOwnerApprovalForRepositoryReads.c9cf26')"
        @click="revokeNodeReads"
      />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { nodeRepositoryToolsHost } from '@/ai/tools/node'
import { revokeObsidianChatNodeApproval } from '@/ai/tools/node/owner'
import { ref, computed } from 'vue'
import Setting from './obsidian/Setting.vue'
import Button from './obsidian/Button.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Search from './obsidian/Search.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { interceptorScripts } from '@/ai/interceptor/runScript'
import InterceptorList from './settings/ai/InterceptorList.vue'
import type { InterceptorEntry } from '@/ai/agents/types'
import { interceptorChoices } from './settings/ai/options'
import { Platform } from 'obsidian'
import AgentOverrideNotice from './AgentOverrideNotice.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import Dropdown from './obsidian/Dropdown.vue'
import Input from './obsidian/Input.vue'

defineEmits<{ close: [] }>()

const session = computed(() => ChatService.getInstance().activeSession.value)
function revokeNodeReads() {
  const current = session.value
  if (!current) return
  nodeRepositoryToolsHost.revokeAll(current)
  void revokeObsidianChatNodeApproval(current).catch((error) =>
    console.error('[Abele] Node scope revocation failed', error)
  )
}

// ── Model override ──

const modelOptions = computed(() => {
  const opts: { value: string; display: string }[] = []
  for (const provider of AbeleConfig.getInstance().ai.providers) {
    for (const model of provider.models) {
      opts.push({ value: `${provider.id}::${model.id}`, display: model.name || model.id })
    }
  }
  return opts
})

const modelKey = computed(() => {
  const s = session.value
  if (!s) return ''
  return s.activeModelId.value ? `${s.activeProviderId.value}::${s.activeModelId.value}` : ''
})

function selectModel(key: string) {
  const s = session.value
  if (!s) return
  const [providerId, modelId] = key.split('::')
  s.activeProviderId.value = providerId || ''
  s.activeModelId.value = modelId || ''
  s.save()
}

// ── Interceptor ──

// Any agent may review a draft, utility ones included — that is what most of them are for —
// and any script marked `@interceptor` may decide about one.
const interceptorOptions = computed(() =>
  interceptorChoices(
    AgentRegistry.getInstance().list({ includeUtility: true }),
    interceptorScripts().map((script) => script.meta.name)
  )
)

/** Not an agent id — nanoid never produces a colon — so it cannot collide with one. */
const FOLLOW_AGENT = ':agent'
const OWN_LIST = ':own'

/** Following the agent, a list of this chat's own, or Off: an own list that is empty. */
const chatListMode = computed(() => {
  const own = session.value?.interceptor.override.value
  if (!own) return FOLLOW_AGENT
  return own.length ? OWN_LIST : ''
})

/** Names what "the agent's" means right now, so following it is not a blind choice. */
const agentDefaultLabel = computed(() => {
  const list = (session.value?.interceptor.agentDefault.value ?? []).filter((e) => e.enabled)
  const one = list.length === 1 ? list[0] : null
  const name = one
    ? one.script
      ? t('streamB.script.fa8b35', { v0: String(one.script) })
      : AgentRegistry.getInstance().get(one.agentId)?.name
    : list.length > 1
      ? t('streamB.inARow.77e90c', { v0: String(list.length) })
      : ''
  return t('streamB.agentDefault.c10e26', { v0: String(name || t('chat.offState')) })
})

const chatListOptions = computed(() => [
  { value: FOLLOW_AGENT, display: agentDefaultLabel.value },
  { value: OWN_LIST, display: t('streamB.ownForThisChat.c94676') },
  { value: '', display: t('streamB.off.ca7981') },
])

const interceptorDesc = computed(() =>
  chatListMode.value === FOLLOW_AGENT
    ? t('streamB.checkYourMessagesTheAgentSAnswers.0cd85a')
    : chatListMode.value === OWN_LIST
      ? t('streamB.thisChatSOwnListInThis.efbed2')
      : t('streamB.noneForThisChatTheAgentS.b60bce')
)

function chooseChatList(mode: string) {
  const s = session.value
  if (!s) return
  if (mode === FOLLOW_AGENT) s.interceptor.followAgent()
  // Starting its own list, the chat starts from the agent's, to change rather than retype.
  else if (mode === OWN_LIST) s.interceptor.setEntries(s.interceptor.agentDefault.value)
  else s.interceptor.setEntries([])
  void s.save()
}

function setChatEntries(entries: InterceptorEntry[]) {
  const s = session.value
  if (!s) return
  s.interceptor.setEntries(entries)
  void s.save()
}

// ── Hide reasoning ──

const hideReasoning = computed(() => session.value?.hideReasoning.value ?? false)

const toggleHideReasoning = () => {
  if (session.value) {
    session.value.hideReasoning.value = !session.value.hideReasoning.value
  }
}

// ── System prompt ──

type PromptMode = 'default' | 'note' | 'custom'
const promptModes = [
  { value: 'default', display: t('streamB.useGlobalDefault.a83c91') },
  { value: 'note', display: t('streamB.fromVaultNote.05da07') },
  { value: 'custom', display: t('streamB.customForThisChat.b2d855') },
]

const promptMode = ref<PromptMode>(
  session.value?.customSystemPromptNotePath.value
    ? 'note'
    : session.value?.customSystemPrompt.value
      ? 'custom'
      : 'default'
)
const notePath = ref(session.value?.customSystemPromptNotePath.value ?? '')
const customText = ref(session.value?.customSystemPrompt.value ?? '')

function setPromptMode(m: PromptMode) {
  const s = session.value
  if (!s) return
  promptMode.value = m
  if (m === 'default') {
    s.customSystemPrompt.value = ''
    s.customSystemPromptNotePath.value = ''
  } else if (m === 'note') {
    s.customSystemPrompt.value = ''
  } else if (m === 'custom') {
    s.customSystemPromptNotePath.value = ''
  }
  s.save()
}

function updateNotePath(value: string) {
  const s = session.value
  if (!s) return
  notePath.value = value
  s.customSystemPromptNotePath.value = value
  s.save()
}

function updateCustomText(value: string) {
  const s = session.value
  if (!s) return
  customText.value = value
  s.customSystemPrompt.value = value
  s.save()
}
</script>

<style lang="scss">
.abele-chat-settings {
  padding: var(--size-4-2) 0;
}
</style>
