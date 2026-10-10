<template>
  <Modal
    :title="title"
    :size="mode === 'share' || mode === 'review' ? 'tall' : 'default'"
    phone-sheet
    @close="close"
  >
    <Section
      v-if="mode === 'connect'"
      desc="Paste the token you received. It already contains the server and the folder or group."
    >
      <Setting name="Connection token"
        ><Input v-model="text" password :disabled="busy" placeholder="Paste your token"
      /></Setting>
      <TokenQrReader @token="text = $event" />
      <Setting v-if="preview" name="Server" :desc="preview.address" />
      <Setting v-if="preview" name="Shared files" :desc="scopeName(preview.scope)" />
    </Section>
    <Section
      v-if="mode === 'share'"
      :desc="scopeName(connection?.scope ?? null) + ' · ' + connection?.address"
    >
      <Setting
        name="Folder or group"
        desc="Choose what to share. Choose / for another device of your own."
      >
        <Dropdown
          v-model="selected"
          :options="
            choices.map((one, index) => ({ value: String(index), display: scopeName(one) }))
          "
        />
      </Setting>
      <Setting name="Name" desc="A name to recognise this access later."
        ><Input v-model="label" maxlength="200" placeholder="For a new device or a collaborator"
      /></Setting>
      <Setting name="Create access"
        ><Button
          text="Get token"
          tooltip="Create a separate token for the chosen folder or group"
          :disabled="busy || !label.trim() || !choices.length"
          @click="run(issue)"
      /></Setting>
      <Section
        v-if="issued"
        title="New token"
        desc="Anyone with this token can read and change the shared files. Send it privately."
      >
        <Setting name="Token"
          ><Input :model-value="issued" as-text-area :rows="4" readonly
        /></Setting>
        <Setting name="Copy token"
          ><Button text="Copy" tooltip="Copy this token to the clipboard" @click="run(copy)"
        /></Setting>
        <QrCode :text="issued" label="Scan to connect to these shared files" />
      </Section>
      <Section title="Access tokens" desc="Revoking access keeps the recipient’s local files.">
        <EmptyState v-if="!tokens.length" text="No access tokens to show." />
        <Setting
          v-for="one in tokens"
          :key="one.id"
          :name="one.label || scopeName(one.scope)"
          :desc="scopeName(one.scope) + ' · ' + (one.revoked_at ? 'Revoked' : 'Active')"
        >
          <Icon
            v-if="!one.revoked_at"
            icon="ban"
            tooltip="Review revoking this access"
            :disabled="busy"
            @click="revoking = one"
          />
        </Setting>
        <Setting
          v-if="revoking"
          :name="'Revoke ' + revoking.label + '?'"
          desc="This token will stop receiving and sending changes. Other tokens keep working."
        >
          <Button
            text="Revoke"
            warning
            tooltip="Close access for this token"
            :disabled="busy"
            @click="run(revoke)"
          />
          <Button text="Keep access" tooltip="Cancel revocation" @click="revoking = null" />
        </Setting>
      </Section>
    </Section>
    <Section
      v-if="mode === 'review' && candidate"
      :title="candidate.path"
      :desc="candidate.source.address + ' · ' + scopeName(candidate.source.scope)"
    >
      <Setting
        name="Change"
        :desc="
          operationName(candidate.operation) +
          (candidate.previousPath ? ' · From ' + candidate.previousPath : '')
        "
      />
      <Setting name="Received" :desc="time(candidate.receivedAt)" />
      <Setting name="File changed" :desc="time(candidate.mtime)" />
      <p>This exact version is waiting. Approving it does not approve a later change.</p>
      <pre v-if="candidate.bytes !== null" class="token-sync-content">{{ content }}</pre>
      <p v-else>
        {{
          candidate.operation === 'delete'
            ? 'This file will be deleted.'
            : 'The path will change; there is no new content.'
        }}
      </p>
    </Section>
    <Section
      v-if="mode === 'attachment' && question"
      :title="question.path"
      :desc="question.source.address + ' · ' + scopeName(question.source.scope)"
    >
      <p>
        This opened note links to a private file. Allow this connection to share the file and its
        future changes?
      </p>
      <p>Other private files and other connections are unaffected.</p>
    </Section>
    <Section
      v-if="mode === 'disconnect'"
      :desc="scopeName(connection?.scope ?? null) + ' · ' + connection?.address"
    >
      <p>This connection will stop syncing. All local files and other connections stay.</p>
    </Section>
    <p v-if="error" role="alert">{{ error }}</p>
    <template #footer>
      <Button
        v-if="mode === 'connect'"
        text="Connect"
        tooltip="Connect using this token"
        :disabled="busy || !text.trim()"
        accent
        @click="run(connect)"
      />
      <Button
        v-if="mode === 'review'"
        text="Approve"
        tooltip="Apply only the version shown here"
        :disabled="busy || !ui.runtimes.has(candidate?.source.id ?? '')"
        accent
        @click="run(approve)"
      />
      <Button
        v-if="mode === 'review'"
        text="Reject"
        tooltip="Keep the current local version"
        :disabled="busy"
        @click="run(reject)"
      />
      <Button
        v-if="mode === 'attachment'"
        text="Allow"
        tooltip="Allow this file through this connection"
        :disabled="busy"
        @click="run(() => decide(true))"
      />
      <Button
        v-if="mode === 'attachment'"
        text="Deny"
        tooltip="Keep this file private for this connection"
        :disabled="busy"
        @click="run(() => decide(false))"
      />
      <Button
        v-if="mode === 'disconnect'"
        text="Disconnect"
        warning
        tooltip="Disconnect and keep local files"
        :disabled="busy"
        @click="run(disconnect)"
      />
      <Button text="Close" tooltip="Close without making another decision" @click="close" />
    </template>
  </Modal>
</template>
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Notice } from 'obsidian'
import Modal from '../obsidian/Modal.vue'
import Setting from '../obsidian/Setting.vue'
import Section from '../obsidian/Section.vue'
import Input from '../obsidian/Input.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import QrCode from '../obsidian/QrCode.vue'
import TokenQrReader from './TokenQrReader.vue'
import { connectionError, scopeName, type TokenUi } from '@/sync/tokenUi'
import type { ExecutableCandidate } from '@/sync/executableReview'
import type { AttachmentQuestion } from '@/sync/attachmentConsent'
import type { V2Scope, V2TokenInfo } from '@/sync/v2/contract'
import { decodeAccessToken } from '@/sync/v2/client'
const props = defineProps<{
  ui: TokenUi
  mode: 'connect' | 'share' | 'review' | 'attachment' | 'disconnect'
  connectionId?: string
  candidate?: ExecutableCandidate
  question?: AttachmentQuestion
}>()
const emit = defineEmits<{ close: [] }>()
const enrollment = new AbortController()
let generation = 0
let alive = true
function invalidate() {
  generation++
  issued.value = ''
  tokens.value = []
  revoking.value = null
  error.value = ''
  busy.value = false
}
function close() {
  enrollment.abort()
  alive = false
  invalidate()
  emit('close')
}
onBeforeUnmount(() => {
  enrollment.abort()
  alive = false
  invalidate()
})
const text = ref(''),
  error = ref(''),
  busy = ref(false),
  selected = ref('0'),
  label = ref(''),
  issued = ref('')
const choices = ref<V2Scope[]>([]),
  tokens = ref<V2TokenInfo[]>([]),
  revoking = ref<V2TokenInfo | null>(null)
const connection = computed(() => props.ui.rows.value.find((one) => one.id === props.connectionId))
const title = computed(
  () =>
    ({
      connect: 'Connect to a server',
      share: 'Share access',
      review: 'Review incoming code',
      attachment: 'Share a private file?',
      disconnect: 'Disconnect?',
    })[props.mode]
)
const content = computed(() =>
  new TextDecoder().decode(new Uint8Array(props.candidate?.bytes ?? []))
)
const preview = computed(() => {
  try {
    return decodeAccessToken(text.value)
  } catch {
    return null
  }
})
const time = (value: number) => new Date(value).toLocaleString()
const operationName = (value: string) =>
  (
    ({
      create: 'New file',
      modify: 'Changed file',
      move: 'Renamed or moved file',
      delete: 'Deleted file',
    }) as Record<string, string>
  )[value] ?? 'Changed file'
async function run(action: () => Promise<void>) {
  if (busy.value || !alive) return
  const epoch = generation
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (cause) {
    if (alive && epoch === generation) error.value = connectionError(cause)
  } finally {
    if (alive && epoch === generation) busy.value = false
  }
}
async function connect() {
  await props.ui.connect(text.value, enrollment.signal)
  text.value = ''
  new Notice('Connection saved')
  emit('close')
}
async function issue() {
  const epoch = generation,
    id = props.connectionId
  const scope = choices.value[Number(selected.value)]
  if (!scope) return
  const result = (
    await props.ui
      .client(id)
      .issue({ scope: { kind: scope.kind, id: scope.id }, label: label.value.trim() })
  ).token
  if (!alive || epoch !== generation) return
  issued.value = result
  const listed = await props.ui.issued(id)
  if (alive && epoch === generation) tokens.value = listed
}
async function copy() {
  await navigator.clipboard.writeText(issued.value)
  new Notice('Token copied')
}
async function revoke() {
  if (!revoking.value) return
  const epoch = generation,
    id = props.connectionId
  await props.ui.client(id).revoke(revoking.value.id)
  if (!alive || epoch !== generation) return
  revoking.value = null
  const listed = await props.ui.issued(id)
  if (alive && epoch === generation) tokens.value = listed
}
async function approve() {
  if (props.candidate) await props.ui.approve(props.candidate)
  emit('close')
}
async function reject() {
  if (props.candidate) await props.ui.reject(props.candidate)
  emit('close')
}
async function decide(allow: boolean) {
  if (props.question) await props.ui.decide(props.question, allow)
  emit('close')
}
async function disconnect() {
  await props.ui.disconnect(props.connectionId)
  emit('close')
}
function loadShare() {
  if (props.mode === 'share')
    void run(async () => {
      const epoch = generation,
        id = props.connectionId
      const available = await props.ui.choices(id)
      if (!alive || epoch !== generation) return
      choices.value = available
      const listed = await props.ui.issued(id)
      if (alive && epoch === generation) tokens.value = listed
    })
}
onMounted(loadShare)
watch(
  () => [props.ui, props.connectionId, props.mode],
  () => {
    invalidate()
    choices.value = []
    selected.value = '0'
    loadShare()
  },
  { flush: 'sync' }
)
watch(
  selected,
  () => {
    invalidate()
    loadShare()
  },
  { flush: 'sync' }
)
</script>
<style>
.token-sync-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
