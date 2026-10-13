<template>
  <table class="abele-word-page__table">
    <tbody>
      <tr v-for="(row, r) in table.rows" :key="r">
        <td
          v-for="cell in tableCells(row)"
          :key="cell.number"
          :colspan="cell.colSpan"
          :rowspan="cell.rowSpan"
        >
          <template v-for="p in cell.paragraphs" :key="p.number">
            <WordPageTable
              v-for="nested in p.beforeTables"
              :key="nested.number"
              v-bind="shared"
              :table="nested"
              v-on="forward"
            />
            <WordPageLine
              :paragraph="p"
              :marker="markers.get(p.number)"
              :editing="editing === p.number"
              :draft="draft"
              :read-only="readOnly"
              @open="emit('open', p)"
              @keys="emit('keys', $event)"
              @leave="emit('leave')"
              @input="emit('input', $event)"
              @select="emit('select', $event)"
            />
            <figure
              v-for="image in p.images"
              :key="image.number"
              class="abele-word-page__image"
              :tabindex="readOnly ? undefined : 0"
              :aria-label="`Select picture paragraph ${p.number}`"
              @click="emit('picture', p.number)"
              @keydown.enter.prevent="emit('picture', p.number)"
              @keydown.space.prevent="emit('picture', p.number)"
            >
              <img :src="image.src" :alt="image.alt" :width="image.width" :height="image.height" />
            </figure>
            <WordPageTable
              v-for="nested in p.afterTables"
              :key="nested.number"
              v-bind="shared"
              :table="nested"
              v-on="forward"
            />
          </template>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import WordPageLine from './WordPageLine.vue'
import { tableCells, type WordPageParagraph, type WordPageTable } from './pageModel'
const props = defineProps<{
  table: WordPageTable
  markers: Map<number, string>
  editing: number | null
  draft: string
  readOnly: boolean
}>()
const emit = defineEmits<{
  open: [paragraph: WordPageParagraph]
  keys: [event: KeyboardEvent]
  leave: []
  input: [text: string]
  select: [range: { from: number; to: number }]
  picture: [paragraph: number]
}>()
const shared = computed(() => ({
  markers: props.markers,
  editing: props.editing,
  draft: props.draft,
  readOnly: props.readOnly,
}))
const forward = {
  open: (p: WordPageParagraph) => emit('open', p),
  keys: (event: KeyboardEvent) => emit('keys', event),
  leave: () => emit('leave'),
  input: (text: string) => emit('input', text),
  select: (range: { from: number; to: number }) => emit('select', range),
  picture: (paragraph: number) => emit('picture', paragraph),
}
</script>
