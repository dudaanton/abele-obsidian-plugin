<template>
  <ObsidianModal :title="title" phone-sheet @close="emit('close')">
    <div class="abele-join-vault">
      <p class="abele-join-vault__lead">{{ lead }}</p>

      <template v-if="question.kind === 'choose'">
        <p class="abele-join-vault__counts">{{ counts }}</p>
        <p v-if="onlySettings" class="abele-join-vault__counts">
          This vault holds only Obsidian's own settings, as a vault just made does, so the server's
          are chosen: kept as the newer copies, this vault's defaults would replace the settings of
          every device.
        </p>
        <p class="abele-join-vault__lead">
          Where both have a file with different contents, which one should be kept?
        </p>

        <CardGrid stack>
          <Card
            v-for="option in OPTIONS"
            :key="option.title"
            :title="option.title"
            :description="option.description"
            clickable
            :selected="chosen === option.prefer"
            @click="chosen = option.prefer"
          />
        </CardGrid>
      </template>

      <Setting
        v-if="deviceName !== undefined"
        name="This device's name"
        desc="What the vault's device list will call this device."
      >
        <Input :model-value="name" :disabled="busy" @update:model-value="name = $event" />
      </Setting>

      <!--
        A device this one left while offline is told first, for up to ten seconds; said here so
        the wait does not read as a hang.
      -->
      <p v-if="hint" class="abele-join-vault__counts">{{ hint }}</p>
      <p v-if="error" class="abele-join-vault__error">{{ error }}</p>

      <div class="abele-join-vault__actions abele-modal__actions">
        <Button
          text="Cancel"
          :disabled="busy"
          tooltip="Close this; nothing is connected and no file is touched"
          @click="emit('close')"
        />
        <Button
          text="Connect"
          accent
          :disabled="busy || !named"
          :tooltip="named ? connectTooltip : 'Name this device first'"
          @click="connect"
        />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * What a device is asked before it syncs a vault (phase 3b, decision 7).
 *
 * The question is decided before this opens (`join.ts`), from how many files each side holds:
 * - files on both sides — which side is kept where both have a file with other contents, with
 *   "merge both" already chosen, since it is the one that replaces nothing;
 * - files on one side — a confirmation that says which way they go;
 * - a vault this device already synced to the end — it picks up where it left off.
 *
 * Every side keeps the version that loses in the file's history, and each choice says so: what
 * a person is deciding is which copy is the one in front of them, not which is thrown away.
 *
 * The device name is asked here, for a sign-in, because this is the moment it is enrolled under
 * it; a device a transfer brought already has one, and is shown no field.
 */
import { computed, ref } from 'vue'
import type { JoinPrefer } from '@abele/sync-protocol'
import ObsidianModal from '../../obsidian/Modal.vue'
import Button from '../../obsidian/Button.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Input from '../../obsidian/Input.vue'
import Setting from '../../obsidian/Setting.vue'
import type { FileCount, JoinQuestion } from '@/sync/join'

const props = defineProps<{
  question: JoinQuestion
  /** What the name field starts with; undefined for a device that has a name already. */
  deviceName?: string
  busy: boolean
  error: string | null
  /** What the connect is waiting on, while it waits. */
  hint?: string | null
}>()

const emit = defineEmits<{
  /**
   * Connect: `prefer` is the side chosen — `mine`, `theirs`, or null for merge both — and
   * undefined when there was no side to choose.
   */
  (e: 'connect', answer: { prefer: JoinPrefer | null | undefined; deviceName: string }): void
  (e: 'close'): void
}>()

const KEPT = 'The version that loses is kept in Version history.'

const OPTIONS: { title: string; description: string; prefer: JoinPrefer | null }[] = [
  {
    title: 'Merge both',
    description:
      'Files on both sides are combined. A note changed on both keeps both texts; for other ' +
      `files the newer one wins. Nothing is deleted. ${KEPT}`,
    prefer: null,
  },
  {
    title: 'This device wins',
    description: `Where both have a file, this device's version is kept everywhere. ${KEPT}`,
    prefer: 'mine',
  },
  {
    title: 'The server wins',
    description: `Where both have a file, the server's version is kept here. ${KEPT}`,
    prefer: 'theirs',
  },
]

/**
 * Whether every file here is one of Obsidian's settings, as in a vault just made: its
 * defaults are the newest files there are, so under "merge both" they would win, and every
 * device would take them (task-8 review, #3; a ruling). The server's side is chosen instead.
 */
const onlySettings = computed(
  () => props.question.here.files > 0 && props.question.here.files === props.question.here.settings
)

const chosen = ref<JoinPrefer | null>(onlySettings.value ? 'theirs' : null)
const name = ref(props.deviceName ?? '')
const named = computed(() => props.deviceName === undefined || name.value.trim() !== '')

const vault = computed(() => props.question.vaultName)

const title = computed(() => {
  if (props.question.kind === 'choose') return `Sync this vault with ${vault.value}?`
  if (props.question.kind === 'reconnect') return `Reconnect to ${vault.value}?`
  return `Connect this vault to ${vault.value}?`
})

/** `3 files`, `1 file`, with how many are Obsidian's settings when any are. */
function files(count: FileCount): string {
  const total = `${count.files} ${count.files === 1 ? 'file' : 'files'}`
  return count.settings === 0 ? total : `${total}, ${count.settings} of them Obsidian settings`
}

const counts = computed(() => {
  const { here, there } = props.question
  // The whole vault: the server's count knows nothing of what this device leaves out.
  const server = there === null ? 'could not be counted' : `${files(there)} in all`
  return `Here: ${files(here)} · On the server: ${server}`
})

const lead = computed(() => {
  const { kind, here, there } = props.question
  if (kind === 'choose') return `This vault and ${vault.value} both hold files.`
  if (kind === 'upload') return `Its ${files(here)} will be uploaded.`
  if (kind === 'download') {
    return there === null
      ? "The server's files will be downloaded."
      : `The server holds ${files(there)} in all; what this device takes of them will be downloaded.`
  }
  if (kind === 'reconnect') return 'This device picks up where it left off.'
  return 'Neither this vault nor the server holds any files yet.'
})

const connectTooltip = computed(() =>
  props.question.kind === 'choose'
    ? `Start syncing with ${vault.value}, keeping the side chosen above`
    : `Start syncing with ${vault.value}`
)

function connect(): void {
  if (props.busy || !named.value) return
  emit('connect', {
    prefer: props.question.kind === 'choose' ? chosen.value : undefined,
    deviceName: name.value.trim(),
  })
}
</script>

<style lang="scss">
.abele-join-vault {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}

.abele-join-vault__lead,
.abele-join-vault__counts,
.abele-join-vault__error {
  margin: 0;
  overflow-wrap: anywhere;
}

.abele-join-vault__counts {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-join-vault__error {
  color: var(--text-error);
}

.abele-join-vault__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--size-4-2);
}
</style>
