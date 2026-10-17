<template>
  <Modal
    :title="title"
    :size="mode === 'share' || mode === 'review' ? 'tall' : 'default'"
    phone-sheet
    @close="close"
  >
    <Section
      v-if="mode === 'connect'"
      desc="Paste the token you were given, or scan its QR code. It already names the server and what it opens."
    >
      <Setting name="Token" :error="error"
        ><Input v-model="text" password :disabled="busy" placeholder="Paste your token"
      /></Setting>
      <TokenQrReader @token="text = $event" />
      <dl v-if="preview" class="abele-token-dialog__facts">
        <dt>Server</dt>
        <dd>{{ preview.address }}</dd>
        <dt>Opens</dt>
        <dd>{{ scopeName(preview.scope) }}</dd>
      </dl>
    </Section>
    <template v-if="mode === 'share'">
      <Section
        desc="Give someone a folder or group, or connect another device of yours to the whole vault."
      >
        <Setting name="What to share" desc="Whole vault is for your own devices.">
          <Dropdown
            v-model="selected"
            :options="
              choices.map((one, index) => ({ value: String(index), display: scopeName(one) }))
            "
          />
        </Setting>
        <Setting name="Name" desc="Who or what it is for, to know it later."
          ><Input v-model="label" maxlength="200" placeholder="A second device, a colleague"
        /></Setting>
        <Setting name="Token">
          <Button
            text="Create token"
            tooltip="Create a separate token for the chosen folder or group"
            :disabled="busy || !label.trim() || !choices.length"
            @click="run(issue)"
          />
        </Setting>
      </Section>
      <Section
        v-if="issued"
        title="New token"
        desc="Anyone with this token can read and change what it opens. Send it privately."
      >
        <Input :model-value="issued" as-text-area :rows="3" readonly />
        <div class="abele-token-dialog__copy">
          <Button text="Copy" tooltip="Copy this token to the clipboard" @click="run(copy)" />
        </div>
        <QrCode :text="issued" label="Scan to connect to these shared files" />
      </Section>
      <Section
        title="Tokens given"
        desc="Revoking stops the exchange. What the other side already has stays with them."
      >
        <EmptyState v-if="!tokens.length" text="No tokens given yet." />
        <Setting
          v-for="one in tokens"
          :key="one.id"
          :name="one.label || scopeName(one.scope)"
          :class="{ 'abele-token-dialog__revoked': one.revoked_at }"
          :desc="scopeName(one.scope) + ' · ' + (one.revoked_at ? 'Revoked' : 'Active')"
        >
          <Icon
            v-if="!one.revoked_at"
            icon="ban"
            tooltip="Revoke this access…"
            :disabled="busy"
            @click="revoking = one"
          />
        </Setting>
        <Setting
          v-if="revoking"
          :name="'Revoke ' + revoking.label + '?'"
          desc="This token stops receiving and sending changes. Other tokens keep working."
        >
          <Button text="Keep access" tooltip="Cancel revocation" @click="revoking = null" />
          <Button
            text="Revoke"
            warning
            tooltip="Close access for this token"
            :disabled="busy"
            @click="run(revoke)"
          />
        </Setting>
      </Section>
    </template>
    <Section
      v-if="mode === 'review' && candidate"
      :title="candidate.path"
      :desc="candidate.source.address + ' · ' + scopeName(candidate.source.scope)"
    >
      <dl class="abele-token-dialog__facts">
        <dt>Change</dt>
        <dd>
          {{
            operationName(candidate.operation) +
            (candidate.previousPath ? ' · From ' + candidate.previousPath : '')
          }}
        </dd>
        <dt>Received</dt>
        <dd>{{ time(candidate.receivedAt) }}</dd>
        <dt>File changed</dt>
        <dd>{{ time(candidate.mtime) }}</dd>
      </dl>
      <p class="abele-token-dialog__note">
        This exact version is waiting. Approving it does not approve a later change.
      </p>
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
      <p class="abele-token-dialog__note">
        Other private files and other connections are unaffected.
      </p>
    </Section>
    <Section
      v-if="mode === 'disconnect'"
      :desc="scopeName(connection?.scope ?? null) + ' · ' + connection?.address"
    >
      <p>
        This connection stops syncing. Every file stays on this device, and other connections keep
        working.
      </p>
    </Section>
    <p
      v-if="error && mode !== 'connect' && mode !== 'review'"
      class="abele-token-dialog__error"
      role="alert"
    >
      {{ error }}
    </p>
    <template #footer>
      <p
        v-if="mode === 'review' && error"
        class="abele-token-dialog__feedback abele-token-dialog__error"
        role="alert"
      >
        {{ error }}
      </p>
      <p v-if="mode === 'review' && approval" class="abele-token-dialog__feedback" role="status">
        {{ approval }}
      </p>
      <Button text="Close" tooltip="Close without making another decision" @click="close" />
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
        text="Reject"
        tooltip="Keep the current local version"
        :disabled="busy || !!approval"
        @click="run(reject)"
      />
      <Button
        v-if="mode === 'review'"
        :text="busy ? 'Approving…' : 'Approve'"
        tooltip="Apply only the version shown here"
        :disabled="busy || !!approval"
        accent
        @click="run(approve)"
      />
      <Button
        v-if="mode === 'attachment'"
        text="Deny"
        tooltip="Keep this file private for this connection"
        :disabled="busy"
        @click="run(() => decide(false))"
      />
      <Button
        v-if="mode === 'attachment'"
        text="Allow"
        accent
        tooltip="Allow this file through this connection"
        :disabled="busy"
        @click="run(() => decide(true))"
      />
      <Button
        v-if="mode === 'disconnect'"
        text="Disconnect"
        warning
        tooltip="Disconnect and keep local files"
        :disabled="busy"
        @click="run(disconnect)"
      />
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
const approval = computed(
  () =>
    props.ui.approvalStatus.value[props.candidate?.id ?? ''] ??
    (props.candidate?.status === 'queued'
      ? 'Approved — will be installed as soon as the connection is available.'
      : '')
)
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
function loadShare(reloadChoices = true) {
  if (props.mode === 'share')
    void run(async () => {
      const epoch = generation,
        id = props.connectionId
      if (reloadChoices) {
        const available = await props.ui.choices(id)
        if (!alive || epoch !== generation) return
        choices.value = available
      }
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
    loadShare(false)
  },
  { flush: 'sync' }
)
</script>
<style>
.token-sync-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* What a token opens, or what a change is, as facts: a quiet name and its value. */
.abele-token-dialog__facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--size-2-3) var(--size-4-4);
  margin: var(--size-4-3) 0;
}
.abele-token-dialog__facts dt {
  color: var(--text-muted);
}
.abele-token-dialog__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.abele-token-dialog__note {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-token-dialog__error {
  margin-block: var(--size-2-2) 0;
  color: var(--text-error);
}
.abele-token-dialog__feedback {
  flex-basis: 100%;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: var(--font-ui-small);
}
.abele-token-dialog__copy {
  display: flex;
  justify-content: flex-end;
  margin-block: var(--size-4-2);
}
.abele-token-dialog__revoked .setting-item-name {
  color: var(--text-muted);
}
</style>
