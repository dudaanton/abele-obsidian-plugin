<template>
  <div
    ref="root"
    class="abele-diff diff-view"
    :class="[`abele-diff_${shown}`, { 'abele-diff_empty': !changed, 'abele-diff_code': syntax }]"
    :style="{ '--abele-diff-digits': digits }"
  >
    <div v-if="title || $slots.title || changed" class="abele-diff__header">
      <span v-if="title || $slots.title" class="abele-diff__title"
        ><slot name="title">{{ title }}</slot></span
      >
      <span v-if="changed" class="abele-diff__stats">
        <span v-if="stats.removed" class="abele-diff__stat abele-diff__stat_removed"
          >−{{ stats.removed }}</span
        >
        <span v-if="stats.added" class="abele-diff__stat abele-diff__stat_added"
          >+{{ stats.added }}</span
        >
      </span>
      <span v-if="changed && (layout === 'auto' || foldable)" class="abele-diff__actions">
        <Icon
          v-if="foldable"
          :icon="folded ? 'unfold-vertical' : 'fold-vertical'"
          size="xs"
          :tooltip="t(folded ? 'chat.diffShowAll' : 'chat.diffCollapse')"
          :active="!folded"
          @click="toggleContext"
        />
        <Icon
          v-if="layout === 'auto'"
          :icon="shown === 'split' ? 'rows-2' : 'columns-2'"
          size="xs"
          :tooltip="shown === 'split' ? 'One under the other' : 'Side by side'"
          @click="chosen = shown === 'split' ? 'unified' : 'split'"
        />
      </span>
    </div>
    <div
      v-if="changed && shown === 'split' && (labelBefore || labelAfter)"
      class="abele-diff__labels"
    >
      <div class="abele-diff__label">{{ labelBefore }}</div>
      <div class="abele-diff__label">{{ labelAfter }}</div>
    </div>
    <div v-if="!changed" class="abele-diff__empty">{{ emptyText }}</div>
    <div v-else-if="shown === 'unified'" class="abele-diff__body">
      <template v-for="(row, index) in rows" :key="index">
        <div
          v-if="row.kind === 'fold'"
          class="diff-collapsed abele-diff__fold"
          :data-line-start="row.lines[0]?.lineA"
          :data-line-end="row.lines.at(-1)?.lineA"
          role="button"
          tabindex="0"
          @click="unfold(index)"
          @keydown.enter.prevent="unfold(index)"
          @keydown.space.prevent="unfold(index)"
        >
          <span class="abele-diff__gutter"><Icon icon="unfold-vertical" size="xs" /></span
          ><span class="abele-diff__fold-label">{{ foldLabel(row.lines.length) }}</span>
        </div>
        <div
          v-else
          class="diff-line abele-diff__line"
          :class="lineClass(row)"
          :data-line-a="row.lineA"
          :data-line-b="row.lineB"
        >
          <span class="abele-diff__gutter" aria-hidden="true"
            ><span class="abele-diff__number">{{ row.lineA }}</span
            ><span class="abele-diff__number">{{ row.lineB }}</span></span
          ><span class="abele-diff__sign">{{ sign(row) }}</span
          ><span class="abele-diff__text"
            ><span
              v-for="(piece, p) in painted(row)"
              :key="p"
              :class="{ 'diff-changed abele-diff__changed': piece.changed && row.kind !== 'same' }"
              ><template v-for="(part, q) in piece.parts" :key="q"
                ><span v-if="part.cls" :class="part.cls">{{ part.text }}</span
                ><template v-else>{{ part.text }}</template></template
              ></span
            ></span
          >
        </div>
      </template>
    </div>
    <div v-else class="abele-diff__body abele-diff__grid">
      <template v-for="(pair, index) in pairs" :key="index">
        <div
          v-if="pair.kind === 'fold'"
          class="diff-collapsed abele-diff__fold"
          :data-line-start="pair.lines?.[0]?.lineA"
          :data-line-end="pair.lines?.at(-1)?.lineA"
          role="button"
          tabindex="0"
          @click="unfoldPair(index)"
          @keydown.enter.prevent="unfoldPair(index)"
          @keydown.space.prevent="unfoldPair(index)"
        >
          <span class="abele-diff__gutter"><Icon icon="unfold-vertical" size="xs" /></span
          ><span class="abele-diff__fold-label">{{ foldLabel(pair.lines?.length ?? 0) }}</span>
        </div>
        <template v-else>
          <div
            v-for="side in ['left', 'right'] as const"
            :key="side"
            class="diff-line abele-diff__line"
            :data-line-a="pair[side]?.lineA"
            :data-line-b="pair[side]?.lineB"
            :class="[
              `abele-diff__line_${side}`,
              pair[side] ? lineClass(pair[side]!) : 'abele-diff__line_blank',
            ]"
          >
            <template v-if="pair[side]">
              <span class="abele-diff__gutter" aria-hidden="true"
                ><span class="abele-diff__number">{{
                  side === 'left' ? pair[side]!.lineA : pair[side]!.lineB
                }}</span></span
              ><span class="abele-diff__sign">{{ sign(pair[side]!) }}</span
              ><span class="abele-diff__text"
                ><span
                  v-for="(piece, p) in painted(pair[side]!)"
                  :key="p"
                  :class="{
                    'diff-changed abele-diff__changed':
                      piece.changed && pair[side]!.kind !== 'same',
                  }"
                  ><template v-for="(part, q) in piece.parts" :key="q"
                    ><span v-if="part.cls" :class="part.cls">{{ part.text }}</span
                    ><template v-else>{{ part.text }}</template></template
                  ></span
                ></span
              >
            </template>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// What changed between two versions of a text, drawn the way Obsidian draws its own comparison
// in file recovery and sync history: removed lines in its error colour, added ones in its
// success colour, the changed words inside them stronger, unchanged stretches folded away.
// A sign before each line says the same without colour. A file's code is coloured the way the
// plugin's code view colours it.
import { computed, nextTick, ref, watch } from 'vue'
import { t } from '@/i18n'
import { useResizeObserver } from '@vueuse/core'
import { diffLines, foldUnchanged, pairRows, type DiffLine, type DiffRow } from './diffModel'
import { lineTokens, paint, type PaintedPiece } from './diffSyntax'
import Icon from './obsidian/Icon.vue'

const props = withDefaults(
  defineProps<{
    /** The text as it was. */
    textLeft: string
    /** The text as it is now, or would be. */
    textRight: string
    /**
     * One column, as Obsidian shows it; or the two versions side by side, for a wide place; or
     * whichever fits where it is drawn, side by side whenever there is room, with a glyph in the
     * header to switch.
     */
    layout?: 'unified' | 'split' | 'auto'
    /** Unchanged lines kept around each change before the rest folds away. */
    context?: number
    /** Column headings for the side-by-side layout. */
    labelBefore?: string
    labelAfter?: string
    /** Said in place of the comparison when the two texts are the same. */
    emptyText?: string
    /** What is compared, usually the file's path; shown in the header beside the counts. */
    title?: string
    /** The compared file's path, when it is code: its extension picks the colours. */
    path?: string
  }>(),
  {
    layout: 'unified',
    context: 3,
    labelBefore: undefined,
    labelAfter: undefined,
    emptyText: 'No changes',
    title: undefined,
    path: undefined,
  }
)

const lines = computed(() => diffLines(props.textLeft, props.textRight))
const foldedRows = computed(() => foldUnchanged(lines.value, props.context))
const foldable = computed(() => foldedRows.value.some((row) => row.kind === 'fold'))
const changed = computed(() => lines.value.some((l) => l.kind !== 'same'))
const rows = ref<DiffRow[]>([])
watch(
  [lines, () => props.context],
  () => {
    rows.value = foldedRows.value.slice()
  },
  { immediate: true }
)
const pairs = computed(() => pairRows(rows.value))

// Each version is parsed whole, once, so a line in a comment that opened above it is coloured as
// one; a line takes its colours from the version it belongs to.
const syntax = computed(() => {
  const left = lineTokens(props.textLeft, props.path)
  const right = left && lineTokens(props.textRight, props.path)
  return left && right ? { left, right } : null
})
const painted = (line: DiffLine): PaintedPiece[] => {
  const tokens = syntax.value
  if (!tokens) return line.pieces.map((piece) => ({ ...piece, parts: [{ text: piece.text }] }))
  return paint(
    line.pieces,
    line.kind === 'added' ? tokens.right[line.lineB - 1] : tokens.left[line.lineA - 1]
  )
}
const folded = computed(() => rows.value.some((r) => r.kind === 'fold'))

// Side by side needs about two short lines of text across; narrower than that, as a sidebar
// usually is, the two versions go one under the other.
const SPLIT_EMS = 34
const root = ref<HTMLElement>()
const roomy = ref(false)
const chosen = ref<'unified' | 'split' | null>(null)
useResizeObserver(root, ([entry]) => {
  const el = root.value
  if (!el) return
  const em = parseFloat(el.win.getComputedStyle(el).fontSize) || 16
  roomy.value = entry.contentRect.width >= SPLIT_EMS * em
})
const shown = computed(() =>
  props.layout !== 'auto' ? props.layout : (chosen.value ?? (roomy.value ? 'split' : 'unified'))
)

async function toggleContext(): Promise<void> {
  const el = root.value
  // Keep a visible source line at the same height, including when it becomes a fold marker.
  // Compensate only the nearest scroll container so nested dialogs do not move the workspace.
  let scroller = el?.parentElement
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement
  }
  const top = scroller?.getBoundingClientRect().top ?? 0
  const bottom =
    scroller?.getBoundingClientRect().bottom ?? el?.ownerDocument.defaultView?.innerHeight ?? 0
  const anchor = Array.from(
    el?.querySelectorAll<HTMLElement>('.abele-diff__line, .abele-diff__fold') ?? []
  ).find((row) => {
    const box = row.getBoundingClientRect()
    return box.height > 0 && box.top >= top && box.top < bottom
  })
  const lineA = anchor?.dataset.lineA ?? anchor?.dataset.lineStart
  const lineB = anchor?.dataset.lineB
  const offset = anchor?.getBoundingClientRect().top
  rows.value = folded.value ? lines.value.slice() : foldedRows.value.slice()
  await nextTick()
  if (!scroller || offset === undefined || !anchor) return
  const replacement = Array.from(
    el?.querySelectorAll<HTMLElement>('.abele-diff__line, .abele-diff__fold') ?? []
  ).find((row) =>
    lineA
      ? row.dataset.lineA === lineA ||
        (Number(row.dataset.lineStart) <= Number(lineA) &&
          Number(row.dataset.lineEnd) >= Number(lineA))
      : lineB && row.dataset.lineB === lineB
  )
  if (replacement) scroller.scrollTop += replacement.getBoundingClientRect().top - offset
}
const stats = computed(() => ({
  removed: lines.value.filter((l) => l.kind === 'removed').length,
  added: lines.value.filter((l) => l.kind === 'added').length,
}))
// The number column is as wide as the longest number in it, so every line keeps one edge.
const digits = computed(
  () =>
    String(Math.max(props.textLeft.split('\n').length, props.textRight.split('\n').length)).length
)

function unfold(index: number): void {
  const row = rows.value[index]
  if (row?.kind === 'fold') rows.value.splice(index, 1, ...row.lines)
}

function unfoldPair(index: number): void {
  const pair = pairs.value[index]
  const at = rows.value.findIndex((r) => r.kind === 'fold' && r.lines === pair.lines)
  if (at >= 0) unfold(at)
}

const foldLabel = (count: number) =>
  count === 1 ? 'Show 1 unchanged line' : `Show ${count} unchanged lines`

const sign = (line: DiffLine) => (line.kind === 'removed' ? '−' : line.kind === 'added' ? '+' : ' ')

const lineClass = (line: DiffLine) => ({
  'mod-left abele-diff__line_removed': line.kind === 'removed',
  'mod-right abele-diff__line_added': line.kind === 'added',
  'abele-diff__line_same': line.kind === 'same',
})
</script>

<style lang="scss">
// A card like the kit's tables: Obsidian's border and large radius, a header band in its
// secondary background, then the lines. The lines keep Obsidian's own diff colours.
.abele-diff {
  container-type: inline-size;
  min-width: 0;
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-l);
  overflow: hidden;
  background-color: var(--background-primary);
  font-size: var(--font-ui-small);
  line-height: var(--line-height-normal);
  // A grey that sits on a coloured line takes that line's hue, as a shadow does, rather than
  // staying a neutral grey laid over the colour.
  --abele-diff-removed-ink: color-mix(in oklch, var(--text-error) 55%, var(--text-muted));
  --abele-diff-added-ink: color-mix(in oklch, var(--text-success) 55%, var(--text-muted));
}

.abele-diff__header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: baseline;
  gap: var(--size-4-3);
  padding: var(--size-4-2) var(--size-4-3);
  border-bottom: var(--border-width) solid var(--background-modifier-border);
  background-color: var(--background-secondary);
}
.abele-diff__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-normal);
  font-weight: var(--font-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-diff__stats {
  display: flex;
  gap: var(--size-4-2);
  margin-inline-start: auto;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
.abele-diff__actions {
  display: flex;
  align-self: center;
  gap: var(--size-2-1);
  margin-block: calc(-1 * var(--size-2-2));
}
.abele-diff__stat_removed {
  color: var(--text-error);
}
.abele-diff__stat_added {
  color: var(--text-success);
}

.abele-diff__body {
  padding-block: var(--size-4-1);
}

// Numbers, sign, text: the numbers start where the header's title starts.
.abele-diff .abele-diff__line,
.abele-diff .abele-diff__fold {
  display: flex;
  min-width: 0;
  padding-inline: var(--size-4-3);
}
.abele-diff__gutter {
  display: flex;
  flex: 0 0 auto;
  gap: var(--size-4-2);
  margin-inline-end: var(--size-4-2);
  color: var(--text-faint);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
  line-height: calc(var(--line-height-normal) * var(--font-ui-small) / var(--font-ui-smaller));
  user-select: none;
}
.abele-diff__number {
  width: calc(var(--abele-diff-digits) * 1ch);
  text-align: end;
}
.abele-diff__sign {
  flex: 0 0 auto;
  width: var(--size-4-4);
  color: var(--text-faint);
  font-family: var(--font-monospace);
  user-select: none;
}
.abele-diff__text {
  flex: 1 1 auto;
  min-width: 0;
}
// Code reads in the code font, as it does in a code block and in the code view.
.abele-diff_code .abele-diff__text {
  font-family: var(--font-monospace);
}
// A little air between lines, more than the leading inside a wrapped one, so a long line that
// wraps still reads as one line and not as two.
.abele-diff .abele-diff__line {
  padding-block: var(--size-2-1);
}
.abele-diff__line_removed {
  .abele-diff__gutter,
  .abele-diff__sign {
    color: var(--abele-diff-removed-ink);
  }
}
.abele-diff__line_added {
  .abele-diff__gutter,
  .abele-diff__sign {
    color: var(--abele-diff-added-ink);
  }
}

// The changed words one small step above their line. The mark lies over the line's own tint, so
// its alpha adds to the line's: Obsidian's 40% over 20% reads as half-strength colour and
// outshouts the text; 26% makes a bit over a third in all.
.abele-diff.diff-view .abele-diff__line_removed .abele-diff__changed {
  background-color: color-mix(in oklch, var(--background-modifier-error) 26%, transparent);
}
.abele-diff.diff-view .abele-diff__line_added .abele-diff__changed {
  background-color: color-mix(in oklch, var(--background-modifier-success) 26%, transparent);
}

// A folded run is a band across the card: the glyph in the number column, the words on the
// text's edge. Obsidian's own fold is centred text between margins, made for a whole-file modal.
.abele-diff .abele-diff__fold {
  align-items: center;
  margin: var(--size-4-1) 0;
  padding-block: var(--size-4-1);
  background-color: var(--background-secondary);
  font-size: var(--font-ui-smaller);
  text-align: start;

  .abele-diff__gutter {
    justify-content: flex-end;
    // Both number columns and their gap, then the sign column: the label starts on the text.
    width: calc(2 * var(--abele-diff-digits) * 1ch + var(--size-4-2));
    margin-inline-end: calc(var(--size-4-2) + var(--size-4-4));
    color: inherit;
    font-size: inherit;
    line-height: inherit;
  }
  .abele-diff__gutter .abele-obsidian-icon {
    padding: 0;
  }
  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--background-modifier-border-focus);
    outline: none;
  }
}
.abele-diff__body > .abele-diff__fold:first-child {
  margin-top: 0;
}
.abele-diff__body > .abele-diff__fold:last-child {
  margin-bottom: 0;
}

.abele-diff__empty {
  padding: var(--size-4-2) var(--size-4-3);
  color: var(--text-muted);
}

// Side by side: one number column per side, a rule between the sides.
// No band above and below the two columns, so the rule between them meets the labels.
.abele-diff .abele-diff__grid {
  padding-block: 0;
}
.abele-diff__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);

  > .diff-collapsed {
    grid-column: 1 / -1;
  }
  > .abele-diff__line_right {
    border-inline-start: var(--border-width) solid var(--background-modifier-border);
  }
  .abele-diff__fold .abele-diff__gutter {
    width: calc(var(--abele-diff-digits) * 1ch);
  }
}
// The two versions named over their columns, a second band under the header.
.abele-diff__labels {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  border-bottom: var(--border-width) solid var(--background-modifier-border);
  background-color: var(--background-secondary);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-diff__label {
  padding: var(--size-4-1) var(--size-4-3);

  & + & {
    border-inline-start: var(--border-width) solid var(--background-modifier-border);
  }
}

// A narrow place (a chat, the phone): the numbers give their room to the text, and two columns
// fold into one, each change above its replacement.
@container (max-width: 30em) {
  .abele-diff__line .abele-diff__gutter {
    display: none;
  }
  .abele-diff .abele-diff__fold .abele-diff__gutter {
    width: auto;
    margin-inline-end: var(--size-4-2);
  }
  .abele-diff__grid,
  .abele-diff__labels {
    grid-template-columns: minmax(0, 1fr);

    > .abele-diff__line_right {
      border-inline-start: none;
    }
  }
  .abele-diff__line_right.abele-diff__line_same,
  .abele-diff__line_blank,
  .abele-diff__labels {
    display: none;
  }
}
</style>
