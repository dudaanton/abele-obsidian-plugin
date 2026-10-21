<template>
  <!-- What the agent asks to do, said as the debugger's card says it: a glyph of the kind of
       action and what it is, the exact thing in code under it, Deny and Allow at the end. The
       rarer answers (always, edit first) are in the card's menu, not more buttons. -->
  <RequestCard class="abele-tool-approval" waiting>
    <div class="abele-tool-approval__header">
      <Icon :icon="KIND_ICON[toolKind(message.toolName)]" size="xs" :interactive="false" />
      <span class="abele-tool-approval__what">{{ headerText }}</span>
      <Icon
        v-if="!nodePrompt"
        class="abele-tool-approval__more"
        icon="more-horizontal"
        size="xs"
        :label="t('streamB.moreWaysToAnswer.7be48c')"
        @click="moreMenu"
      />
    </div>
    <Disclosure
      v-if="message.toolName?.startsWith('mcp__')"
      v-model="originalOpen"
      :label="t('streamB.originalAction.67ccdf')"
    >
      <code>{{ message.toolName }}</code>
    </Disclosure>

    <template v-if="message.toolName === 'send_message_to_chat'">
      <div class="abele-tool-approval__path">
        {{ letterTarget?.title || params.chat_id
        }}<span v-if="letterTarget?.folder"> · {{ letterTarget.folder }}</span>
      </div>
      <div class="abele-tool-approval__message">{{ params.message }}</div>
      <div v-if="letterAuthority.length" class="abele-tool-approval__note">
        {{ t('chat.letterAuthority', { capabilities: letterAuthority.join(', ') }) }}
      </div>
    </template>
    <template v-else-if="message.toolName === 'questions' && questionList.length">
      <div v-for="(question, index) in questionList" :key="index">
        <p>{{ question.question }}</p>
        <ul>
          <li v-for="option in question.options" :key="option">{{ option }}</li>
        </ul>
      </div>
    </template>
    <template v-else-if="nodePrompt && !obsidianCall">
      <div v-if="location" class="abele-tool-approval__path">
        {{ managerApproval ? visibleText(location) : location }}
      </div>
      <Diff
        v-for="(diff, index) in diffs ?? []"
        :key="index"
        :text-left="diff.old"
        :text-right="diff.new"
        :path="diff.path"
      />
      <div v-if="managerApproval" data-manager-approval>
        <Setting
          v-for="row in managerApproval.rows"
          :key="row.name"
          :name="row.name"
          :desc="row.value"
        />
        <details data-manager-evidence :open="managerApproval.escaped">
          <summary>{{ t('node.manager.evidence') }}</summary>
          <pre class="abele-tool-approval__code"><code>{{ managerApproval.evidence }}</code></pre>
        </details>
      </div>
      <template v-else>
        <code>{{ toolSummary(message) }}</code>
        <pre
          v-if="typeof nodePrompt.input?.content === 'string'"
          class="abele-tool-approval__code"
        ><code>{{ nodePrompt.input.content }}</code></pre>
        <Disclosure v-model="originalOpen" :label="t('streamB.originalAction.67ccdf')">
          <pre
            class="abele-tool-approval__code"
          ><code>{{ JSON.stringify(nodePrompt.input, null, 2) }}</code></pre>
        </Disclosure>
      </template>
      <Dropdown
        v-if="nodePrompt.kind === 'select'"
        v-model="nodeValue"
        :disabled="disabled || !!answerState"
        :aria-label="t('streamB.questionAnswer.e9700c')"
        :options="[
          { value: '', display: t('streamB.chooseAnAnswer.8cf0e3') },
          ...(nodePrompt.options ?? []).map((value) => ({ value, display: value })),
        ]"
      />
      <Input
        v-if="nodePrompt.kind === 'input'"
        v-model="nodeValue"
        as-text-area
        :disabled="disabled || !!answerState"
        :aria-label="t('streamB.questionAnswer.e9700c')"
      />
      <div v-if="answerState" role="status">
        {{
          t('streamBMeta.7c3c58a4a0', {
            p0:
              answerState.choice === 'allow' ? t('streamB.allow.e213c1') : t('streamB.deny.05a2d7'),
          })
        }}
        <template v-if="answerState.value !== undefined"> · {{ answerState.value }}</template>
        <template v-if="answerState.state === 'pending'">{{
          t('streamB.waitingForConfirmation.bc8582')
        }}</template>
        <template v-if="answerState.error"
          >{{ t('streamB.notAccepted.0f11a8') }} {{ answerState.error }}</template
        >
      </div>
    </template>
    <template v-else-if="obsidianCall && message.toolName !== 'create' && message.toolDiff">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <Diff
        :text-left="message.toolDiff.old"
        :text-right="message.toolDiff.new"
        :path="String(params.path || '')"
      />
    </template>
    <!-- Create: the file does not exist yet, so its content is all there is to show -->
    <template v-else-if="message.toolName === 'create'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <pre
        class="abele-tool-approval__code"
      ><code><SyntaxText :text="String(params.content || '')" :path="String(params.path || params.file_path || '')" /></code></pre>
    </template>

    <template v-else-if="message.toolName === 'node_delegate'">
      <Setting
        :name="promptString(params.title)"
        :desc="providerLabel(promptString(params.provider))"
      />
      <p class="abele-tool-approval__code">{{ params.text }}</p>
      <details>
        <summary>{{ t('node.manager.evidence') }}</summary>
        <pre
          class="abele-tool-approval__code"
        ><code>{{ JSON.stringify(params, null, 2) }}</code></pre>
      </details>
    </template>
    <template v-else-if="message.toolName === 'node_propose_edit'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <div class="abele-tool-approval__param">
        {{
          t('streamBMeta.d79ce7049b', {
            p0: String(params.node),
            p1: String(params.project),
            p2: String(params.workspace),
          })
        }}
      </div>
      <div class="abele-tool-approval__param">
        {{ t('streamBMeta.c5ba19dc83', { p0: String(params.expected_content_id) }) }}
      </div>
      <pre
        class="abele-tool-approval__code"
      ><code><SyntaxText :text="String(params.text || '')" :path="String(params.path || params.file_path || '')" /></code></pre>
      <div class="abele-tool-approval__note">
        {{ t('streamB.approveThisExactEditAsALocal.771c1e') }}
      </div>
    </template>

    <!-- Write: an overwrite of a file that exists, so show what it does to it -->
    <template v-else-if="message.toolName === 'write'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <Diff
        v-if="currentContent !== null"
        :text-left="currentContent"
        :text-right="String(params.content || '')"
        :path="String(params.path || '')"
        class="abele-tool-approval__diff"
      />
      <pre
        v-else
        class="abele-tool-approval__code"
      ><code><SyntaxText :text="String(params.content || '')" :path="String(params.path || params.file_path || '')" /></code></pre>
    </template>

    <!-- Edit: show diff -->
    <template v-else-if="message.toolName === 'edit'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <Diff
        v-if="params.old_string || params.new_string"
        :text-left="String(params.old_string || '')"
        :text-right="String(params.new_string || '')"
        :path="String(params.path || '')"
        class="abele-tool-approval__diff"
      />
    </template>

    <template v-else-if="message.toolName === 'docx_edit' || message.toolName === 'xlsx_write'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <Diff
        v-if="wordPreview"
        :text-left="wordPreview.old"
        :text-right="wordPreview.new"
        class="abele-tool-approval__diff"
      />
      <div v-else>{{ wordPreviewError || t('streamB.preparingOfficeEditPreview.bf8daa') }}</div>
      <pre
        class="abele-tool-approval__code"
      ><code>{{ JSON.stringify(params, null, 2) }}</code></pre>
    </template>

    <template v-else-if="message.toolName === 'deck_create' || message.toolName === 'deck_edit'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <Diff
        v-if="deckPreview"
        :text-left="deckPreview.old"
        :text-right="deckPreview.new"
        class="abele-tool-approval__diff"
      />
      <div v-else>
        {{ deckPreviewError || t('streamB.preparingPresentationEditPreview.5f5c0f') }}
      </div>
    </template>

    <!-- eval_js: show code -->
    <template v-else-if="message.toolName === 'eval_js'">
      <pre class="abele-tool-approval__code"><code>{{ params.code }}</code></pre>
    </template>

    <!-- rm: just the path -->
    <template v-else-if="message.toolName === 'rm'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
    </template>

    <!-- mv / cp: from → to -->
    <template v-else-if="message.toolName === 'mv' || message.toolName === 'cp'">
      <div class="abele-tool-approval__move">
        <span>{{ params.from }}</span>
        <span class="abele-tool-approval__arrow">→</span>
        <span>{{ params.to }}</span>
      </div>
    </template>

    <!-- create_script: show name + code preview -->
    <template v-else-if="message.toolName === 'create_script'">
      <div class="abele-tool-approval__path">{{ params.name }}.js</div>
      <pre
        class="abele-tool-approval__code"
      ><code><SyntaxText :text="String(params.content || '')" path="script.js" /></code></pre>
    </template>

    <!-- write_settings: the setting, what it holds → what it would hold, and what that moves -->
    <template v-else-if="message.toolName === 'write_settings' && settingsWrite">
      <div class="abele-tool-approval__path">{{ settingsWrite.path }}</div>
      <div class="abele-tool-approval__move">
        <span class="abele-tool-approval__before">{{ settingsWrite.before }}</span>
        <span class="abele-tool-approval__arrow">→</span>
        <span class="abele-tool-approval__after">{{ settingsWrite.after }}</span>
      </div>
      <div v-if="settingsWrite.warning" class="abele-tool-approval__warning">
        <Icon icon="alert-triangle" color="orange" no-hover />
        <span>{{ settingsWrite.warning }}</span>
      </div>
      <div v-else-if="settingsWrite.deviceOnly" class="abele-tool-approval__note">
        {{ t('streamB.onlyThisDevice.1987f1') }}
      </div>
    </template>

    <!-- http_send: exactly what goes, keys by name -->
    <template v-else-if="message.toolName === 'http_send'">
      <HttpSendPreview :params="params" :read="readHttpSend" />
    </template>

    <!-- One thing asked, a command or a path: that thing, as code. -->
    <template v-else-if="soleParam !== null">
      <pre class="abele-tool-approval__code"><code>{{ soleParam }}</code></pre>
    </template>

    <!-- Fallback: readable key-value -->
    <template v-else>
      <div v-for="(val, key) in params" :key="key" class="abele-tool-approval__param">
        <span class="abele-tool-approval__param-key">{{ key }}</span>
        <span>{{ typeof val === 'string' ? val : JSON.stringify(val) }}</span>
      </div>
    </template>

    <div v-if="keyInfo?.names.length" class="abele-tool-approval__param">
      <span>{{
        t('streamBMeta.0621e57a02', {
          p0: String(keyInfo.names.join(', ')),
          p1: String(keyInfo.origin),
        })
      }}</span>
      <span>{{ t('streamB.allowThisAddressRemembersItForThese.668613') }}</span>
      <Button
        v-if="keyInfo.missing.length"
        :text="t('streamB.allowThisAddressForTheseKeys.b0828e')"
        :disabled="
          keyApprovalBusy ||
          disabled ||
          (nodePrompt?.kind === 'select' && !nodePrompt.options?.includes(nodeValue))
        "
        @click="allowKeyAddress"
      />
    </div>

    <!-- Edit JSON (toggle) -->
    <div v-if="isEditing" class="abele-tool-approval__editor">
      <Input
        :model-value="editedArgs"
        as-text-area
        :placeholder="contentKey ? t('streamB.editContent') : t('streamB.editArgumentsJson.43eaac')"
        @update:model-value="editedArgs = $event"
      />
      <div v-if="parseError" class="abele-tool-approval__parse-error">{{ parseError }}</div>
    </div>

    <div v-if="parseError && !isEditing" class="abele-tool-approval__parse-error">
      {{ parseError }}
    </div>
    <Disclosure
      v-if="obsidianCall && nodePrompt"
      v-model="originalOpen"
      :label="t('streamB.originalAction.67ccdf')"
    >
      <pre
        class="abele-tool-approval__code"
      ><code>{{ JSON.stringify(nodePrompt.input, null, 2) }}</code></pre>
    </Disclosure>
    <div v-if="obsidianCall && answerState" role="status">
      {{ t('streamB.waitingForConfirmation.bc8582') }}
      <template v-if="answerState.error">{{ answerState.error }}</template>
    </div>
    <Button
      v-if="nodePrompt && answerState"
      class="abele-tool-approval__stop"
      :text="t('streamB.stop.cae7d5')"
      :disabled="disabled"
      @click="stop"
    />
    <div v-if="!nodePrompt || !answerState" class="abele-tool-approval__actions">
      <Button
        :text="t('streamB.deny.05a2d7')"
        :tooltip="t('streamB.doNotLetTheAgentDoThis.a3a900')"
        :disabled="disabled"
        @click="reject"
      />
      <Button
        :text="
          keyInfo && !keyInfo.missing.length
            ? t('streamB.sendOnce.477fa5')
            : isEditing
              ? t('streamB.allowAsEdited.0a3da0')
              : t('streamB.allow.e213c1')
        "
        accent
        :disabled="keyApprovalBusy || disabled || !!(nodePrompt && answerState)"
        :tooltip="t('streamB.letTheAgentDoExactlyThisOnce.db2a63')"
        @click="approve"
      />
      <!-- Stop ends the agent's turn as well as denying this; it stands apart, on the left. -->
      <Button
        class="abele-tool-approval__stop"
        :text="t('streamB.stop.cae7d5')"
        :tooltip="t('streamB.denyAndStopTheAgent.7e1188')"
        :disabled="disabled"
        @click="stop"
      />
    </div>
  </RequestCard>
</template>

<script setup lang="ts">
import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { openMessagingChats } from '@/ai/chatMessaging'
import SyntaxText from './SyntaxText.vue'
import { ref, computed, watch, onUnmounted } from 'vue'
import {
  secretNames,
  secretRequestInfo,
  secretRequestForTool,
  allowSecretRequestOrigins,
} from '@/ai/tools/secretUtils'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
import Input from './obsidian/Input.vue'
import Dropdown from './obsidian/Dropdown.vue'
import Diff from './Diff.vue'
import RequestCard from './obsidian/RequestCard.vue'
import Disclosure from './obsidian/Disclosure.vue'
import { ChatService } from '@/ai/ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { Menu, TFile } from 'obsidian'
import { KIND_ICON, toolKind } from '@/ai/toolRuns'
import { readableToolName, toolSummary } from '@/ai/toolLine'
import { WRITE_TOOLS, DECK_WRITE_TOOLS, type ChatMessage } from '@/ai/types'
import { NODE_EDIT_TOOLS, NODE_MUTATION_TOOLS } from '@/ai/tools/node/agent'

import { prepareWordChange } from '@/word/vaultAdapter'
import type { WordEdit } from '@/word/edit'
import { prepareWorkbookChange } from '@/spreadsheet/vaultAdapter'
import type { WorkbookEdit } from '@/spreadsheet/edit'
import { prepareDeckCreate, prepareSlideEdit, type SlideEdit } from '@/slides/core/edit'
import { describeSettingsWrite } from '@/ai/tools/SettingsTools'
import HttpSendPreview from './debugger/http/HttpSendPreview.vue'
import Setting from './obsidian/Setting.vue'
import { providerLabel } from '@/node/providers'
/** A saved request as an agent's send would put it on the wire, for its card. */
const readHttpSend = (id: string, environment?: string) =>
  import('@/requests/agentContext').then((m) => m.sendPreview(id, environment))

const props = defineProps<{
  message: ChatMessage
  nodePrompt?: import('@abele/node-client').Prompt
  disabled?: boolean
  location?: string
  answerState?: import('@/node/promptAnswers').PromptAnswerState
  diffs?: { path: string; old: string; new: string }[]
}>()
const emit = defineEmits<{ answer: [choice: 'allow' | 'deny', value?: string]; stop: [] }>()
const promptString = (value: unknown): string => (typeof value === 'string' ? value : '')
// Keep JSON reversible while exposing characters that can reorder or conceal evidence.
const visibleJson = (value: unknown, indent?: number): string =>
  (JSON.stringify(value, null, indent) ?? '').replace(
    /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029\u007f-\u009f]/gu,
    (char) =>
      char
        .split('')
        .map((part) => {
          return `\\u${part.charCodeAt(0).toString(16).padStart(4, '0')}`
        })
        .join('')
  )
const visibleText = (value: string): string =>
  value.replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/gu, (char) =>
    visibleJson(char).slice(1, -1)
  )
const managerApproval = computed(() => {
  const input = props.nodePrompt?.input
  if (!input || !['command.v1.run', 'git.v1.integrate'].includes(promptString(input.method)))
    return undefined
  const params = input.params as Record<string, unknown> | undefined
  if (!params) return undefined
  const rows: { name: string; value: string }[] = []
  let escaped = false
  const add = (name: string, value: string) => {
    const visible = visibleText(value)
    escaped ||= visible !== value
    rows.push({ name, value: visible })
  }
  if (input.method === 'command.v1.run') {
    rows.push({
      name: t('node.manager.command'),
      value: Array.isArray(params.argv)
        ? params.argv
            .map((arg) => {
              if (typeof arg === 'string') escaped ||= visibleText(arg) !== arg
              return typeof arg === 'string' && /^[\w./=-]+$/.test(arg) ? arg : visibleJson(arg)
            })
            .join(' ')
        : visibleText(promptString(params.command)),
    })
    if (!Array.isArray(params.argv))
      escaped ||= visibleText(promptString(params.command)) !== promptString(params.command)
  } else {
    add(
      t('node.manager.branches'),
      params.rebase
        ? t('streamB.rebaseOnto.708b25', {
            v0: promptString(params.source_branch),
            v1: promptString(params.target_branch),
          })
        : `${promptString(params.source_branch)} → ${promptString(params.target_branch)}`
    )
    for (const [key, label] of [
      ['expected_source_head', 'node.manager.sourceHead'],
      ['expected_target_head', 'node.manager.targetHead'],
    ] as const)
      add(t(label), promptString(params[key]))
  }
  for (const key of ['project_id', 'worktree_id', 'source_worktree_id'] as const)
    if (typeof params[key] === 'string') add(key, params[key])
  add('session_id', props.nodePrompt?.session_id ?? '')
  if (typeof params.session_id === 'string' && params.session_id !== props.nodePrompt?.session_id)
    add('params.session_id', params.session_id)
  if (typeof input.cwd === 'string') add(t('node.manager.folder'), input.cwd)
  return { rows, escaped, evidence: visibleJson(input, 2) }
})
const nodeValue = ref('')
const obsidianCall = computed(
  () => props.nodePrompt?.run_id === `obsidian:${props.message.toolCallId}`
)

const session = computed(() =>
  props.nodePrompt ? undefined : ChatService.getInstance().activeSession.value
)
const isEditing = ref(false)
const originalOpen = ref(false)
const editedArgs = ref(JSON.stringify(props.message.toolParams, null, 2))
const params = computed(() => props.message.toolParams || {})
const questionList = computed(() =>
  Array.isArray(params.value.questions)
    ? params.value.questions.flatMap((value) => {
        if (!value || typeof value !== 'object' || typeof value.question !== 'string') return []
        return [
          {
            question: value.question,
            options: Array.isArray(value.options)
              ? value.options.filter(
                  (option: unknown): option is string => typeof option === 'string'
                )
              : [],
          },
        ]
      })
    : []
)
const letterTarget = computed(() =>
  props.message.toolName === 'send_message_to_chat'
    ? openMessagingChats().find((chat) => chat.id === params.value.chat_id)
    : undefined
)
const letterAuthority = computed(
  () =>
    (props.message.toolName === 'send_message_to_chat'
      ? session.value?.letterAuthority(params.value)
      : []
    )?.map((name) => {
      if (name === 'allow-all') return t('chat.letterAuthority.files')
      if (name === 'allow-edit') return t('chat.letterAuthority.edit')
      if (name === 'node') return t('chat.letterAuthority.node')
      return name
    }) ?? []
)
const contentKey = computed(() => {
  if (props.message.toolName === 'edit') return 'new_string'
  if (['create', 'write', 'create_script'].includes(props.message.toolName ?? '')) return 'content'
  if (props.message.toolName === 'eval_js') return 'code'
  return null
})
const editedParams = () =>
  contentKey.value
    ? { ...params.value, [contentKey.value]: editedArgs.value }
    : JSON.parse(editedArgs.value)
const keyRevision = ref(0)
const effectiveParams = computed(() => {
  try {
    return isEditing.value ? editedParams() : params.value
  } catch {
    return {}
  }
})
// The summary and action share the same unresolved snapshot. Unsaved MCP edits must
// not silently replace the request the person saw before clicking trust.
const resolvedKeyRequest = computed(() => {
  if (props.nodePrompt) return null
  void keyRevision.value
  void AbeleConfig.getInstance().version.value
  return secretRequestForTool(props.message.toolName ?? '', effectiveParams.value)
})
const keyRequest = computed(() => secretNames(resolvedKeyRequest.value).length > 0)
const keyInfo = computed(() => {
  void keyRevision.value
  if (!keyRequest.value) return null
  try {
    return secretRequestInfo(resolvedKeyRequest.value)
  } catch {
    return null
  }
})
const keyApprovalBusy = ref(false)
let keyApprovalController: AbortController | null = null
let unmounted = false
onUnmounted(() => {
  unmounted = true
  keyApprovalController?.abort()
})
watch(
  () => props.message.toolStatus,
  (status) => {
    if (status !== 'pending') keyApprovalController?.abort()
  }
)
const allowKeyAddress = async () => {
  const s = session.value
  const tc = s?.pendingToolCalls?.value[0]
  const messageId = props.message.id
  if (
    keyApprovalBusy.value ||
    (tc &&
      (tc.id !== props.message.toolCallId ||
        tc.name !== props.message.toolName ||
        JSON.stringify(tc.arguments) !== JSON.stringify(params.value) ||
        !s?.messages.value.some(
          (message) => message.id === messageId && message.toolCallId === tc.id
        )))
  )
    return
  const name = props.message.toolName ?? ''
  const originalArgs = JSON.stringify(tc?.arguments)
  const args = JSON.parse(JSON.stringify(effectiveParams.value))
  try {
    const request = resolvedKeyRequest.value
    if (!request) return
    const binding = JSON.stringify(request)
    const info = keyInfo.value
    if (!info) return
    const originalKeys = JSON.stringify(info.bindings)
    const controller = new AbortController()
    keyApprovalController = controller
    keyApprovalBusy.value = true
    await allowSecretRequestOrigins(
      request,
      info.bindings,
      controller.signal,
      () => {
        if (
          JSON.stringify(
            secretRequestForTool(props.message.toolName ?? '', effectiveParams.value)
          ) !== binding
        )
          throw new Error(t('streamB.theRequestChanged.5f08c5'))
      },
      () => {
        keyRevision.value++
      }
    )
    // MCP recipients and headers come from settings, not tool arguments. Recheck the
    // resolved request at continuation too, after the consent transaction has settled.
    const currentRequest = secretRequestForTool(name, effectiveParams.value)
    if (
      s &&
      tc &&
      currentRequest &&
      JSON.stringify(currentRequest) === binding &&
      JSON.stringify(secretRequestInfo(currentRequest).bindings) === originalKeys &&
      !unmounted &&
      !controller.signal.aborted &&
      session.value === s &&
      s.pendingToolCalls.value[0] === tc &&
      tc.name === name &&
      props.message.id === messageId &&
      props.message.toolCallId === tc.id &&
      props.message.toolName === name &&
      JSON.stringify(tc.arguments) === originalArgs &&
      JSON.stringify(effectiveParams.value) === JSON.stringify(args) &&
      !s.needsApproval(name, args)
    )
      await s.approveToolCall(isEditing.value ? args : undefined)
  } catch {
    keyRevision.value++
    if (!unmounted) parseError.value = t('streamB.couldNotSaveKeyPermissionReviewThe.0d67e9')
  } finally {
    keyApprovalController = null
    if (!unmounted) keyApprovalBusy.value = false
  }
}

/** A request of one plain value, a command or a path: shown as that value, in code. */
const soleParam = computed(() => {
  const values = Object.values(params.value)
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : null
})

/** Answers asked for less often than Allow and Deny: in the card's menu. */
function moreMenu(event?: MouseEvent) {
  const menu = new Menu()
  if (canAllowAll.value)
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.alwaysAllow.804099', { v0: String(props.message.toolName) }))
        .setIcon('check-check')
        .setDisabled(keyApprovalBusy.value)
        .onClick(() => void allowAll())
    )
  if (canApproveAllWrites.value)
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.alwaysAllowWritesInScope.f6706f'))
        .setIcon('pencil-line')
        .setDisabled(keyApprovalBusy.value)
        .onClick(() => void approveAllWrites())
    )
  menu.addItem((i) =>
    i
      .setTitle(
        isEditing.value ? t('streamB.stopEditing.ec8404') : t('streamB.editBeforeAllowing.a9f70a')
      )
      .setIcon('braces')
      .onClick(() => toggleEdit())
  )
  if (event) {
    const button = event.currentTarget as HTMLElement
    const rect = button.getBoundingClientRect()
    menu.onHide(() => button.focus({ preventScroll: true }))
    menu.showAtPosition({ x: rect.left, y: rect.bottom })
  }
}

const headerText = computed(() => {
  if (props.nodePrompt && !obsidianCall.value) {
    const title = props.nodePrompt.title || props.nodePrompt.tool_name
    return managerApproval.value ? visibleText(title) : title
  }
  switch (props.message.toolName) {
    case 'create':
      return t('streamB.createFile.6990d3')
    case 'edit':
      return t('streamB.editFile.9608dd')
    case 'rm':
      return t('streamB.deleteFile.28e18d')
    case 'mv':
      return t('streamB.moveFile.f83e6d')
    case 'cp':
      return t('streamB.copyFile.b60f1c')
    case 'eval_js':
      return t('streamB.executeJavascript.b50b90')
    case 'write_settings':
      return t('streamB.changeASetting.a6101e')
    default: {
      // A tool's own name, said as words: run_command → Run command.
      return readableToolName(props.message.toolName ?? 'tool')
    }
  }
})

/**
 * What the file being written holds right now, or null when there is nothing to compare
 * against — the path names no file, or reading it failed.
 *
 * `write` replaces a file whole, and it only accepts a file that already exists: shown as
 * plain content, its preview says what the file will contain but not what is being taken
 * away. A diff answers the question actually being asked for approval. `create`, whose file
 * does not exist yet, keeps the plain preview: there is nothing to diff against.
 */
const currentContent = ref<string | null>(null)

watch(
  () => [props.message.toolName, params.value.path] as const,
  ([toolName, path]) => {
    currentContent.value = null
    if (props.nodePrompt || toolName !== 'write' || typeof path !== 'string' || !path) return

    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return

    void app.vault
      .read(file)
      .then((content) => {
        // The path can change while the read is in flight; a stale answer must not land.
        if (params.value.path === path) currentContent.value = content
      })
      .catch(() => {
        // An unreadable file is not worth an error in an approval prompt — it falls back to
        // showing the content that would be written.
      })
  },
  { immediate: true }
)

const wordPreview = ref<{ old: string; new: string } | null>(null)
const wordPreviewError = ref('')
let wordPreviewVersion = 0
watch(
  () => JSON.stringify(params.value),
  async () => {
    const version = ++wordPreviewVersion
    wordPreview.value = null
    wordPreviewError.value = ''
    if (props.nodePrompt || !['docx_edit', 'xlsx_write'].includes(props.message.toolName ?? ''))
      return
    try {
      const path = String(params.value.path || '')
      if (!session.value?.scopeResolver.isInScope(path))
        throw new Error(t('streamB.documentIsOutsideThisChatSScope.e410dd'))
      if (
        ['image_insert', 'image_replace'].includes(String(params.value.operation)) &&
        !session.value.scopeResolver.isInScope(String(params.value.image_path || ''))
      )
        throw new Error(t('streamB.imageIsOutsideThisChatSScope.06fe27'))
      const app = GlobalStore.getInstance().app
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(t('streamB.documentNotFound.271799'))
      if (!session.value.scopeResolver.isInScope(file.path))
        throw new Error(t('streamB.documentIsOutsideThisChatSScope.e410dd'))
      const prepared =
        props.message.toolName === 'xlsx_write'
          ? await prepareWorkbookChange(
              app,
              file,
              params.value as unknown as WorkbookEdit,
              String(params.value.revision || '')
            )
          : await prepareWordChange(
              app,
              file,
              params.value as unknown as WordEdit,
              String(params.value.revision || '')
            )
      if (version === wordPreviewVersion) wordPreview.value = prepared.diff
    } catch (error) {
      if (version === wordPreviewVersion) wordPreviewError.value = (error as Error).message
    }
  },
  { immediate: true }
)

const deckPreview = ref<{ old: string; new: string } | null>(null)
const deckPreviewError = ref('')
let deckPreviewVersion = 0
watch(
  () => [props.message.toolName, JSON.stringify(effectiveParams.value)],
  async () => {
    const version = ++deckPreviewVersion
    deckPreview.value = null
    deckPreviewError.value = ''
    const name = props.message.toolName
    if (props.nodePrompt || (name !== 'deck_create' && name !== 'deck_edit')) return
    try {
      const p = effectiveParams.value
      let old = ''
      if (name === 'deck_edit') {
        if (!session.value?.scopeResolver.isInScope(String(p.path || '')))
          throw new Error(t('streamB.presentationIsOutsideThisChatSScope.9783f3'))
        const app = GlobalStore.getInstance().app
        const file = app.vault.getAbstractFileByPath(String(p.path || ''))
        if (!(file instanceof TFile)) throw new Error(t('streamB.presentationNotFound.427397'))
        old = await app.vault.read(file)
      }
      const next =
        name === 'deck_create' ? prepareDeckCreate(p) : prepareSlideEdit(old, p as SlideEdit)
      if (version === deckPreviewVersion) deckPreview.value = { old, new: next }
    } catch (error) {
      if (version === deckPreviewVersion) deckPreviewError.value = (error as Error).message
    }
  },
  { immediate: true }
)
/**
 * What a `write_settings` call would change, read the way the tool itself reads it — so the
 * card cannot show one value and the tool report another. Null for any other tool.
 */
const settingsWrite = computed(() => {
  if (props.nodePrompt || props.message.toolName !== 'write_settings') return null
  const { path, value } = params.value
  if (typeof path !== 'string') return null
  return describeSettingsWrite(path, typeof value === 'string' ? value : JSON.stringify(value))
})

const parseError = ref('')

const approve = () => {
  if (props.nodePrompt) {
    if (!props.disabled && !props.answerState)
      emit(
        'answer',
        'allow',
        ['input', 'select'].includes(props.nodePrompt.kind) ? nodeValue.value : undefined
      )
    return
  }
  if (keyApprovalBusy.value) return
  if (props.message.toolName?.startsWith('mcp_') && !props.message.toolCallId) {
    parseError.value = t('streamB.thisMcpCallHasNoRecordedIdentity.da54ff')
    return
  }
  if (isEditing.value) {
    try {
      const modified = editedParams()
      parseError.value = ''
      session.value?.approveToolCall(modified, false, props.message.toolCallId)
    } catch (err: unknown) {
      parseError.value = t('streamB.invalidJson.2a60dd', {
        v0: String(presentUiError(err)),
      })
      return
    }
  } else {
    session.value?.approveToolCall(undefined, false, props.message.toolCallId)
  }
}

/**
 * Whether this call is one that "always allow writes" would cover.
 *
 * The mode it turns on stops asking about writes and nothing else, so it is offered only for
 * a write, and only while the chat is still confirming each one. Deleting, moving and copying
 * keep asking under it, and so does any path outside the scope.
 */
const canApproveAllWrites = computed(() => {
  const s = session.value
  const name = props.message.toolName
  if (!s || !name || (!WRITE_TOOLS.includes(name) && !NODE_EDIT_TOOLS.includes(name))) return false
  if (DECK_WRITE_TOOLS.includes(name) && s.getToolMode(name) !== 'auto') return false
  return s.permissionMode.value === 'confirm-all'
})

const approveAllWrites = () => {
  const s = session.value
  if (!s) return
  s.permissionMode.value = 'allow-edit'
  s.approveToolCall()
}

/**
 * Whether this one tool can be put on automatic.
 *
 * Offered only while it is still in ask mode. What it covers is this tool and nothing else,
 * which is why the button names it: labelled "Allow all" it was read as letting the agent get
 * on with everything, and the next call to a different tool asking again looked like the
 * button not having taken.
 */
const canAllowAll = computed(() => {
  const name = props.message.toolName
  if (
    !name ||
    name === 'node_propose_edit' ||
    NODE_MUTATION_TOOLS.includes(name) ||
    keyRequest.value
  )
    return false
  const s = session.value
  if (!s) return false
  return s.getToolMode(name, props.message.toolCallId) === 'ask'
})

const allowAll = () => {
  const s = session.value
  const name = props.message.toolName
  if (!s || !name) return
  if (name.startsWith('mcp_')) {
    if (!props.message.toolCallId) {
      parseError.value = t('streamB.thisMcpCallHasNoRecordedIdentity.da54ff')
      return
    }
    void s.approveToolCall(undefined, true, props.message.toolCallId)
    return
  }
  s.toolModes.value = { ...s.toolModes.value, [name]: 'auto' }
  s.approveToolCall()
}

const reject = () => {
  if (props.nodePrompt) {
    if (!props.disabled && !props.answerState) emit('answer', 'deny')
    return
  }
  keyApprovalController?.abort()
  session.value?.rejectToolCall('User rejected this action')
}

const stop = () => {
  if (props.nodePrompt) {
    if (!props.disabled) emit('stop')
    return
  }
  keyApprovalController?.abort()
  session.value?.stopFromApproval(props.message.toolCallId)
}

const toggleEdit = () => {
  if (!isEditing.value) {
    const content = contentKey.value ? params.value[contentKey.value] : undefined
    editedArgs.value = contentKey.value
      ? typeof content === 'string'
        ? content
        : JSON.stringify(content ?? '')
      : JSON.stringify(params.value, null, 2)
  }
  isEditing.value = !isEditing.value
}
</script>

<style lang="scss">
// The debugger's card: a thin frame in the accent while it waits for you, small text.
.abele-tool-approval {
  margin: var(--size-4-2) 0;

  > * {
    margin-bottom: 0;
  }
}

.abele-tool-approval__header {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  min-width: 0;
  color: var(--text-normal);

  .abele-obsidian-icon:not(.clickable-icon) {
    padding: 0;
    color: var(--icon-color);
  }
}

.abele-tool-approval__what {
  flex: 1 1 auto;
  min-width: 0;
}

.abele-tool-approval .abele-tool-approval__more {
  margin-block: calc(-1 * var(--size-2-2));
}

.abele-tool-approval__path {
  font-family: var(--font-monospace);
  font-size: var(--font-small);
  color: var(--text-accent);
  margin-bottom: var(--size-4-2);
}

.abele-tool-approval__code {
  margin: 0;
  background-color: var(--abele-code-background);
  border-radius: var(--radius-s);
  padding: var(--size-4-1) var(--size-4-2);
  max-height: 300px;
  overflow: auto;

  code {
    color: var(--code-normal);
    font-size: var(--font-ui-smaller);
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.abele-tool-approval__diff {
  margin-bottom: var(--size-4-2);
  border-radius: var(--radius-s);
  overflow: hidden;
  max-height: 300px;
  overflow-y: auto;
}

.abele-tool-approval__move {
  font-family: var(--font-monospace);
  font-size: var(--font-small);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-2);
}

.abele-tool-approval__arrow {
  color: var(--text-faint);
}

.abele-tool-approval__before,
.abele-tool-approval__after {
  word-break: break-all;
}

.abele-tool-approval__warning {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  font-size: var(--font-small);
  color: var(--text-warning);
  margin-bottom: var(--size-4-2);
}

.abele-tool-approval__note {
  font-size: var(--font-small);
  color: var(--text-muted);
  margin-bottom: var(--size-4-2);
}

.abele-tool-approval__param {
  font-size: var(--font-small);
  margin-bottom: var(--size-4-1);
  // Nested file selections and other JSON values must remain readable in a narrow chat.
  overflow-wrap: anywhere;

  .abele-tool-approval__param-key {
    font-weight: 600;
    margin-right: var(--size-4-1);
    color: var(--text-muted);

    &::after {
      content: ':';
    }
  }
}

.abele-tool-approval__editor {
  margin-bottom: var(--size-4-2);

  textarea {
    width: 100%;
    min-height: 100px;
    font-family: var(--font-monospace);
    font-size: var(--font-small);
  }
}

.abele-tool-approval__parse-error {
  color: var(--text-error);
  font-size: var(--font-small);
  margin-top: var(--size-4-1);
}

.abele-tool-approval__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--size-4-2);

  .abele-tool-approval__stop {
    order: -1;
    margin-inline-end: auto;
  }
}
</style>
