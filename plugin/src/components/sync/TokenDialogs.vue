<template>
  <Modal
    :title="title"
    :size="mode === 'share' || mode === 'review' ? 'tall' : 'default'"
    phone-sheet
    @close="close"
  >
    <Section v-if="mode === 'connect'" :desc="t('streamC.2e58131cb01ed881')">
      <Setting :name="t('settings.nodes.token')" :error="error"
        ><Input
          v-model="text"
          password
          :disabled="busy"
          :placeholder="t('streamC.9547fcece571e82f')"
      /></Setting>
      <TokenQrReader @token="text = $event" />
      <dl v-if="preview" class="abele-token-dialog__facts">
        <dt>{{ t('settings.CalendarsSettings.server.aef7de28') }}</dt>
        <dd>{{ preview.address }}</dd>
        <dt>{{ t('streamC.21a71f3e3356eeab') }}</dt>
        <dd v-if="setPreview">
          <ul class="abele-token-dialog__items">
            <li v-for="item in setPreview.items" :key="item.id">
              <Icon :icon="itemGlyph(item)" no-hover class="abele-token-dialog__glyph" />
              <span>{{ itemName(item) }}</span>
              <span v-if="itemPlace(item)" class="abele-token-dialog__place">{{
                itemPlace(item)
              }}</span>
            </li>
          </ul>
        </dd>
        <dd v-else>{{ scopeName(preview.scope) }}</dd>
        <template v-if="setPreview?.readOnly">
          <dt>Access</dt>
          <dd>Read only</dd>
        </template>
      </dl>
    </Section>
    <template v-if="mode === 'share'">
      <Section :desc="t('streamC.18e1ba7b6b08a056')">
        <Setting :name="t('streamC.75e8080c928c1d79')" :desc="t('streamC.4f546baa0b432a61')">
          <Dropdown
            v-model="selected"
            :options="
              choices.map((one, index) => ({ value: String(index), display: scopeName(one) }))
            "
          />
        </Setting>
        <Setting :name="t('settings.nodes.name')" :desc="t('streamC.2553f3da6a705c57')"
          ><Input v-model="label" maxlength="200" :placeholder="t('streamC.34ad7d66b1a4b1ef')"
        /></Setting>
        <Setting :name="t('settings.nodes.token')">
          <Button
            :text="t('streamC.5d8e8e30bc4fbc87')"
            :tooltip="t('streamC.5cf659b0e45e893c')"
            :disabled="busy || !label.trim() || !choices.length"
            @click="run(issue)"
          />
        </Setting>
      </Section>
      <Section
        v-if="issued"
        :title="t('streamC.fe46cb83ad1c5a35')"
        :desc="t('streamC.aab0bee045763bd8')"
      >
        <Input :model-value="issued" as-text-area :rows="3" readonly />
        <div class="abele-token-dialog__copy">
          <Button
            :text="t('streamC.e21f935f11d7e966')"
            :tooltip="t('streamC.09eb0cfa5a45f63f')"
            @click="run(copy)"
          />
        </div>
        <QrCode :text="issued" :label="t('streamC.5a883d955eddb4da')" />
      </Section>
      <Section :title="t('streamC.0ec2dd7b5c4d86d6')" :desc="t('streamC.58014ca6d004dc0f')">
        <EmptyState v-if="!tokens.length" :text="t('streamC.6b86c5e7ac571a2a')" />
        <Setting
          v-for="one in tokens"
          :key="one.id"
          :name="one.label || scopeName(one.scope)"
          :class="{ 'abele-token-dialog__revoked': one.revoked_at }"
          :desc="
            scopeName(one.scope) +
            ' · ' +
            (one.revoked_at ? t('streamC.f6f738d043929f59') : t('streamC.92340695899bd2d8'))
          "
        >
          <Icon
            v-if="!one.revoked_at"
            icon="ban"
            :tooltip="t('streamC.53c4b05f61d0a6b2')"
            :disabled="busy"
            @click="revoking = one"
          />
        </Setting>
        <Setting
          v-if="revoking"
          :name="t('streamC.b026069ed9186c11', { v1: revoking.label })"
          :desc="t('streamC.0ca72481ed46c6ca')"
        >
          <Button
            :text="t('streamC.68cfc92d64dfda70')"
            :tooltip="t('streamC.2dd446cf82afaa6b')"
            @click="revoking = null"
          />
          <Button
            :text="t('streamC.87e6d00bbf53ec5a')"
            warning
            :tooltip="t('streamC.a36c2a6b36af625f')"
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
        <dt>{{ t('settings.SecretStoreSettings.change.c0bf75bd') }}</dt>
        <dd>
          {{
            operationName(candidate.operation) +
            (candidate.previousPath
              ? t('streamC.049da0363ec74d10', { v1: candidate.previousPath })
              : '')
          }}
        </dd>
        <dt>{{ t('streamC.49f19beeecf442ef') }}</dt>
        <dd>{{ time(candidate.receivedAt) }}</dd>
        <dt>{{ t('streamC.7bb841888f37b767') }}</dt>
        <dd>{{ time(candidate.mtime) }}</dd>
      </dl>
      <p class="abele-token-dialog__note">{{ t('streamC.ac82ccf623b72261') }}</p>
      <pre v-if="candidate.bytes !== null" class="token-sync-content">{{ content }}</pre>
      <p v-else>
        {{
          candidate.operation === 'delete'
            ? t('streamC.56f40ae966c6cdc7')
            : t('streamC.52ec1d3b453da3da')
        }}
      </p>
    </Section>
    <Section
      v-if="mode === 'attachment' && question"
      :title="question.path"
      :desc="question.source.address + ' · ' + scopeName(question.source.scope)"
    >
      <p>{{ t('streamC.55f8aec9fbec672b') }}</p>
      <p class="abele-token-dialog__note">{{ t('streamC.0b3e19b37058fc55') }}</p>
    </Section>
    <Section
      v-if="mode === 'disconnect'"
      :desc="scopeName(connection?.scope ?? null) + ' · ' + connection?.address"
    >
      <p>{{ t('streamC.f578c1693841cb3f') }}</p>
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
      <Button
        :text="t('sync.window.close')"
        :tooltip="t('streamC.87730ff5b531b7c7')"
        @click="close"
      />
      <Button
        v-if="mode === 'connect'"
        :text="t('streamC.1a2303ede07493ac')"
        :tooltip="t('streamC.3a588cb1a419d7f2')"
        :disabled="busy || !text.trim()"
        accent
        @click="run(connect)"
      />
      <Button
        v-if="mode === 'review'"
        :text="t('streamC.ab604a360777735f')"
        :tooltip="t('streamC.2c4bf7880df41108')"
        :disabled="busy || !!approval"
        @click="run(reject)"
      />
      <Button
        v-if="mode === 'review'"
        :text="busy ? t('streamC.approving') : t('streamC.6007acbe30b2cd98')"
        :tooltip="t('streamC.23581c5816d9589d')"
        :disabled="busy || !!approval"
        accent
        @click="run(approve)"
      />
      <Button
        v-if="mode === 'attachment'"
        :text="t('streamC.05a2d7332eb9d8bf')"
        :tooltip="t('streamC.a7b9c44db806f25e')"
        :disabled="busy"
        @click="run(() => decide(false))"
      />
      <Button
        v-if="mode === 'attachment'"
        :text="t('streamC.e213c161d5cefa52')"
        accent
        :tooltip="t('streamC.45803c8cb918898d')"
        :disabled="busy"
        @click="run(() => decide(true))"
      />
      <Button
        v-if="mode === 'disconnect'"
        :text="t('streamC.acfc5be785a9bb3d')"
        warning
        :tooltip="t('streamC.79e5f15548ed9c51')"
        :disabled="busy"
        @click="run(disconnect)"
      />
    </template>
  </Modal>
</template>
<script setup lang="ts">
import { settingsSyncText } from '@/i18n/settingsSync'
const scopeName = (scope: Parameters<typeof scopeSource>[0]) => scopeSource(scope, settingsSyncText)
import { t, currentLocale } from '@/i18n'

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
import { connectionError, scopeName as scopeSource, type TokenUi } from '@/sync/tokenUi'
import type { ExecutableCandidate } from '@/sync/executableReview'
import type { AttachmentQuestion } from '@/sync/attachmentConsent'
import type { V2Scope, V2TokenInfo } from '@/sync/v2/contract'
import { decodeAccessToken, tokenScope } from '@/sync/v2/client'
import { itemGlyph, itemName, itemPlace, shareSetSource, type SharePreview } from '@/sync/shareSets'
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
      connect: t('streamC.232ac7de45dec163'),
      share: t('streamC.4231d8099b0bf71a'),
      review: t('streamC.8a279c860c0d8c5a'),
      attachment: t('streamC.a01d1d4a402368c3'),
      disconnect: t('streamC.112cbf2ce097cdb9'),
    })[props.mode]
)
const content = computed(() =>
  new TextDecoder().decode(new Uint8Array(props.candidate?.bytes ?? []))
)
const preview = computed(() => {
  try {
    const token = decodeAccessToken(text.value)
    return { ...token, scope: tokenScope(token) }
  } catch {
    return null
  }
})
const resolvedPreview = ref<SharePreview | null>(null)
const setPreview = computed(() =>
  preview.value
    ? (resolvedPreview.value ?? shareSetSource.value?.preview(text.value) ?? null)
    : null
)
watch(text, async (value, _, cleanup) => {
  resolvedPreview.value = null
  const source = shareSetSource.value
  if (!source?.resolvePreview) return
  try {
    if (decodeAccessToken(value).v !== 2) return
  } catch {
    return
  }
  const controller = new AbortController()
  cleanup(() => controller.abort())
  try {
    const current = await source.resolvePreview(value, controller.signal)
    if (alive && !controller.signal.aborted) resolvedPreview.value = current
  } catch {
    /* Connect still checks authority and reports an actionable error. */
  }
})
const time = (value: number) =>
  new Date(value).toLocaleString(
    currentLocale().language === 'en' ? undefined : currentLocale().format
  )
const operationName = (value: string) =>
  (
    ({
      create: t('streamC.44dedd0f97fea3c8'),
      modify: t('streamC.a9fde979c3f67b7a'),
      move: t('streamC.efb6e4a587713996'),
      delete: t('streamC.5b6181a9afd23242'),
    }) as Record<string, string>
  )[value] ?? t('streamC.a9fde979c3f67b7a')
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
  new Notice(t('streamC.1e965e25daad8d30'))
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
  new Notice(t('streamC.c9feac7acc32ee92'))
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
  if (props.candidate) await props.ui.approve(props.candidate, { background: true })
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
.abele-token-dialog__items {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.abele-token-dialog__items li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--size-4-2);
}
.abele-token-dialog__glyph {
  --icon-size: var(--icon-s);
  color: var(--text-muted);
}
.abele-token-dialog__place {
  color: var(--text-faint);
  font-size: var(--font-ui-small);
}
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
