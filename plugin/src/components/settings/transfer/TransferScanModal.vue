<template>
  <ObsidianModal title="Read a transfer" size="wide" @close="onClose">
    <div ref="root" class="abele-transfer-scan">
      <template v-if="phase === 'collect'">
        <video v-show="cameraOn" ref="video" class="abele-transfer-scan__view" playsinline muted />

        <div v-if="!cameraOn" class="abele-transfer-scan__sources">
          <Button
            text="Use the camera"
            accent
            tooltip="Point the camera at the codes on the other device"
            @click="startCamera"
          />
          <Button
            text="Take a photo"
            tooltip="Photograph the code, or pick a picture of one"
            @click="pickPhoto"
          />
          <Button
            text="Open a file"
            tooltip="Read a transfer saved as a file on the other device"
            @click="pickFile"
          />
          <Button
            text="Paste the text"
            tooltip="Paste the transfer as text instead of reading a code"
            @click="pasting = !pasting"
          />
        </div>

        <Input
          v-if="pasting"
          as-text-area
          :model-value="pasted"
          placeholder="ABL1:…"
          @update:model-value="onPasted"
        />

        <p v-if="error" class="abele-transfer-scan__error">{{ error }}</p>

        <div v-if="progress.total" class="abele-transfer-scan__progress">
          {{ progress.received }} / {{ progress.total }} codes read
          <span v-if="progress.missing.length" class="abele-transfer-scan__missing">
            still to find: {{ progress.missing.join(', ') }}
          </span>
        </div>
        <p v-else class="abele-transfer-scan__hint">
          Nothing read yet. The other device shows the codes; this one collects them in any order.
        </p>
      </template>

      <template v-else-if="phase === 'code'">
        <p class="abele-transfer-scan__hint">
          This transfer carries a key, so it is locked. Type the code shown on the other device.
        </p>
        <Input :model-value="code" placeholder="8 characters" @update:model-value="code = $event" />
        <p v-if="error" class="abele-transfer-scan__error">{{ error }}</p>
        <Button text="Unlock" accent tooltip="Open the transfer with this code" @click="unlock" />
      </template>

      <template v-else>
        <p class="abele-transfer-scan__hint">Made {{ madeAt }}. Tick what to keep.</p>

        <Setting name="What to do with what is already here" :desc="modeNote">
          <Dropdown
            :model-value="mode"
            :options="[
              { value: 'merge', display: 'Keep it, and add these' },
              { value: 'replace', display: 'Replace it with these' },
            ]"
            @update:model-value="mode = $event as ApplyMode"
          />
        </Setting>

        <div
          v-for="item in planned"
          :key="`${item.entry.section}:${item.entry.id}`"
          class="abele-transfer-scan__entry"
          role="button"
          tabindex="0"
          @click="toggle(item)"
          @keydown.enter="toggle(item)"
          @keydown.space.prevent="toggle(item)"
        >
          <Checkbox :is-enabled="accepted.has(id(item))" @toggle="toggle(item)" />
          <div class="abele-transfer-scan__entry-content">
            <span class="abele-transfer-scan__entry-name">{{
              isConnection(item) ? connectionTitle(item.entry) : item.entry.label
            }}</span>
            <span
              v-if="isConnection(item) && connectionNote"
              class="abele-transfer-scan__entry-note"
              >{{ connectionNote }}</span
            >
          </div>
          <div class="abele-transfer-scan__entry-details">
            <span class="abele-transfer-scan__entry-section">{{ label(item.entry.section) }}</span>
            <Badge :text="statusWord(item.status)" />
          </div>
        </div>

        <Setting :name="acceptedSummary" :desc="keysSummary">
          <Button
            text="Apply"
            accent
            :disabled="!accepted.size || busy || done"
            :tooltip="applyTooltip"
            @click="apply"
          />
        </Setting>
      </template>

      <ConfirmModal
        v-if="switching"
        title="Switch this device to another vault?"
        :message="switchMessage"
        confirm-text="Switch"
        confirm-tooltip="Disconnect from the vault this device syncs now, and take the one that arrived"
        cancel-tooltip="Apply the rest of the transfer and keep syncing what this device syncs now"
        @confirm="switchConfirmed = true"
        @close="closeSwitch"
      />
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import Button from '../../obsidian/Button.vue'
import Input from '../../obsidian/Input.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Badge from '../../obsidian/Badge.vue'
import Setting from '../../obsidian/Setting.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { SyncService } from '@/sync/SyncService'
import {
  CONNECTION_SECTION,
  CONNECTION_TOKEN,
  connectionTitle,
  matchConnection,
  isOwnTransferred,
  readTransferred,
} from '@/transfer/connection'
import { GlobalStore } from '@/stores/GlobalStore'
import { createReceiver } from '@/transfer/frames'
import { decodePayload, isEncrypted } from '@/transfer/payload'
import {
  applyEntries,
  arrivingSecretIds,
  removedByReplace,
  filesOnly,
  planEntries,
  sectionLabel,
  settingsOnly,
  type ApplyMode,
  type PlannedEntry,
} from '@/transfer/entries'
import { applyFiles, planFiles, readCurrent } from '@/transfer/files'
import { storeReceivedKeys } from '@/transfer/receivedKeys'
import { readCodes, readableSize, closerLooks, type Rect } from '@/transfer/scan'
import type { SectionId, TransferPayload } from '@/transfer/types'

/** What was written, and what the keychain would not take — the parent says so out loud. */
export interface Applied {
  items: number
  keysRefused: number
  /** Files the vault would not take — a path it refuses, or a folder it cannot make. */
  filesRefused: number
  /** What became of the sync connection, when one arrived: a line to say, or nothing. */
  connection?: string
}

const emit = defineEmits<{ (e: 'close'): void; (e: 'applied', result: Applied): void }>()

const root = useTemplateRef<HTMLElement>('root')
const video = useTemplateRef<HTMLVideoElement>('video')

/** Settings can open in a window of their own, and its timers and pickers are that window's. */
const win = () => root.value?.win ?? window

const phase = ref<'collect' | 'code' | 'review'>('collect')
const error = ref('')
const pasting = ref(false)
const pasted = ref('')
const code = ref('')
const cameraOn = ref(false)

/**
 * The receiver collects frames in place, which Vue cannot see, so what the screen shows is
 * mirrored out of it after every frame rather than the receiver itself being made reactive.
 */
let receiver = createReceiver()
const progress = ref({ received: 0, total: 0, missing: [] as number[] })

const sync = () => {
  progress.value = {
    received: receiver.received,
    total: receiver.total,
    missing: receiver.missing,
  }
}
const blob = ref<Uint8Array | null>(null)
const payload = ref<TransferPayload | null>(null)

/** What this vault holds today for the files about to arrive, for telling new from changed. */
const current = ref(new Map<string, string>())

const scriptsFolder = () => AbeleConfig.getInstance().ai.scriptsFolder || ''

const label = (section: SectionId) => sectionLabel(section)

const statusWord = (status: PlannedEntry['status']) =>
  status === 'new' ? 'new' : status === 'replace' ? 'replaces' : 'unchanged'

/** A frame from anywhere: the camera, a photo, a file, or pasted text. */
const take = async (text: string) => {
  if (!receiver.accept(text)) return false
  sync()
  if (!receiver.done) return true

  blob.value = receiver.assemble()
  stopCamera()
  await open()
  return true
}

const open = async () => {
  if (!blob.value) return

  if (isEncrypted(blob.value)) {
    phase.value = 'code'
    return
  }

  const result = await decodePayload(blob.value)
  if (!result.ok) {
    error.value = 'That transfer did not arrive whole. Read the codes again.'
    reset()
    return
  }

  await accept(result.payload)
}

/** Everything a decoded payload needs before the review can be drawn. */
const accept = async (opened: TransferPayload) => {
  current.value = await readCurrent(
    GlobalStore.getInstance().app,
    filesOnly(opened.entries),
    scriptsFolder()
  )
  payload.value = opened
  accepted.value = new Set(planned.value.filter(tickedAtFirst).map((item) => id(item)))
  phase.value = 'review'
}

const unlock = async () => {
  if (!blob.value) return

  const result = await decodePayload(blob.value, code.value.trim().toUpperCase())
  if (!result.ok) {
    error.value =
      result.reason === 'bad-code'
        ? 'That code does not open this transfer.'
        : 'That transfer did not arrive whole. Read the codes again.'
    return
  }

  error.value = ''
  await accept(result.payload)
}

const reset = () => {
  receiver = createReceiver()
  sync()
  blob.value = null
  phase.value = 'collect'
}

const settings = () => AbeleConfig.getInstance().exportSettings()

/* ------------------------------------------------------------------ the sync connection */

const syncService = SyncService.getInstance()

/** The connection a transfer carries, read the way a receiver may take it (`connection.ts`). */
const arrived = computed(() => {
  const entry = payload.value?.entries.find((item) => item.section === CONNECTION_SECTION)
  return entry ? readTransferred(entry, payload.value?.secrets ?? {}) : null
})

/**
 * How it stands to this device: `kept` when only what the sender syncs came — no device for this
 * side — and this device syncs something of its own already.
 */
const standing = computed<'none' | 'same' | 'other' | 'kept' | null>(() => {
  const got = arrived.value
  if (got === null) return null
  if (got.connection !== null) return matchConnection(syncService.connection.value, got.connection)
  const own = syncService.connection.value
  return own.serverUrl === '' && own.vaultId === '' ? 'none' : 'kept'
})

const isConnection = (item: PlannedEntry) => item.entry.section === CONNECTION_SECTION

/** Nothing to choose: the device already syncs that vault, or keeps its own choices. */
const fixed = (item: PlannedEntry) =>
  isConnection(item) && (standing.value === 'same' || standing.value === 'kept')

const connectionNote = computed(() => {
  if (standing.value === 'same') return 'Already connected to this vault'
  if (standing.value === 'other') return "Replaces this device's own connection"
  if (standing.value === 'kept') return 'This device keeps what it syncs'
  if (arrived.value?.connection === null) return 'What to sync only; sign in on the Sync tab'
  return ''
})

const switching = ref(false)
const switchConfirmed = ref(false)

const switchMessage = computed(() => {
  const own = syncService.connection.value
  const here = own.vaultName || own.vaultId
  const there = arrived.value?.connection
  const name = there ? there.vaultName || there.vaultId : ''
  return (
    `This device syncs ${here} on ${own.serverUrl}. Switch it to ${name}? It will be ` +
    `disconnected from ${here}, and the server there will be told. Next you will choose how ` +
    `this vault's files are joined with ${name}.`
  )
})

const planned = computed<PlannedEntry[]>(() => {
  const entries = payload.value?.entries
  if (!entries) return []

  return [
    ...planEntries(entries, settings()).map((item) => {
      if (!isConnection(item)) return item
      const status =
        standing.value === 'other' ? 'replace' : standing.value === 'none' ? 'new' : 'same'
      return { ...item, status } as PlannedEntry
    }),
    ...planFiles(filesOnly(entries), current.value, scriptsFolder()),
  ]
})

const id = (item: PlannedEntry) => `${item.entry.section}:${item.entry.id}`

const accepted = ref(new Set<string>())

/**
 * Ticked to start with: everything but a connection that would replace this device's own —
 * that one is the person's to tick — or one there is nothing to do with.
 */
const tickedAtFirst = (item: PlannedEntry) => !isConnection(item) || standing.value === 'none'

const toggle = (item: PlannedEntry) => {
  if (fixed(item)) return
  const next = new Set(accepted.value)
  if (!next.delete(id(item))) next.add(id(item))
  accepted.value = next
}

/**
 * Merging by default, because it is the one that cannot lose anything. Replacing is what you
 * want when this device is meant to end up matching the other one.
 */
const mode = ref<ApplyMode>('merge')

const going = computed(() =>
  payload.value ? removedByReplace(acceptedEntries.value, settings()) : []
)

const modeNote = computed(() => {
  if (mode.value === 'merge')
    return 'Anything here that the transfer does not mention is left alone.'
  if (!going.value.length) return 'Nothing here would be removed: the transfer covers all of it.'

  const names = going.value.map((item) => item.label).join(', ')
  return `${going.value.length === 1 ? 'This will be removed' : 'These will be removed'}: ${names}. Scripts, skills and prompts are never deleted.`
})

const acceptedEntries = computed(() =>
  planned.value.filter((item) => accepted.value.has(id(item))).map((item) => item.entry)
)

const acceptedSummary = computed(() =>
  accepted.value.size === 1 ? '1 item to apply' : `${accepted.value.size} items to apply`
)

/** The connection's token is never stored as a key: it is the service's to file, or revoked. */
const keysCount = computed(
  () => Object.keys(payload.value?.secrets ?? {}).filter((name) => name !== CONNECTION_TOKEN).length
)

const keysSummary = computed(() =>
  keysCount.value
    ? `${keysCount.value === 1 ? 'One key' : `${keysCount.value} keys`} will be stored in this device's keychain.`
    : 'No keys came with this transfer.'
)

const madeAt = computed(() => {
  const at = payload.value?.at
  return at ? new Date(at).toLocaleString() : 'just now'
})

const onPasted = (value: string) => {
  pasted.value = value
  void swallow(value)
}

/**
 * Everything in a piece of text that turns out to be part of this transfer.
 *
 * Split on whitespace rather than on lines, because the text has been through a message by the
 * time it arrives: something along the way may have wrapped it, and a frame that has been
 * wrapped is one the checksum will refuse anyway.
 */
const swallow = async (text: string) => {
  let any = false
  for (const token of text.split(/\s+/)) if (token && (await take(token))) any = true
  return any
}

/**
 * An apply is running — a second press meanwhile would take the connection twice, and by then
 * the transfer may read as "the same vault" and revoke the device just taken — or has run, and
 * nothing is left to apply. Set before anything is awaited.
 */
const busy = ref(false)
const done = ref(false)

const applyTooltip = computed(() => {
  if (done.value) return 'Already applied'
  if (busy.value) return 'Applying…'
  return accepted.value.size
    ? "Write these into this vault's settings"
    : 'Tick something to apply first'
})

/**
 * Taking a connection that replaces this device's own is asked about first; everything else
 * goes at once. The connection is taken last, after the settings and files are written, so a
 * failure to take it costs nothing else.
 */
const apply = async () => {
  if (!payload.value || busy.value || done.value) return
  busy.value = true
  const takingConnection = acceptedEntries.value.some(
    (entry) => entry.section === CONNECTION_SECTION
  )
  if (takingConnection && standing.value === 'other') {
    // Still busy: the question is part of this apply, and its answer finishes it.
    switchConfirmed.value = false
    switching.value = true
    return
  }
  await run(takingConnection)
}

const closeSwitch = () => {
  if (!switching.value) return
  switching.value = false
  void run(switchConfirmed.value)
}

const run = async (takeConnection: boolean) => {
  try {
    await finish(takeConnection)
  } finally {
    busy.value = false
  }
}

/**
 * The device made for this side, when nobody is going to take it: the modal closed without
 * Apply, so nothing was taken whatever the switches said — a device that already syncs that
 * vault, one that syncs another and left the switch to it ticked, or one that syncs nothing.
 * Not while an apply runs, which settles it itself.
 */
const release = () => {
  const got = arrived.value
  if (done.value || busy.value || got === null || got.connection === null) return
  done.value = true
  if (!isOwnTransferred(syncService.connection.value, got.connection)) {
    void syncService.revokeTransferred(got.connection, got.token)
  }
}

const onClose = () => {
  release()
  emit('close')
}

/**
 * The connection's part of an apply. A device made for this side that is not taken — the vault
 * is already synced here, or the person chose not to — is revoked, so the server keeps no device
 * nobody holds. Only what the sender syncs, with no device, is a starting point for a device that
 * syncs nothing yet.
 *
 * `stand` is how the transfer stood when the apply began: the adopt saves a connection, and read
 * again after it the transfer would stand as "the same vault".
 */
const applyConnection = async (
  take: boolean,
  stand: typeof standing.value
): Promise<string | undefined> => {
  const got = arrived.value
  if (got === null) return undefined
  if (got.connection === null) {
    if (!take || stand !== 'none') return undefined
    const own = syncService.connection.value
    await syncService.updateConnection({
      selective: { ...got.selective, maxFileBytes: own.selective.maxFileBytes },
    })
    return 'What to sync is set; sign in on the Sync tab to start.'
  }
  if (take && (stand === 'none' || stand === 'other')) {
    const before = syncService.connection.value
    const left = before.vaultName || before.vaultId
    try {
      await syncService.adoptTransferred(got.connection, got.token, got.selective)
      const name = got.connection.vaultName || got.connection.vaultId
      // Taken with the join question open: which side wins is asked on the Sync tab.
      if (syncService.connection.value.join?.ask === true) {
        return (
          `This device is connected to ${name}. Choose how this vault's files are joined with ` +
          'it on the Sync tab; nothing syncs until then.'
        )
      }
      return `This device now syncs ${name}.`
    } catch (error) {
      void syncService.revokeTransferred(got.connection, got.token)
      const reason = error instanceof Error ? error.message : String(error)
      // The switch disconnects first: a failure after that leaves this device syncing nothing.
      const now = syncService.connection.value
      if (stand === 'other' && now.vaultId === '' && now.serverUrl === '') {
        return (
          `This device was disconnected from ${left}, and the sync connection that arrived was ` +
          `not taken: ${reason}. Sign in on the Sync tab.`
        )
      }
      return `The sync connection was not taken: ${reason}`
    }
  }
  if (!isOwnTransferred(syncService.connection.value, got.connection)) {
    void syncService.revokeTransferred(got.connection, got.token)
  }
  return undefined
}

const finish = async (takeConnection: boolean) => {
  if (!payload.value) return
  const stand = standing.value

  const chosen = acceptedEntries.value.filter((entry) => entry.section !== CONNECTION_SECTION)
  const config = AbeleConfig.getInstance()
  let incomingKeyIds: string[]
  try {
    const next = applyEntries(chosen, config.exportSettings(), mode.value)
    // Resolve once from the same normalized settings that will actually be committed.
    incomingKeyIds = arrivingSecretIds(chosen, next)
    config.applySettings(next)
  } catch (e) {
    // Connection/credential binding is validated before any keychain or settings write.
    error.value = e instanceof Error ? e.message : 'These settings could not be applied.'
    return
  }
  // Taken in here, by hand: it arms this device even if it was once switched off on it.
  const scriptSettings = chosen.find((entry) => entry.section === 'scripts')?.data as
    | { confirmForeignScripts?: boolean }
    | undefined
  if (scriptSettings?.confirmForeignScripts) {
    ScriptService.getInstance().setConfirmForeign(true)
  }

  const keysRefused = storeReceivedKeys(chosen, payload.value.secrets, incomingKeyIds)

  await config.saveSettings()

  // The files go in after the settings, so a script lands in the folder that just arrived
  // with them rather than the one this vault had a moment ago.
  const files = await applyFiles(GlobalStore.getInstance().app, filesOnly(chosen), scriptsFolder())

  const connection = await applyConnection(takeConnection, stand)
  done.value = true

  emit('applied', {
    items: settingsOnly(chosen).length + files.written,
    keysRefused,
    filesRefused: files.failed.length,
    connection,
  })
}

/* ------------------------------------------------------------------ reading from a camera */

let stream: MediaStream | null = null
let timer: number | null = null
let cameraGeneration = 0

const startCamera = async () => {
  stopCamera()
  const request = cameraGeneration
  error.value = ''
  try {
    const granted = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    })
    if (request !== cameraGeneration) {
      granted.getTracks().forEach((track) => track.stop())
      return
    }
    stream = granted
  } catch {
    if (request !== cameraGeneration) return
    error.value = 'No camera here. Take a photo of the code, or paste the transfer as text.'
    return
  }

  cameraOn.value = true
  if (video.value) {
    video.value.srcObject = stream
    await video.value.play()
  }

  if (request !== cameraGeneration) return
  // Four looks a second: the sending side holds each code for the best part of one, and
  // decoding a frame costs more than the interval saves.
  timer = win().setInterval(() => void grab(), 250)
}

const stopCamera = () => {
  cameraGeneration++
  if (timer !== null) win().clearInterval(timer)
  timer = null
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  if (video.value) video.value.srcObject = null
  cameraOn.value = false
}

const grab = async () => {
  const element = video.value
  if (!element?.videoWidth) return

  const canvas = win().createEl('canvas')
  canvas.width = element.videoWidth
  canvas.height = element.videoHeight
  const context = canvas.getContext('2d')
  if (!context) return

  context.drawImage(element, 0, 0)
  for (const text of await readCodes(context.getImageData(0, 0, canvas.width, canvas.height))) {
    await take(text)
  }
}

const pickPhoto = () => {
  const input = win().createEl('input')
  input.type = 'file'
  input.accept = 'image/*'
  // What turns the file picker into the camera on a phone, without asking for the camera
  // ourselves: the system takes the picture and hands back a file.
  input.capture = 'environment'
  input.onchange = () => void fromFile(input.files?.[0])
  input.click()
}

/* --------------------------------------------------------------------- reading from a file */

/**
 * The other side can save the whole transfer as a file, which is the road that does not need a
 * camera at all — and the phone that has no camera in its webview is exactly the one this
 * matters for. Any file the picker will hand over: it is read as text and searched for frames.
 */
const pickFile = () => {
  const input = win().createEl('input')
  input.type = 'file'
  input.onchange = () => void fromText(input.files?.[0])
  input.click()
}

const fromText = async (file?: File) => {
  if (!file) return

  error.value = ''
  if (!(await swallow(await file.text()))) error.value = 'No transfer in that file.'
}

/* -------------------------------------------------------------------- reading from a photo */

const fromFile = async (file?: File) => {
  if (!file) return

  const bitmap = await createImageBitmap(file)
  const found = await lookAt(bitmap)

  if (!found.length) error.value = 'No code in that picture.'
  for (const text of found) await take(text)
}

/**
 * The picture whole, and then square by square if that gave nothing.
 *
 * Both are drawn small enough to be read without a photograph's worth of memory behind them;
 * the squares are drawn from the original, so what they lose in width they keep in detail.
 */
const lookAt = async (bitmap: ImageBitmap): Promise<string[]> => {
  const whole = pixels(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height })
  const found = whole ? await readCodes(whole) : []
  if (found.length) return found

  for (const look of closerLooks(bitmap.width, bitmap.height)) {
    const image = pixels(bitmap, look)
    const closer = image ? await readCodes(image) : []
    if (closer.length) return closer
  }

  return []
}

const pixels = (bitmap: ImageBitmap, from: Rect): ImageData | null => {
  const size = readableSize(from.width, from.height)
  const canvas = win().createEl('canvas')
  canvas.width = size.width
  canvas.height = size.height

  const context = canvas.getContext('2d')
  if (!context) return null

  context.drawImage(bitmap, from.x, from.y, from.width, from.height, 0, 0, size.width, size.height)

  return context.getImageData(0, 0, size.width, size.height)
}

onBeforeUnmount(() => {
  stopCamera()
  // Closed by the parent rather than by the person — the settings closing — is closed too.
  release()
})
</script>

<style lang="scss">
.abele-transfer-scan {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}

.abele-transfer-scan__view {
  width: 100%;
  max-height: 60vh;
  border-radius: var(--radius-m);
  background-color: var(--background-secondary);
}

.abele-transfer-scan__sources {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
}

.abele-transfer-scan__progress {
  color: var(--text-normal);
}

.abele-transfer-scan__missing {
  color: var(--text-muted);
  margin-left: var(--size-4-2);
}

.abele-transfer-scan__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-transfer-scan__error {
  margin: 0;
  color: var(--text-error);
}

// The replacement note is part of the destination, not another competing column. Keep the
// native checkbox and metadata separate, so adding that note never shrinks a name to fragments.
.abele-transfer-scan__entry {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1) 0;
  cursor: pointer;
}

.abele-transfer-scan__entry-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: var(--size-4-1);
}

.abele-transfer-scan__entry-details {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-2);
}

body.is-phone .abele-transfer-scan__entry {
  grid-template-columns: max-content minmax(0, 1fr);
}

body.is-phone .abele-transfer-scan__entry-details {
  grid-column: 2;
  justify-content: space-between;
}

.abele-transfer-scan__entry-name {
  color: var(--text-normal);
  overflow-wrap: anywhere;
}

.abele-transfer-scan__entry-note {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-transfer-scan__entry-section {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  margin-left: auto;
}
</style>
