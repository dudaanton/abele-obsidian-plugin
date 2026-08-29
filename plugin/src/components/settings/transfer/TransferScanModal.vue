<template>
  <ObsidianModal title="Read a transfer" size="wide" @close="emit('close')">
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
          <span class="abele-transfer-scan__entry-name">{{ item.entry.label }}</span>
          <span class="abele-transfer-scan__entry-section">{{ label(item.entry.section) }}</span>
          <Badge :text="statusWord(item.status)" />
        </div>

        <Setting :name="acceptedSummary" :desc="keysSummary">
          <Button
            text="Apply"
            accent
            :disabled="!accepted.size"
            :tooltip="
              accepted.size
                ? 'Write these into this vault\'s settings'
                : 'Tick something to apply first'
            "
            @click="apply"
          />
        </Setting>
      </template>
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
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { createReceiver } from '@/transfer/frames'
import { decodePayload, isEncrypted } from '@/transfer/payload'
import {
  applyEntries,
  removedByReplace,
  filesOnly,
  planEntries,
  sectionLabel,
  settingsOnly,
  type ApplyMode,
  type PlannedEntry,
} from '@/transfer/entries'
import { applyFiles, planFiles, readCurrent } from '@/transfer/files'
import { readCodes } from '@/transfer/scan'
import type { SectionId, TransferPayload } from '@/transfer/types'

/** What was written, and what the keychain would not take — the parent says so out loud. */
export interface Applied {
  items: number
  keysRefused: number
  /** Files the vault would not take — a path it refuses, or a folder it cannot make. */
  filesRefused: number
}

const emit = defineEmits<{ (e: 'close'): void; (e: 'applied', result: Applied): void }>()

const root = useTemplateRef<HTMLElement>('root')
const video = useTemplateRef<HTMLVideoElement>('video')

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

/** A frame from anywhere: the camera, a photo, or pasted text. */
const take = async (text: string) => {
  if (!receiver.accept(text)) return
  sync()
  if (!receiver.done) return

  blob.value = receiver.assemble()
  stopCamera()
  await open()
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
  accepted.value = new Set(planned.value.map((item) => id(item)))
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

const planned = computed<PlannedEntry[]>(() => {
  const entries = payload.value?.entries
  if (!entries) return []

  return [
    ...planEntries(entries, settings()),
    ...planFiles(filesOnly(entries), current.value, scriptsFolder()),
  ]
})

const id = (item: PlannedEntry) => `${item.entry.section}:${item.entry.id}`

const accepted = ref(new Set<string>())

const toggle = (item: PlannedEntry) => {
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
  if (mode.value === 'merge') return 'Anything here that the transfer does not mention is left alone.'
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

const keysCount = computed(() => Object.keys(payload.value?.secrets ?? {}).length)

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
  for (const line of value.split(/\s+/)) if (line) void take(line)
}

const apply = async () => {
  if (!payload.value) return

  const chosen = acceptedEntries.value
  const config = AbeleConfig.getInstance()
  config.applySettings(applyEntries(chosen, config.exportSettings(), mode.value))

  const { app } = GlobalStore.getInstance()
  let keysRefused = 0

  for (const entry of chosen) {
    for (const secretId of entry.secretIds ?? []) {
      const value = payload.value.secrets[secretId]
      // A key that did not travel leaves whatever this device already has alone.
      if (!value) continue

      try {
        app.secretStorage.setSecret(secretId, value)
      } catch {
        // Obsidian takes only lowercase letters, digits and dashes for a key's name, and a
        // transfer can carry any name at all — one it refuses must not abandon the rest of
        // the settings half written.
        keysRefused++
      }
    }
  }

  await config.saveSettings()

  // The files go in after the settings, so a script lands in the folder that just arrived
  // with them rather than the one this vault had a moment ago.
  const files = await applyFiles(
    GlobalStore.getInstance().app,
    filesOnly(chosen),
    scriptsFolder()
  )

  emit('applied', {
    items: settingsOnly(chosen).length + files.written,
    keysRefused,
    filesRefused: files.failed.length,
  })
}

/* ------------------------------------------------------------------ reading from a camera */

let stream: MediaStream | null = null
let timer: number | null = null

const startCamera = async () => {
  error.value = ''
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    })
  } catch {
    error.value = 'No camera here. Take a photo of the code, or paste the transfer as text.'
    return
  }

  cameraOn.value = true
  if (video.value) {
    video.value.srcObject = stream
    await video.value.play()
  }

  // Four looks a second: the sending side holds each code for the best part of one, and
  // decoding a frame costs more than the interval saves.
  timer = root.value?.win.setInterval(() => void grab(), 250) ?? null
}

const stopCamera = () => {
  if (timer !== null) root.value?.win.clearInterval(timer)
  timer = null
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  cameraOn.value = false
}

const grab = async () => {
  const element = video.value
  if (!element?.videoWidth) return

  const canvas = element.doc.win.createEl('canvas')
  canvas.width = element.videoWidth
  canvas.height = element.videoHeight
  const context = canvas.getContext('2d')
  if (!context) return

  context.drawImage(element, 0, 0)
  for (const text of await readCodes(context.getImageData(0, 0, canvas.width, canvas.height))) {
    await take(text)
  }
}

/* -------------------------------------------------------------------- reading from a photo */

const pickPhoto = () => {
  const input = root.value?.doc.win.createEl('input')
  if (!input) return

  input.type = 'file'
  input.accept = 'image/*'
  // What turns the file picker into the camera on a phone, without asking for the camera
  // ourselves: the system takes the picture and hands back a file.
  input.capture = 'environment'
  input.onchange = () => void fromFile(input.files?.[0])
  input.click()
}

const fromFile = async (file?: File) => {
  if (!file) return

  const bitmap = await createImageBitmap(file)
  const canvas = root.value?.doc.win.createEl('canvas')
  if (!canvas) return

  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) return

  context.drawImage(bitmap, 0, 0)
  const found = await readCodes(context.getImageData(0, 0, canvas.width, canvas.height))
  if (!found.length) error.value = 'No code in that picture.'
  for (const text of found) await take(text)
}

onBeforeUnmount(stopCamera)
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

.abele-transfer-scan__entry {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1) 0;
  cursor: pointer;
}

.abele-transfer-scan__entry-name {
  color: var(--text-normal);
  overflow-wrap: anywhere;
}

.abele-transfer-scan__entry-section {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  margin-left: auto;
}
</style>
