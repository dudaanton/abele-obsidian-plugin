<template>
  <div class="abele-book-reader__footer" data-ignore-swipe="true">
    <Icon
      v-if="model.canGoBack"
      icon="undo-2"
      tooltip="Back to where you were before the link"
      @click="emit('back')"
    />
    <span class="abele-book-reader__chapter">{{ model.chapter }}</span>
    <Slider
      class="abele-book-reader__progress"
      :model-value="Math.round(dragging ?? model.fraction * 1000)"
      :min="0"
      :max="1000"
      label="Go to a place in the book"
      @input="dragging = $event"
      @update:model-value="seek"
    />
    <Button
      v-if="measured"
      class="abele-book-reader__percent abele-book-reader__measure"
      :text="text"
      :tooltip="`Tap to show ${nextLabel}`"
      @click="cycle"
    />
    <span v-else class="abele-book-reader__percent">{{ percentText }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * The line under a book's page: the way back from a link, the chapter, a slider through the
 * whole book, and a measure of how far into it the page is. In a reflowing book a tap on the
 * measure goes round its ways — the page of the chapter, the pages left in it, the place in the
 * whole book, the percentage — and the one chosen is kept, on every device the settings reach.
 * While the slider is held the measure shows where it would go, as a percentage.
 */
import { computed, ref, watch } from 'vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import Slider from '../obsidian/Slider.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { percent, type BookModel } from '@/reader/model'
import { readerSettingsFrom } from '@/reader/settings'
import { nextShow, progressText, type ProgressShow } from '@/reader/readingProgress'

const props = defineProps<{ model: BookModel }>()
const emit = defineEmits<{
  (e: 'back'): void
  (e: 'seek', fraction: number): void
}>()

const config = AbeleConfig.getInstance()
const show = ref<ProgressShow>(readerSettingsFrom(config.reader).progressShow)
watch(config.version, () => (show.value = readerSettingsFrom(config.reader).progressShow))

/** The slider while its thumb is held, in thousandths; null otherwise. */
const dragging = ref<number | null>(null)
const seek = (value: number) => {
  dragging.value = null
  emit('seek', value / 1000)
}

const percentText = computed(() => percent((dragging.value ?? props.model.fraction * 1000) / 1000))
/** A book that reports its pages; a PDF shows its own in the chapter's place. */
const measured = computed(() => !!props.model.progress)
const shown = computed<ProgressShow>(() => (dragging.value !== null ? 'percent' : show.value))
const text = computed(
  () => progressText(shown.value, props.model.progress, percentText.value) ?? percentText.value
)
const LABELS: Record<ProgressShow, string> = {
  page: 'the page of the chapter',
  left: 'the pages left in the chapter',
  location: 'the place in the whole book',
  percent: 'how far into the book, in percent',
}
const nextLabel = computed(() => LABELS[nextShow(show.value, props.model.progress)])

const cycle = () => {
  show.value = nextShow(show.value, props.model.progress)
  config.reader = readerSettingsFrom({
    ...readerSettingsFrom(config.reader),
    progressShow: show.value,
  })
  void config.saveSettings()
}
</script>

<style lang="scss">
.abele-book-reader {
  &__footer {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    flex: 0 0 auto;
    padding: 0 var(--size-4-3);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  &__chapter {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 40%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__progress {
    flex: 1 1 auto;
  }

  &__percent {
    flex: 0 0 auto;
    min-width: 3ch;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  /* The measure is a button to tap, drawn as the quiet text it was. */
  &__measure.abele-obsidian-button {
    height: auto;
    padding: var(--size-2-1) var(--size-2-2);
    background: none;
    box-shadow: none;
    font-size: inherit;
    color: inherit;
    white-space: nowrap;
  }
}
</style>
