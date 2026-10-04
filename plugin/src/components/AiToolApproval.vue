<template>
  <div class="abele-tool-approval">
    <div class="abele-tool-approval__header">
      <Icon icon="shield-alert" />
      <span>{{ headerText }}</span>
    </div>

    <!-- Create: the file does not exist yet, so its content is all there is to show -->
    <template v-if="message.toolName === 'create'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <pre class="abele-tool-approval__code"><code>{{ params.content }}</code></pre>
    </template>

    <!-- Write: an overwrite of a file that exists, so show what it does to it -->
    <template v-else-if="message.toolName === 'write'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <Diff
        v-if="currentContent !== null"
        :text-left="currentContent"
        :text-right="String(params.content || '')"
        class="abele-tool-approval__diff"
      />
      <pre v-else class="abele-tool-approval__code"><code>{{ params.content }}</code></pre>
    </template>

    <!-- Edit: show diff -->
    <template v-else-if="message.toolName === 'edit'">
      <div class="abele-tool-approval__path">{{ params.path }}</div>
      <Diff
        v-if="params.old_string || params.new_string"
        :text-left="String(params.old_string || '')"
        :text-right="String(params.new_string || '')"
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
      <div v-else>{{ wordPreviewError || 'Preparing Office edit preview…' }}</div>
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
      <div v-else>{{ deckPreviewError || 'Preparing presentation edit preview…' }}</div>
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
      <pre class="abele-tool-approval__code"><code>{{ params.content }}</code></pre>
    </template>

    <!-- Fallback: readable key-value -->
    <template v-else>
      <div v-for="(val, key) in params" :key="key" class="abele-tool-approval__param">
        <span class="abele-tool-approval__param-key">{{ key }}</span>
        <span>{{ typeof val === 'string' ? val : JSON.stringify(val) }}</span>
      </div>
    </template>

    <div v-if="keyInfo?.names.length" class="abele-tool-approval__param">
      <span>Saved keys: {{ keyInfo.names.join(', ') }} → {{ keyInfo.origin }}</span>
      <span
        >Allow this address remembers it for these keys on this device. Send once approves only this
        request; it does not change the allowed list or tool permissions.</span
      >
      <Button
        v-if="keyInfo.missing.length"
        text="Allow this address for these keys"
        :disabled="keyApprovalBusy"
        @click="allowKeyAddress"
      />
    </div>

    <!-- Edit JSON (toggle) -->
    <div v-if="isEditing" class="abele-tool-approval__editor">
      <Input
        :model-value="editedArgs"
        as-text-area
        placeholder="Edit arguments (JSON)"
        @update:model-value="editedArgs = $event"
      />
      <div v-if="parseError" class="abele-tool-approval__parse-error">{{ parseError }}</div>
    </div>

    <div v-if="parseError && !isEditing" class="abele-tool-approval__parse-error">
      {{ parseError }}
    </div>
    <div class="abele-tool-approval__actions">
      <Button
        :text="keyInfo && !keyInfo.missing.length ? 'Send once' : 'Approve'"
        :disabled="keyApprovalBusy"
        @click="approve"
      />
      <Button
        v-if="canApproveAllWrites"
        text="Always allow writes"
        :disabled="keyApprovalBusy"
        tooltip="Stop asking about writes inside the scope. Anything outside it still asks."
        @click="approveAllWrites"
      />
      <Button
        v-if="canAllowAll"
        text="Always allow"
        :disabled="keyApprovalBusy"
        :tooltip="`Stop asking about ${message.toolName}. Every other tool still asks.`"
        @click="allowAll"
      />
      <Button text="Edit" @click="toggleEdit" />
      <Button text="Reject" @click="reject" />
    </div>
  </div>
</template>

<script setup lang="ts">
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
import Diff from './Diff.vue'
import { ChatService } from '@/ai/ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { TFile } from 'obsidian'
import { WRITE_TOOLS, DECK_WRITE_TOOLS } from '@/ai/types'
import type { ChatMessage } from '@/ai/types'
import { prepareWordChange } from '@/word/vaultAdapter'
import type { WordEdit } from '@/word/edit'
import { prepareWorkbookChange } from '@/spreadsheet/vaultAdapter'
import type { WorkbookEdit } from '@/spreadsheet/edit'
import { prepareDeckCreate, prepareSlideEdit, type SlideEdit } from '@/slides/core/edit'

const props = defineProps<{
  message: ChatMessage
}>()

const session = computed(() => ChatService.getInstance().activeSession.value)
const isEditing = ref(false)
const editedArgs = ref(JSON.stringify(props.message.toolParams, null, 2))
const params = computed(() => props.message.toolParams || {})
const keyRevision = ref(0)
const effectiveParams = computed(() => {
  try {
    return isEditing.value ? JSON.parse(editedArgs.value) : params.value
  } catch {
    return {}
  }
})
// The summary and action share the same unresolved snapshot. Unsaved MCP edits must
// not silently replace the request the person saw before clicking trust.
const resolvedKeyRequest = computed(() => {
  void keyRevision.value
  void AbeleConfig.getInstance().version.value
  return secretRequestForTool(props.message.toolName ?? '', effectiveParams.value)
})
const keyRequest = computed(() => secretNames(resolvedKeyRequest.value).length > 0)
const keyInfo = computed(() => {
  void keyRevision.value
  if (!keyRequest.value) return null
  try {
    return secretRequestInfo(resolvedKeyRequest.value!)
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
  if (
    keyApprovalBusy.value ||
    (tc && (tc.id !== props.message.toolCallId || tc.name !== props.message.toolName))
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
          throw new Error('The request changed')
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
      props.message.toolCallId === tc.id &&
      props.message.toolName === name &&
      JSON.stringify(tc.arguments) === originalArgs &&
      JSON.stringify(effectiveParams.value) === JSON.stringify(args) &&
      !s.needsApproval(name, args)
    )
      await s.approveToolCall(isEditing.value ? args : undefined)
  } catch {
    keyRevision.value++
    if (!unmounted)
      parseError.value =
        'Could not save key permission. Review the current request and key destinations, then retry.'
  } finally {
    keyApprovalController = null
    if (!unmounted) keyApprovalBusy.value = false
  }
}

const headerText = computed(() => {
  switch (props.message.toolName) {
    case 'create':
      return 'Create file'
    case 'edit':
      return 'Edit file'
    case 'rm':
      return 'Delete file'
    case 'mv':
      return 'Move file'
    case 'cp':
      return 'Copy file'
    case 'eval_js':
      return 'Execute JavaScript'
    default:
      return `Execute ${props.message.toolName}`
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
    if (toolName !== 'write' || typeof path !== 'string' || !path) return

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
    if (!['docx_edit', 'xlsx_write'].includes(props.message.toolName ?? '')) return
    try {
      const path = String(params.value.path || '')
      if (!session.value?.scopeResolver.isInScope(path))
        throw new Error('Document is outside this chat’s scope')
      if (
        ['image_insert', 'image_replace'].includes(String(params.value.operation)) &&
        !session.value.scopeResolver.isInScope(String(params.value.image_path || ''))
      )
        throw new Error('Image is outside this chat’s scope')
      const app = GlobalStore.getInstance().app
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error('Document not found')
      if (!session.value.scopeResolver.isInScope(file.path))
        throw new Error('Document is outside this chat’s scope')
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
    if (name !== 'deck_create' && name !== 'deck_edit') return
    try {
      const p = effectiveParams.value
      let old = ''
      if (name === 'deck_edit') {
        if (!session.value?.scopeResolver.isInScope(String(p.path || '')))
          throw new Error('Presentation is outside this chat’s scope')
        const app = GlobalStore.getInstance().app
        const file = app.vault.getAbstractFileByPath(String(p.path || ''))
        if (!(file instanceof TFile)) throw new Error('Presentation not found')
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

const parseError = ref('')

const approve = () => {
  if (keyApprovalBusy.value) return
  if (isEditing.value) {
    try {
      const modified = JSON.parse(editedArgs.value)
      parseError.value = ''
      session.value?.approveToolCall(modified)
    } catch (err: unknown) {
      parseError.value = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`
      return
    }
  } else {
    session.value?.approveToolCall()
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
  if (!s || !name || !WRITE_TOOLS.includes(name)) return false
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
  if (!name || keyRequest.value) return false
  const s = session.value
  if (!s) return false
  return s.getToolMode(name) === 'ask'
})

const allowAll = () => {
  const s = session.value
  const name = props.message.toolName
  if (!s || !name) return
  s.toolModes.value = { ...s.toolModes.value, [name]: 'auto' }
  s.approveToolCall()
}

const reject = () => {
  keyApprovalController?.abort()
  session.value?.rejectToolCall('User rejected this action')
}

const toggleEdit = () => {
  isEditing.value = !isEditing.value
}
</script>

<style lang="scss">
.abele-tool-approval {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-3);
  margin: var(--size-4-2) 0;
  background-color: var(--background-secondary);
}

.abele-tool-approval__header {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-2);
  font-weight: 600;
  color: var(--text-normal);
}

.abele-tool-approval__path {
  font-family: var(--font-monospace);
  font-size: var(--font-small);
  color: var(--text-accent);
  margin-bottom: var(--size-4-2);
}

.abele-tool-approval__code {
  background-color: var(--background-primary);
  border-radius: var(--radius-s);
  padding: var(--size-4-2);
  max-height: 300px;
  overflow: auto;
  margin-bottom: var(--size-4-2);

  code {
    font-size: var(--font-small);
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
  align-items: center;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-2);
}

.abele-tool-approval__arrow {
  color: var(--text-faint);
}

.abele-tool-approval__param {
  font-size: var(--font-small);
  margin-bottom: var(--size-4-1);

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
  gap: var(--size-4-2);
}
</style>
