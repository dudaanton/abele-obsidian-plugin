<template>
  <div
    class="abele-diff diff-view"
    :class="[`abele-diff_${layout}`, { 'abele-diff_empty': !changed }]"
  >
    <div v-if="!changed" class="abele-diff__empty">{{ emptyText }}</div>
    <template v-else-if="layout === 'unified'">
      <template v-for="(row, index) in rows" :key="index">
        <div
          v-if="row.kind === 'fold'"
          class="diff-collapsed abele-diff__fold"
          role="button"
          tabindex="0"
          @click="unfold(index)"
          @keydown.enter.prevent="unfold(index)"
          @keydown.space.prevent="unfold(index)"
        >
          <span class="abele-diff__sign"><Icon icon="unfold-vertical" size="xs" /></span
          >{{ foldLabel(row.lines.length) }}
        </div>
        <div
          v-else
          class="diff-line abele-diff__line"
          :class="lineClass(row)"
          :data-line-a="row.lineA"
          :data-line-b="row.lineB"
        >
          <span class="abele-diff__sign">{{ sign(row) }}</span
          ><span class="abele-diff__text"
            ><span
              v-for="(piece, p) in row.pieces"
              :key="p"
              :class="{ 'diff-changed abele-diff__changed': piece.changed && row.kind !== 'same' }"
              >{{ piece.text }}</span
            ></span
          >
        </div>
      </template>
    </template>
    <div v-else class="abele-diff__grid">
      <div v-if="labelBefore || labelAfter" class="abele-diff__label">{{ labelBefore }}</div>
      <div v-if="labelBefore || labelAfter" class="abele-diff__label">{{ labelAfter }}</div>
      <template v-for="(pair, index) in pairs" :key="index">
        <div
          v-if="pair.kind === 'fold'"
          class="diff-collapsed abele-diff__fold"
          role="button"
          tabindex="0"
          @click="unfoldPair(index)"
          @keydown.enter.prevent="unfoldPair(index)"
          @keydown.space.prevent="unfoldPair(index)"
        >
          <span class="abele-diff__sign"><Icon icon="unfold-vertical" size="xs" /></span
          >{{ foldLabel(pair.lines?.length ?? 0) }}
        </div>
        <template v-else>
          <div
            v-for="side in ['left', 'right'] as const"
            :key="side"
            class="diff-line abele-diff__line"
            :class="[
              `abele-diff__line_${side}`,
              pair[side] ? lineClass(pair[side]!) : 'abele-diff__line_blank',
            ]"
          >
            <template v-if="pair[side]">
              <span class="abele-diff__sign">{{ sign(pair[side]!) }}</span
              ><span class="abele-diff__text"
                ><span
                  v-for="(piece, p) in pair[side]!.pieces"
                  :key="p"
                  :class="{
                    'diff-changed abele-diff__changed':
                      piece.changed && pair[side]!.kind !== 'same',
                  }"
                  >{{ piece.text }}</span
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
// A sign before each line says the same without colour.
import { computed, ref, watch } from 'vue'
import { diffLines, foldUnchanged, pairRows, type DiffLine, type DiffRow } from './diffModel'
import Icon from './obsidian/Icon.vue'

const props = withDefaults(
  defineProps<{
    /** The text as it was. */
    textLeft: string
    /** The text as it is now, or would be. */
    textRight: string
    /** One column, as Obsidian shows it; or the two versions side by side, for a wide place. */
    layout?: 'unified' | 'split'
    /** Unchanged lines kept around each change before the rest folds away. */
    context?: number
    /** Column headings for the side-by-side layout. */
    labelBefore?: string
    labelAfter?: string
    /** Said in place of the comparison when the two texts are the same. */
    emptyText?: string
  }>(),
  {
    layout: 'unified',
    context: 3,
    labelBefore: undefined,
    labelAfter: undefined,
    emptyText: 'No changes',
  }
)

const lines = computed(() => diffLines(props.textLeft, props.textRight))
const changed = computed(() => lines.value.some((l) => l.kind !== 'same'))
const rows = ref<DiffRow[]>([])
watch(
  [lines, () => props.context],
  () => {
    rows.value = foldUnchanged(lines.value, props.context)
  },
  { immediate: true }
)
const pairs = computed(() => pairRows(rows.value))

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
.abele-diff {
  container-type: inline-size;
  min-width: 0;
  font-size: var(--font-ui-small);
  line-height: var(--line-height-normal);
}

// Obsidian's line pads the text on both sides; the sign sits in the first of those pads.
.abele-diff .abele-diff__line {
  display: flex;
  min-width: 0;
  padding-inline: var(--size-4-1) var(--size-4-2);
}
.abele-diff__sign {
  flex: 0 0 auto;
  width: var(--size-4-5);
  color: var(--text-muted);
  font-family: var(--font-monospace);
  user-select: none;
}
.abele-diff__text {
  flex: 1 1 auto;
  min-width: 0;
}
// Obsidian spaces its fold for a whole-file modal; inside a card or a chat it keeps closer.
.abele-diff .abele-diff__fold {
  margin-block: var(--size-4-1);
  // Laid out as a line: the unfold glyph in the sign column, the words on the text's left edge.
  display: flex;
  align-items: center;
  padding-inline: var(--size-4-1) var(--size-4-2);
  text-align: start;

  .abele-diff__sign {
    display: flex;
    color: inherit;
  }
  .abele-diff__sign .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-diff__empty {
  color: var(--text-muted);
}

.abele-diff__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: var(--size-4-1);

  > .diff-collapsed {
    grid-column: 1 / -1;
  }
}
.abele-diff__label {
  padding: 0 var(--size-4-2) var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

// Too narrow for two columns: each change stands above its replacement, and an unchanged line
// is shown once.
@container (max-width: 30em) {
  .abele-diff__grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .abele-diff__line_right.abele-diff__line_same,
  .abele-diff__line_blank,
  .abele-diff__label {
    display: none;
  }
}
</style>
