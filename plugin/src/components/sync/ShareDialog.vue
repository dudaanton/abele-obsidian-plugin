<template>
  <Modal title="Share access" size="tall" phone-sheet @close="emit('close')">
    <Section
      desc="Give someone folders, groups and single notes with one token, or connect another device of yours to the whole vault. What a token opens can change later."
    >
      <!-- The set is long and wraps: its field under its words, the dialog's full width. -->
      <div class="abele-share-dialog__field">
        <div class="setting-item-name">What to share</div>
        <div class="setting-item-description">The whole vault is for your own devices.</div>
        <SharePicker
          v-model="picked"
          :choices="choices"
          :disabled="busy"
          placeholder="Add a folder, group or file…"
        />
      </div>
      <Setting name="Read only" desc="They get every change but cannot change anything.">
        <Checkbox :is-enabled="readOnly" @toggle="readOnly = !readOnly" />
      </Setting>
      <Setting name="Name" desc="Who or what it is for, to know it later."
        ><Input v-model="label" maxlength="200" placeholder="A second device, a colleague"
      /></Setting>
      <Setting name="Token">
        <Button
          text="Create token"
          tooltip="Create one token for everything chosen above"
          :disabled="busy || !label.trim() || !picked.length"
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
      desc="Open one to add to it, take something out or revoke it. What the other side has stays with them."
    >
      <EmptyState v-if="!shares.length" text="No tokens given yet." />
      <Setting
        v-for="one in shares"
        :key="one.id"
        :name="one.label || setTitle(one.items)"
        :desc="summary(one)"
        role="button"
        tabindex="0"
        class="abele-sync-row"
        :class="{ 'abele-token-dialog__revoked': one.revokedAt }"
        @click="opened = one.id"
        @keydown.enter.self="opened = one.id"
      >
        <span class="abele-share-dialog__glyphs" :aria-label="kinds(one)">
          <Icon
            v-for="glyph in glyphs(one)"
            :key="glyph"
            :icon="glyph"
            no-hover
            class="abele-share-dialog__glyph"
          />
        </span>
      </Setting>
    </Section>
    <p v-if="error" class="abele-token-dialog__error" role="alert">{{ error }}</p>
    <template #footer>
      <Button text="Close" tooltip="Close this window" @click="emit('close')" />
    </template>
  </Modal>
  <ShareDetail
    v-if="openedShare"
    :key="openedShare.id"
    :share="openedShare"
    :choices="choices"
    :add="(items) => source.add(connectionId, openedShare!.id, items).then(reload)"
    :remove="(item) => source.remove(connectionId, openedShare!.id, item.id).then(reload)"
    :revoke="() => source.revoke(connectionId, openedShare!.id).then(reload)"
    @close="opened = null"
    @delete="(item) => (deleting = { item: item?.id ?? null })"
  />
  <ServerDeleteModal
    v-if="deleting && openedShare && deleteFacts"
    :key="'d' + (deleting.item ?? 'all')"
    :name="deleteName"
    :host="host"
    :facts="deleteFacts"
    :choices="deleteChoices"
    :choice="deleting.item ?? ALL"
    :note="deleteNote"
    :remove="() => source.deleteFromServer(openedShare!.id, deleting!.item).then(reload)"
    @choose="(value) => (deleting = { item: value === ALL ? null : value })"
    @close="deleting = null"
    @done="deleting = null"
  />
</template>

<script setup lang="ts">
/**
 * Share access, where the server keeps sets: several folders, groups and files in one token,
 * read only or not, and the tokens given as rows; each opens its own window to add to it, take
 * an item out, delete one from the server or revoke it.
 */
import { computed, onMounted, ref } from 'vue'
import { Notice } from 'obsidian'
import Modal from '../obsidian/Modal.vue'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Icon from '../obsidian/Icon.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import QrCode from '../obsidian/QrCode.vue'
import SharePicker from './SharePicker.vue'
import ShareDetail from './ShareDetail.vue'
import ServerDeleteModal from './ServerDeleteModal.vue'
import { connectionError } from '@/sync/tokenUi'
import {
  itemGlyph,
  itemLabel,
  setTitle,
  type IssuedShare,
  type ShareItem,
  type ShareSetSource,
} from '@/sync/shareSets'

const props = defineProps<{ source: ShareSetSource; connectionId?: string; host: string }>()
const emit = defineEmits<{ close: [] }>()

const ALL = '*'
const picked = ref<ShareItem[]>([])
const readOnly = ref(false)
const label = ref('')
const issued = ref('')
const busy = ref(false)
const error = ref('')
const shares = ref<IssuedShare[]>([])
const opened = ref<string | null>(null)
const deleting = ref<{ item: string | null } | null>(null)

const choices = computed(() => props.source.choices(props.connectionId))
const openedShare = computed(() => shares.value.find((one) => one.id === opened.value) ?? null)

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const summary = (one: IssuedShare) =>
  [
    count(one.items.length, 'item', 'items'),
    one.readOnly ? 'Read only' : '',
    one.revokedAt ? 'Revoked' : 'Active',
  ]
    .filter(Boolean)
    .join(' · ')
/** The kinds a share holds, as glyphs at the row's end, each once. */
const glyphs = (one: IssuedShare) => [...new Set(one.items.map(itemGlyph))]
const kinds = (one: IssuedShare) => one.items.map(itemLabel).join(', ')

const deleteFacts = computed(() =>
  deleting.value && openedShare.value
    ? props.source.deleteFacts(openedShare.value.id, deleting.value.item)
    : null
)
const deleteChoices = computed(() =>
  openedShare.value
    ? [
        ...openedShare.value.items.map((one) => ({
          value: one.id,
          label: 'Only ' + itemLabel(one),
        })),
        {
          value: ALL,
          label: `The whole share, ${count(openedShare.value.items.length, 'item', 'items')}`,
        },
      ]
    : []
)
const deleteNote = computed(() => {
  const who = openedShare.value?.label || 'They'
  return deleting.value?.item
    ? `The files stay in the server's trash for 30 days. ${who} stops getting it and keeps their copy. This device keeps every file.`
    : `The files stay in the server's trash for 30 days and the token is revoked. ${who} keeps their copy. This device keeps every file.`
})
const deleteName = computed(() => {
  const item = openedShare.value?.items.find((one) => one.id === deleting.value?.item)
  return item ? `“${itemLabel(item).split(': ')[1]}”` : `“${openedShare.value?.label}”`
})

async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = connectionError(cause)
  } finally {
    busy.value = false
  }
}
async function reload() {
  shares.value = await props.source.shares(props.connectionId)
}
async function issue() {
  issued.value = await props.source.issue(props.connectionId, {
    items: picked.value,
    label: label.value.trim(),
    readOnly: readOnly.value,
  })
  await reload()
}
async function copy() {
  await navigator.clipboard.writeText(issued.value)
  new Notice('Token copied')
}
onMounted(() => void run(reload))
defineExpose({ open: (id: string) => (opened.value = id) })
</script>

<style lang="scss">
.abele-share-dialog__field {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  padding-block: var(--size-4-3);

  .abele-share-picker {
    margin-top: var(--size-4-1);
  }
}
.abele-share-dialog__glyphs {
  display: flex;
  gap: var(--size-4-1);
  color: var(--text-muted);
}
.abele-share-dialog__glyph {
  --icon-size: var(--icon-s);
}
</style>
