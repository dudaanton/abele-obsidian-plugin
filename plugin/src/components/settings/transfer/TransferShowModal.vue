<template>
  <ObsidianModal title="Transfer to another device" @close="emit('close')">
    <div ref="root" class="abele-transfer-show">
      <QrCode :text="frames[index]" :label="`Transfer code ${index + 1} of ${frames.length}`" />

      <div v-if="code" class="abele-transfer-show__code">
        <div class="abele-transfer-show__code-label">Type this on the other device</div>
        <div class="abele-transfer-show__code-value">{{ code }}</div>
      </div>

      <div v-if="frames.length > 1" class="abele-transfer-show__series">
        <Icon icon="chevron-left" with-bg tooltip="Previous code" @click="step(-1)" />
        <span class="abele-transfer-show__counter">{{ index + 1 }} / {{ frames.length }}</span>
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

      <p class="abele-transfer-show__hint">
        {{ hint }}
      </p>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import QrCode from '../../obsidian/QrCode.vue'
import Icon from '../../obsidian/Icon.vue'

const props = defineProps<{
  frames: string[]
  /** The one-time code, when the transfer carries a key. */
  code?: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const root = useTemplateRef<HTMLElement>('root')
const index = ref(0)
const cycling = ref(props.frames.length > 1)

/**
 * How long each code stays up.
 *
 * Slow enough for a phone to lock onto one and decode it, quick enough that a series of six
 * comes round in a few seconds. A missed code is not a problem — the reader collects whatever
 * it sees and waits for the rest to come round again.
 */
const FRAME_MS = 700

const step = (by: number) => {
  index.value = (index.value + by + props.frames.length) % props.frames.length
  // Stepping by hand means taking over; carrying on cycling would move the code out from
  // under the camera the reader has just been pointed at.
  cycling.value = false
}

let timer: number | null = null

const stop = () => {
  if (timer !== null) root.value?.win.clearInterval(timer)
  timer = null
}

// The element's own window: settings can open in a window of their own, whose timers stop
// when it closes — the main window's would keep firing at a component that is long gone.
watch([cycling, root], () => {
  stop()
  if (!cycling.value || !root.value) return
  timer = root.value.win.setInterval(() => {
    index.value = (index.value + 1) % props.frames.length
  }, FRAME_MS)
})

onBeforeUnmount(stop)

const hint = computed(() => {
  if (props.frames.length > 1) {
    return props.code
      ? 'Point the other device at the codes until it has them all, then type the code above.'
      : 'Point the other device at the codes until it has them all.'
  }
  return props.code
    ? 'Read this on the other device, then type the code above.'
    : 'Read this on the other device.'
})
</script>

<style lang="scss">
.abele-transfer-show {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-4-4);
}

.abele-transfer-show .abele-qr {
  // A phone needs a target it can fill its viewfinder with, and the modal is as wide as it is.
  max-width: 20em;
}

.abele-transfer-show__code {
  text-align: center;
}

.abele-transfer-show__code-label {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-transfer-show__code-value {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-large);
  letter-spacing: var(--size-4-1);
  color: var(--text-normal);
}

.abele-transfer-show__series {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-transfer-show__counter {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.abele-transfer-show__hint {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
</style>
