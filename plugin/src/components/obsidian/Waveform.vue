<template>
  <div class="abele-waveform" role="img" :aria-label="label">
    <!--
      The one inline style in the kit, and it is data rather than styling: a bar's height *is*
      the loudness at that moment. Everything about how the bars look lives in the stylesheet.
    -->
    <div
      v-for="(bar, i) in bars"
      :key="i"
      class="abele-waveform__bar"
      :class="{ 'abele-waveform__bar_played': played(i) }"
      :style="height(bar)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Loudness from 0 to 1, oldest first. */
    levels: number[]
    /** How far playback has got, 0 to 1. Left out, nothing is drawn as played. */
    progress?: number
    label?: string
  }>(),
  { progress: undefined, label: 'Waveform' }
)

/**
 * How many bars are drawn, whatever the recording's length.
 *
 * A minute of speech is twelve hundred readings, and a row that wide either overflows the pane
 * or turns into a grey smear. Averaging into a fixed number of buckets is what a voice message
 * looks like everywhere: the shape stays, the width does not grow.
 */
const BARS = 56

const bars = computed<number[]>(() => {
  const levels = props.levels
  if (!levels.length) return []
  if (levels.length <= BARS) return levels

  const size = levels.length / BARS
  return Array.from({ length: BARS }, (_, i) => {
    const from = Math.floor(i * size)
    const to = Math.max(from + 1, Math.floor((i + 1) * size))
    let sum = 0
    for (let j = from; j < to; j++) sum += levels[j]
    return sum / (to - from)
  })
})

const played = (index: number): boolean =>
  props.progress !== undefined && index / Math.max(1, bars.value.length) < props.progress

/**
 * A floor under the height: a silent moment still gets a dot, so the row reads as a waveform
 * with a gap in it rather than as a row that stops and starts.
 */
const height = (bar: number) => ({ height: `${Math.max(8, Math.round(bar * 100))}%` })
</script>

<style lang="scss">
.abele-waveform {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  height: 2em;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

.abele-waveform__bar {
  flex: 1 1 0;
  min-width: 0;
  border-radius: var(--radius-s);
  background-color: var(--text-faint);
  transition: height 0.08s linear;
}

.abele-waveform__bar_played {
  background-color: var(--interactive-accent);
}
</style>
