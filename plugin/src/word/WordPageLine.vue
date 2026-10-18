<template>
  <!-- A paragraph on the page: drawn in its style with its marks, and while it is written in, a
       field in the same type at the same place. -->
  <div
    class="abele-word-line"
    :class="[
      `abele-word-line_${kind}`,
      {
        'abele-word-line_list': !!paragraph.list,
        'abele-word-line_editing': editing,
        'abele-word-line_locked': paragraph.locked,
      },
    ]"
    :data-paragraph="paragraph.number"
    :data-marker="marker"
  >
    <textarea
      v-if="editing"
      ref="field"
      class="abele-word-line__field"
      :value="draft ?? text"
      rows="1"
      :aria-label="t('streamC.54c5c35aab75e0a4', { v1: String(paragraph.number) })"
      @input="onInput"
      @select="onSelect"
      @keyup="onSelect"
      @mouseup="onSelect"
      @keydown="emit('keys', $event)"
      @blur="onBlur"
    />
    <div
      v-else
      class="abele-word-line__text"
      :tabindex="readOnly || paragraph.locked ? undefined : 0"
      :role="readOnly || paragraph.locked ? undefined : 'button'"
      :aria-label="
        readOnly || paragraph.locked
          ? undefined
          : t('streamC.fd303b58a0fd47cb', { v1: String(paragraph.number) })
      "
      @click="emit('open')"
      @keydown.enter.prevent="emit('open')"
    >
      <template v-for="(run, i) in paragraph.runs" :key="i">
        <a
          v-if="run.link"
          :href="run.link"
          :class="markClasses(run)"
          target="_blank"
          rel="noopener noreferrer"
          @click.stop
          >{{ run.text }}</a
        >
        <span v-else :class="markClasses(run)">{{ run.text }}</span>
      </template>
      <span v-if="!text" class="abele-word-line__empty" aria-hidden="true">&#8203;</span>
      <Icon
        v-if="paragraph.locked"
        icon="lock"
        size="xs"
        class="abele-word-line__lock"
        :interactive="false"
        :tooltip="t('streamC.6c8f45812a211409')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import { computed, nextTick, ref, watch } from 'vue'
import Icon from '@/components/obsidian/Icon.vue'
import { paragraphText, type WordPageParagraph, type WordPageRun } from './pageModel'

const props = defineProps<{
  paragraph: WordPageParagraph
  editing: boolean
  readOnly: boolean
  draft?: string
  /** A list item's marker: "•", or its number in its list, "3.". */
  marker?: string
}>()

const emit = defineEmits<{
  open: []
  leave: []
  input: [text: string]
  select: [range: { from: number; to: number }]
  keys: [event: KeyboardEvent]
}>()

const text = computed(() => paragraphText(props.paragraph))

/** The style decides the type: headings by their level, a quote, a title; the rest is body. */
const kind = computed(() => {
  const style = (props.paragraph.style ?? '').toLowerCase()
  const level = /heading\s*([1-6])/.exec(style)?.[1]
  if (level) return `h${level}`
  if (style === 'title') return 'title'
  if (style.includes('quote')) return 'quote'
  return 'body'
})

const markClasses = (run: WordPageRun) => (run.marks ?? []).map((m) => `abele-word-mark_${m}`)

const field = ref<HTMLTextAreaElement>()

/** The field grows with what is written in it, so the page does not jump. */
const fit = () => {
  const el = field.value
  if (!el) return
  el.setCssProps({ height: 'auto' })
  el.setCssProps({ height: `${el.scrollHeight}px` })
}

watch(
  () => props.editing,
  async (on) => {
    if (!on) return
    await nextTick()
    fit()
    field.value?.focus()
    const end = field.value?.value.length ?? 0
    field.value?.setSelectionRange(end, end)
  },
  { immediate: true }
)

const onInput = (e: Event) => {
  emit('input', (e.target as HTMLTextAreaElement).value)
  fit()
}

const onSelect = () => {
  const el = field.value
  if (el) emit('select', { from: el.selectionStart, to: el.selectionEnd })
}

/** Leaving for the ribbon keeps writing; leaving for anything else ends it. */
const onBlur = (e: FocusEvent) => {
  const to = e.relatedTarget as HTMLElement | null
  if (to?.closest('.abele-word-page__ribbon')) return
  emit('leave')
}
</script>

<style lang="scss">
.abele-word-line {
  content-visibility: auto;
  contain-intrinsic-size: auto 2em;
  position: relative;
  margin-block: 0 var(--p-spacing);
}

.abele-word-line_editing {
  content-visibility: visible;
}

.abele-word-line__text {
  white-space: pre-wrap;
  outline-offset: var(--size-2-2);
  overflow-wrap: anywhere;
  cursor: text;

  &:focus-visible {
    outline: 2px solid var(--background-modifier-border-focus);
  }
}

.abele-word-line_locked .abele-word-line__text {
  cursor: default;
}

.abele-word-line__lock {
  position: absolute;
  inset-inline-start: calc(-1 * var(--size-4-6));
  top: 0.25em;
  color: var(--text-faint);
  opacity: 0;
}

.abele-word-line_locked:hover .abele-word-line__lock {
  opacity: 1;
}

// The field takes the paragraph's own type, so writing in it looks like the page.
.abele-word-line__field {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: var(--text-selection);
  box-shadow: 0 0 0 var(--size-2-2) var(--text-selection);
  font: inherit;
  color: inherit;
  line-height: inherit;
  resize: none;
  overflow: hidden;

  &:focus,
  &:focus-visible {
    box-shadow: 0 0 0 var(--size-2-2) var(--text-selection);
    outline: none;
  }
}

.abele-word-line_title {
  font-size: var(--inline-title-size);
  font-weight: var(--inline-title-weight);
  line-height: var(--inline-title-line-height);
}

.abele-word-line_h1 {
  font-size: var(--h1-size);
  font-weight: var(--h1-weight);
  line-height: var(--h1-line-height);
  margin-top: var(--heading-spacing);
}

.abele-word-line_h2 {
  font-size: var(--h2-size);
  font-weight: var(--h2-weight);
  line-height: var(--h2-line-height);
  margin-top: var(--heading-spacing);
}

.abele-word-line_h3,
.abele-word-line_h4,
.abele-word-line_h5,
.abele-word-line_h6 {
  font-size: var(--h3-size);
  font-weight: var(--h3-weight);
  line-height: var(--h3-line-height);
}

.abele-word-line_quote {
  padding-inline-start: var(--size-4-4);
  // Grey and straight, as rule 37 keeps a quote's line.
  border-inline-start: var(--blockquote-border-thickness) solid
    var(--background-modifier-border-hover);
  font-style: var(--blockquote-font-style);
}

// A list item stands in from the text with its marker in the gutter, as in a note.
.abele-word-line_list {
  padding-inline-start: var(--list-indent);
  margin-block-end: var(--size-2-2);

  &::before {
    position: absolute;
    inset-inline-start: calc(var(--list-indent) - var(--size-4-4));
    content: attr(data-marker);
    color: var(--list-marker-color);
  }
}

.abele-word-mark_bold {
  font-weight: var(--bold-weight);
}

.abele-word-mark_italic {
  font-style: italic;
}

.abele-word-mark_underline {
  text-decoration: underline;
}

.abele-word-mark_strike {
  text-decoration: line-through;
}
</style>
