<template>
  <ObsidianModal title="Send to another device" @close="emit('close')">
    <div ref="root" class="abele-transfer-send">
      <div v-if="code" class="abele-transfer-send__code">
        <div class="abele-transfer-send__code-label">Type this on the other device</div>
        <div class="abele-transfer-send__code-value">{{ code }}</div>
      </div>

      <p class="abele-transfer-send__hint">{{ advice }}</p>

      <div class="abele-transfer-send__roads">
        <Button
          text="Copy the text"
          :accent="!showing"
          tooltip="Copy the whole transfer, to paste on the other device"
          @click="copy"
        />
        <Button
          text="Save a file"
          tooltip="Write the transfer into this vault, to send on however you like"
          @click="save"
        />
        <Button
          v-if="!showing"
          text="Show the codes"
          :tooltip="`Show the transfer as ${frames.length === 1 ? 'a QR code' : `${frames.length} QR codes`}`"
          @click="showing = true"
        />
      </div>

      <template v-if="showing">
        <QrCode :text="frames[index]" :label="`Transfer code ${index + 1} of ${frames.length}`" />

        <div v-if="frames.length > 1" class="abele-transfer-send__series">
          <Icon icon="chevron-left" with-bg tooltip="Previous code" @click="step(-1)" />
          <span class="abele-transfer-send__counter">{{ index + 1 }} / {{ frames.length }}</span>
          <Icon icon="chevron-right" with-bg tooltip="Next code" @click="step(1)" />
          <Icon
            :icon="cycling ? 'pause' : 'play'"
            with-bg
            :tooltip="
              cycling ? 'Stop moving through the codes' : 'Move through the codes on their own'
            "
            @click="cycling = !cycling"
          />
        </div>
      </template>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { Notice } from 'obsidian'
import ObsidianModal from '../../obsidian/Modal.vue'
import QrCode from '../../obsidian/QrCode.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'

const props = defineProps<{
  /** The transfer cut for a camera, one code at a time. */
  frames: string[]
  /** The same transfer in one piece, for the roads that are not a picture. */
  text: string
  /** The one-time code, when the transfer carries a key. */
  code?: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const root = useTemplateRef<HTMLElement>('root')
const index = ref(0)

/** Settings can open in a window of their own, and the clipboard and timers are that window's. */
const win = () => root.value?.win ?? window

/**
 * How many codes are still worth pointing a camera at.
 *
 * Past that the QR road stops being the quick one — a real set of settings runs to dozens of
 * codes, and a phone that has no camera in its webview is left photographing them one at a
 * time. So it is offered rather than shown, and the text is what the screen leads with.
 */
const WORTH_PHOTOGRAPHING = 6

const showing = ref(props.frames.length <= WORTH_PHOTOGRAPHING)
const cycling = ref(props.frames.length > 1)

const advice = computed(() => {
  const tail = props.code ? ' The code above unlocks it on the other side.' : ''

  if (props.frames.length === 1) return `Read the code, or copy the text.${tail}`
  if (props.frames.length <= WORTH_PHOTOGRAPHING) {
    return `${props.frames.length} codes, shown one after another — or copy the text and skip the camera.${tail}`
  }
  return `This one takes ${props.frames.length} codes, which is more than anyone wants to photograph. Copy the text into a message, or save it as a file and send that.${tail}`
})

const step = (by: number) => {
  index.value = (index.value + by + props.frames.length) % props.frames.length
  // Stepping by hand means taking over; carrying on cycling would move the code out from
  // under the camera the reader has just been pointed at.
  cycling.value = false
}

const copy = async () => {
  await win().navigator.clipboard.writeText(props.text)
  new Notice('Transfer copied. Paste it on the other device.')
}

/**
 * Saved into the vault rather than downloaded: on a phone there is nowhere else to put it,
 * and the vault folder is somewhere both Finder and Files can reach — which is what makes it
 * something you can hand over, by AirDrop, by sync, or by sending the file itself.
 */
const save = async () => {
  const { app } = GlobalStore.getInstance()
  const path = `Abele transfer ${stamp()}.txt`

  try {
    await app.vault.create(path, props.text)
    new Notice(`Saved as ${path}. Open it under "Read a transfer" on the other device.`)
  } catch (error) {
    new Notice(`Could not save it: ${error instanceof Error ? error.message : error}`)
  }
}

/** A name with no colons in it, which is what a file name may not have. */
const stamp = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

let timer: number | null = null

const stop = () => {
  if (timer !== null) win().clearInterval(timer)
  timer = null
}

/**
 * How long each code stays up.
 *
 * Slow enough for a phone to lock onto one and decode it, quick enough that a series of six
 * comes round in a few seconds. A missed code is not a problem — the reader collects whatever
 * it sees and waits for the rest to come round again.
 */
const FRAME_MS = 700

// The element's own window: settings can open in a window of their own, whose timers stop
// when it closes — the main window's would keep firing at a component that is long gone.
watch([cycling, showing, root], () => {
  stop()
  if (!cycling.value || !showing.value || !root.value) return
  timer = win().setInterval(() => {
    index.value = (index.value + 1) % props.frames.length
  }, FRAME_MS)
})

onBeforeUnmount(stop)
</script>

<style lang="scss">
.abele-transfer-send {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-4-4);
}

.abele-transfer-send .abele-qr {
  // A phone needs a target it can fill its viewfinder with, and the modal is as wide as it is.
  max-width: 20em;
}

.abele-transfer-send__code {
  text-align: center;
}

.abele-transfer-send__code-label {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-transfer-send__code-value {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-large);
  letter-spacing: var(--size-4-1);
  color: var(--text-normal);
}

.abele-transfer-send__roads {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--size-4-2);
}

.abele-transfer-send__series {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-transfer-send__counter {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.abele-transfer-send__hint {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
</style>
