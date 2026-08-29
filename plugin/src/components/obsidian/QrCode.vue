<template>
  <svg
    class="abele-qr"
    :viewBox="`0 0 ${side} ${side}`"
    shape-rendering="crispEdges"
    role="img"
    :aria-label="label"
  >
    <rect class="abele-qr__plate" x="0" y="0" :width="side" :height="side" />
    <path class="abele-qr__modules" :d="path" />
  </svg>
</template>

<script setup lang="ts">
import qr from 'qrcode-generator'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    text: string
    /** What a screen reader is told this is; the code itself is meaningless read aloud. */
    label?: string
    /** Error correction. `M` is the usual trade; `L` fits more in the same code. */
    level?: 'L' | 'M' | 'Q' | 'H'
  }>(),
  { label: 'QR code', level: 'M' }
)

/** Four modules of clear space on every side, which every scanner expects to find. */
const QUIET_ZONE = 4

const code = computed(() => {
  // Type number 0 lets the library pick the smallest version the data fits into.
  const built = qr(0, props.level)
  built.addData(props.text)
  built.make()
  return built
})

const side = computed(() => code.value.getModuleCount() + QUIET_ZONE * 2)

/** One path for the whole code: a rect per module is thousands of nodes for the same picture. */
const path = computed(() => {
  const count = code.value.getModuleCount()
  const parts: string[] = []

  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (!code.value.isDark(row, column)) continue
      parts.push(`M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`)
    }
  }

  return parts.join('')
})
</script>

<style lang="scss">
.abele-qr {
  width: 100%;
  height: auto;
}

/*
 * The one element in the kit that does not follow the theme, and the reason is the camera:
 * a scanner is entitled to expect dark modules on a light plate, and several refuse an
 * inverted code outright. In a dark theme every themed colour here would invert. See
 * docs/Design.md.
 */
.abele-qr__plate {
  fill: white;
}

.abele-qr__modules {
  fill: black;
}
</style>
