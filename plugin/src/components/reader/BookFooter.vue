<template>
  <div class="abele-book-reader__footer" data-ignore-swipe="true">
    <Icon
      v-if="model.canGoBack"
      icon="undo-2"
      :tooltip="t('streamC.6d4320be353a906c')"
      @click="emit('back')"
    />
    <Icon
      v-if="model.kind === 'pdf'"
      icon="pen-line"
      :tooltip="t('streamC.5c70b136b98e494f')"
      class="abele-book-reader__draw"
      @click="emit('draw')"
    />
    <template v-if="model.kind === 'pdf' && model.zoom">
      <Icon
        v-if="phone"
        icon="zoom-in"
        :tooltip="t('streamC.509c517ede79fef0')"
        class="abele-book-reader__zoom-menu"
        @click="menu($event, true)"
      />
      <template v-else>
        <Icon
          icon="zoom-out"
          :tooltip="t('streamC.bc7b631a689b45ca')"
          class="abele-book-reader__zoom-out"
          @click="emit('zoom', 'out')"
        />
        <span class="abele-book-reader__zoom" @click="menu($event, false)">
          <Button
            class="abele-book-reader__measure"
            :text="`${Math.round(model.zoom * 100)}%`"
            :tooltip="t('streamC.0bd2e6df3069b53b')"
          />
        </span>
        <Icon
          icon="zoom-in"
          :tooltip="t('streamC.0e47f09a748fa132')"
          class="abele-book-reader__zoom-in"
          @click="emit('zoom', 'in')"
        />
      </template>
    </template>
    <span class="abele-book-reader__chapter">{{ model.chapter }}</span>
    <Slider
      class="abele-book-reader__progress"
      :model-value="Math.round(dragging ?? model.fraction * 1000)"
      :min="0"
      :max="1000"
      :label="t('streamC.55aedf24ff8ee34a')"
      @input="dragging = $event"
      @update:model-value="seek"
    />
    <Button
      v-if="measured"
      class="abele-book-reader__percent abele-book-reader__measure"
      :text="text"
      :tooltip="t('streamC.efac0f60e83be6ae', { v1: String(nextLabel) })"
      @click="cycle"
    />
    <span v-else class="abele-book-reader__percent">{{ percentText }}</span>
    <Icon
      class="abele-book-reader__bookmark"
      icon="bookmark"
      :active="marked"
      :tooltip="marked ? t('streamC.05306519291e56bb') : t('streamC.0b2c1ce24f9e6eb6')"
      @click="emit('bookmark')"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

/**
 * The line under a book's page: the way back from a link, under a PDF the pen that turns drawing
 * on and the zoom — out, the scale with the fits behind it, in — the chapter, a slider through the whole book, and a measure of how far into it the page is. In a reflowing book a tap on the
 * measure goes round its ways — the page of the chapter, the pages left in it, the place in the
 * whole book, the percentage — and the one chosen is kept, on every device the settings reach.
 * While the slider is held the measure shows where it would go, as a percentage. At the end, the
 * bookmark: filled when the page has one, a tap marks the page or unmarks it.
 */
import { computed, ref, watch } from 'vue'
import { Platform } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import Slider from '../obsidian/Slider.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { settingsSlice } from '@/composables/settingsSlice'
import { percent, type BookModel } from '@/reader/model'
import { readerSettingsFrom } from '@/reader/settings'
import { nextShow, progressText, type ProgressShow } from '@/reader/readingProgress'

const props = defineProps<{ model: BookModel }>()
const emit = defineEmits<{
  (e: 'back'): void
  (e: 'seek', fraction: number): void
  (e: 'bookmark'): void
  (e: 'draw'): void
  (e: 'zoom', way: 'in' | 'out'): void
  (e: 'zoom-menu', at: { x: number; y: number }, steps: boolean): void
}>()

/** A phone's line is short: its zoom is one magnifier, with the steps in its menu. */
const phone = Platform.isPhone

/** The zoom's menu, under the control that opened it. */
const menu = (e: Event, steps: boolean) => {
  const el = (e.currentTarget ?? e.target) as HTMLElement | null
  const box = el?.getBoundingClientRect()
  emit('zoom-menu', { x: box?.left ?? 0, y: box?.top ?? 0 }, steps)
}

const marked = computed(() => props.model.bookmarksHere.length > 0)

const config = AbeleConfig.getInstance()
const show = ref<ProgressShow>(readerSettingsFrom(config.reader).progressShow)
watch(
  settingsSlice((config) => readerSettingsFrom(config.reader).progressShow),
  (next) => (show.value = next)
)

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
  page: t('streamC.00700d2b57624056'),
  left: t('streamC.67b090342bea8823'),
  location: t('streamC.a5f995e85268e719'),
  percent: t('streamC.cb60afbecb493c9a'),
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

  /* A page with a bookmark: the ribbon filled, as a bookmark in a book is. */
  &__bookmark.abele-obsidian-icon_active svg {
    fill: currentColor;
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
