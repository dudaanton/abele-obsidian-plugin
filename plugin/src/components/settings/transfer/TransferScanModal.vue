<template>
  <ObsidianModal
    :title="t('settings.transfer.TransferScanModal.read_a_transfer.da2dcc0f')"
    size="wide"
    @close="onClose"
  >
    <div ref="root" class="abele-transfer-scan">
      <template v-if="phase === 'collect'">
        <video v-show="cameraOn" ref="video" class="abele-transfer-scan__view" playsinline muted />

        <div v-if="!cameraOn" class="abele-transfer-scan__sources">
          <Button
            :text="t('settings.transfer.TransferScanModal.use_the_camera.429bb22e')"
            accent
            :tooltip="t('settings.transfer.TransferScanModal.point_the_camera_at_the.81f345ce')"
            @click="startCamera"
          />
          <Button
            :text="t('settings.transfer.TransferScanModal.take_a_photo.996e6a73')"
            :tooltip="t('settings.transfer.TransferScanModal.photograph_the_code_or_pick.31bb8c87')"
            @click="pickPhoto"
          />
          <Button
            :text="t('settings.transfer.TransferScanModal.open_a_file.3b31f677')"
            :tooltip="t('settings.transfer.TransferScanModal.read_a_transfer_saved_as.0d55f3e7')"
            @click="pickFile"
          />
          <Button
            :text="t('settings.transfer.TransferScanModal.paste_the_text.d98782e3')"
            :tooltip="t('settings.transfer.TransferScanModal.paste_the_transfer_as_text.5455e7aa')"
            @click="pasting = !pasting"
          />
        </div>

        <Input
          v-if="pasting"
          as-text-area
          :model-value="pasted"
          :placeholder="t('settings.transfer.TransferScanModal.abl.c834a09f')"
          @update:model-value="onPasted"
        />

        <div v-if="progress.total" class="abele-transfer-scan__progress">
          {{ progress.received }} / {{ progress.total }}
          {{ t('settings.transfer.TransferScanModal.codes_read.99b98121') }}
          <span v-if="progress.missing.length" class="abele-transfer-scan__missing">
            {{
              t('settings.sentence.7caf85c3282be170', {
                value0: String(progress.missing.join(', ')),
              })
            }}
          </span>
        </div>
        <p v-else class="abele-transfer-scan__hint">
          {{ t('settings.transfer.TransferScanModal.nothing_read_yet_the_other.eab29908') }}
        </p>
      </template>

      <template v-else-if="phase === 'code'">
        <p class="abele-transfer-scan__hint">
          {{ t('settings.transfer.TransferScanModal.this_transfer_carries_a_key.fd9c3a91') }}
        </p>
        <Input
          :model-value="code"
          :placeholder="t('settings.transfer.TransferScanModal.characters.2ad81da8')"
          @update:model-value="code = $event"
          @keydown.enter="unlock"
        />
      </template>

      <template v-else>
        <p class="abele-transfer-scan__hint">
          {{ t('settings.sentence.2d2a1f1b3800ab01', { value0: String(madeAt) }) }}
        </p>

        <Setting
          :name="t('settings.transfer.TransferScanModal.what_to_do_with_what.99215800')"
          :desc="modeNote"
        >
          <Dropdown
            :model-value="mode"
            :options="[
              {
                value: 'merge',
                display: t('settings.transfer.TransferScanModal.keep_it_and_add_these.b6bd0311'),
              },
              {
                value: 'replace',
                display: t('settings.transfer.TransferScanModal.replace_it_with_these.c489d0d8'),
              },
            ]"
            @update:model-value="mode = $event as ApplyMode"
          />
        </Setting>

        <!-- What arrived as the sending page lists it: a group a heading, a thing a row with a
             check; whether it is new here or replaces something is a code with its words in the
             tooltip. -->
        <div v-for="group in plannedGroups" :key="group.section" class="abele-transfer-scan__group">
          <GroupHeading :label="group.label">{{ group.items.length }}</GroupHeading>
          <div role="list">
            <EntryRow
              v-for="item in group.items"
              :key="id(item)"
              role="listitem"
              class="abele-transfer-scan__entry"
              @click="toggle(item)"
            >
              <template #leading>
                <input
                  type="checkbox"
                  class="abele-transfer-scan__check"
                  :checked="accepted.has(id(item))"
                  :aria-label="
                    t('settings.transfer.TransferScanModal.keep_value.c1cdcb02', {
                      value0: String(transferLabel(item.entry)),
                    })
                  "
                  @click.stop
                  @change="toggle(item)"
                />
              </template>
              {{ transferLabel(item.entry) }}
              <template v-if="item.status !== 'same'" #codes>
                <Icon
                  :icon="item.status === 'new' ? 'plus' : 'pencil'"
                  :interactive="false"
                  :tooltip="
                    item.status === 'new'
                      ? t('settings.transfer.TransferScanModal.not_on_this_device_yet.591f425a')
                      : t(
                          'settings.transfer.TransferScanModal.replaces_the_one_already_on.a7c76324'
                        )
                  "
                />
              </template>
              <template v-if="item.status === 'same'" #meta>
                <span>{{
                  t('settings.transfer.TransferScanModal.already_here_the_same.1f75ca0c')
                }}</span>
              </template>
            </EntryRow>
          </div>
        </div>

        <!-- What applying comes to, said once under the list, beside the Apply below it. -->
        <p class="abele-transfer-scan__hint">{{ acceptedSummary }}. {{ keysSummary }}</p>
      </template>

      <p v-if="error" class="abele-transfer-scan__error">{{ error }}</p>
    </div>
    <!-- The answer at the window's foot, in sight however long the list runs. -->
    <template #footer>
      <Button
        v-if="phase === 'code'"
        :text="t('settings.transfer.TransferScanModal.unlock.4ac709aa')"
        accent
        :tooltip="t('settings.transfer.TransferScanModal.open_the_transfer_with_this.2ad88253')"
        @click="unlock"
      />
      <Button
        v-else-if="phase === 'review'"
        :text="t('settings.transfer.TransferScanModal.apply.31e392d1')"
        accent
        :disabled="!accepted.size || busy || done"
        :tooltip="applyTooltip"
        @click="apply"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { settingsLabel, transferLabel } from '@/i18n/settingsLabels'
import { t } from '@/i18n'
import { settingsCount } from '@/i18n/settingsCounts'
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import Button from '../../obsidian/Button.vue'
import Input from '../../obsidian/Input.vue'
import EntryRow from '../../obsidian/EntryRow.vue'
import GroupHeading from '../../obsidian/GroupHeading.vue'
import Icon from '../../obsidian/Icon.vue'
import Setting from '../../obsidian/Setting.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
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
import { isReservedSecretId } from '@/secrets/SecretStore'
import { readCodes, readableSize, closerLooks, type Rect } from '@/transfer/scan'
import { TRANSFER_SECTIONS, type SectionId, type TransferPayload } from '@/transfer/types'

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

const label = (section: SectionId) => settingsLabel(sectionLabel(section))

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
    error.value = t('settings.transfer.TransferScanModal.that_transfer_did_not_arrive.1b9bb186')
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
        ? t('settings.transfer.TransferScanModal.that_code_does_not_open.de6ab3a4')
        : t('settings.transfer.TransferScanModal.that_transfer_did_not_arrive.1b9bb186')
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
  const entries = payload.value?.entries.filter((entry) => entry.section !== 'sync-connection')
  if (!entries) return []

  return [
    ...planEntries(entries, settings()),
    ...planFiles(filesOnly(entries), current.value, scriptsFolder()),
  ]
})

const id = (item: PlannedEntry) => `${item.entry.section}:${item.entry.id}`

/** What arrived, by section in the order the sending page lists them. */
const plannedGroups = computed(() => {
  const bySection = new Map<SectionId, PlannedEntry[]>()
  for (const item of planned.value) {
    const list = bySection.get(item.entry.section) ?? []
    list.push(item)
    bySection.set(item.entry.section, list)
  }
  return TRANSFER_SECTIONS.filter((section) => bySection.has(section)).map((section) => ({
    section,
    label: label(section),
    items: bySection.get(section) ?? [],
  }))
})

const accepted = ref(new Set<string>())

/**
 * Ticked to start with: everything but a connection that would replace this device's own —
 * that one is the person's to tick — or one there is nothing to do with.
 */
const tickedAtFirst = (_item: PlannedEntry) => true

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
  if (mode.value === 'merge')
    return t('settings.transfer.TransferScanModal.anything_here_that_the_transfer.589d08a0')
  if (!going.value.length)
    return t('settings.transfer.TransferScanModal.nothing_here_would_be_removed.319450b4')

  const names = going.value.map((item) => item.label).join(', ')
  return t('settings.transfer.TransferScanModal.value_value_scripts_skills_and.11b87876', {
    value0: String(
      going.value.length === 1
        ? t('settings.parts.195dc73d2db93bf8')
        : t('settings.parts.778541341fcda9aa')
    ),
    value1: String(names),
  })
})

const acceptedEntries = computed(() =>
  planned.value.filter((item) => accepted.value.has(id(item))).map((item) => item.entry)
)

const acceptedSummary = computed(() =>
  t('settings.transfer.itemsToApply', { count: accepted.value.size })
)

/** Count planned key writes, not everything the sender included. Use Apply's normalization
 * and unique references; missing/empty values and reserved device credentials are not stored.
 * The sync connection is handled separately by its service, never as an ordinary key write.
 */
const keysCount = computed(() => {
  const opened = payload.value
  if (!opened) return 0
  const chosen = acceptedEntries.value.filter((entry) => entry.section !== 'sync-connection')
  try {
    const next = applyEntries(chosen, settings(), mode.value)
    return arrivingSecretIds(chosen, next).filter(
      (id) => opened.secrets[id] && !isReservedSecretId(id)
    ).length
  } catch {
    // Apply validates before writing anything. Keep its rejection reviewable, not a render error.
    return 0
  }
})

const keysSummary = computed(() =>
  keysCount.value
    ? t('settings.transfer.TransferScanModal.value_to_store_for_the.22f67128', {
        value0: String(settingsCount('key', keysCount.value)),
      })
    : t('settings.transfer.TransferScanModal.no_keys_to_store_for.40b27ff7')
)

const madeAt = computed(() => {
  const at = payload.value?.at
  if (!at) return t('settings.transfer.TransferScanModal.just_now.7ddb44d8')
  const made = new Date(at)
  const today = new Date().toDateString() === made.toDateString()
  const time = made.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return today
    ? t('settings.transfer.TransferScanModal.today_at_value.c0d04ee3', { value0: String(time) })
    : t('settings.transfer.TransferScanModal.value_at_value.92c9c89a', {
        value0: String(made.toLocaleDateString()),
        value1: String(time),
      })
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
  if (done.value) return t('settings.transfer.TransferScanModal.already_applied.ca602d60')
  if (busy.value) return t('settings.transfer.TransferScanModal.applying.3329a9bb')
  return accepted.value.size
    ? t('settings.transfer.TransferScanModal.write_these_into_this_vault.1d9ecead')
    : t('settings.transfer.TransferScanModal.tick_something_to_apply_first.c9effb7d')
})

/**
 * Taking a connection that replaces this device's own is asked about first; everything else
 * goes at once. The connection is taken last, after the settings and files are written, so a
 * failure to take it costs nothing else.
 */
const apply = async () => {
  if (!payload.value || busy.value || done.value) return
  busy.value = true
  try {
    await finish()
  } finally {
    busy.value = false
  }
}
const onClose = () => emit('close')

const finish = async () => {
  if (!payload.value) return

  const chosen = acceptedEntries.value.filter((entry) => entry.section !== 'sync-connection')
  const config = AbeleConfig.getInstance()
  let incomingKeyIds: string[]
  try {
    const next = applyEntries(chosen, config.exportSettings(), mode.value)
    // Resolve once from the same normalized settings that will actually be committed.
    incomingKeyIds = arrivingSecretIds(chosen, next)
    config.applySettings(next)
  } catch (e) {
    // Connection/credential binding is validated before any keychain or settings write.
    error.value =
      e instanceof Error
        ? e.message
        : t('settings.transfer.TransferScanModal.these_settings_could_not_be.77e9b53e')
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

  done.value = true

  emit('applied', {
    items: settingsOnly(chosen).length + files.written,
    keysRefused,
    filesRefused: files.failed.length,
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
    error.value = t('settings.transfer.TransferScanModal.no_camera_here_take_a.1f89f870')
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
  if (!(await swallow(await file.text())))
    error.value = t('settings.transfer.TransferScanModal.no_transfer_in_that_file.f0c76a1f')
}

/* -------------------------------------------------------------------- reading from a photo */

const fromFile = async (file?: File) => {
  if (!file) return

  const bitmap = await createImageBitmap(file)
  const found = await lookAt(bitmap)

  if (!found.length)
    error.value = t('settings.transfer.TransferScanModal.no_code_in_that_picture.34801264')
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

.abele-transfer-scan__group {
  margin-top: var(--size-4-2);

  .abele-group-heading {
    margin-bottom: var(--size-2-2);
  }
}

.abele-transfer-scan__entry {
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

.abele-transfer-scan .abele-transfer-scan__check {
  margin: 0;
}
</style>
