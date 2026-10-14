<template>
  <!-- What the ribbon has no room for, about the one thing chosen on the page: a picture's size,
       a cell's row and merges, a paragraph's links and joining it with the next. Obsidian's own
       settings rows, the actions as glyphs; read only, the same rows say what is there. -->
  <div class="abele-word-details">
    <div v-if="readOnly" class="setting-item-description abele-word-details__lead">
      Read only: {{ readOnly }}
    </div>
    <div v-else-if="paragraph?.locked" class="setting-item-description abele-word-details__lead">
      Word keeps this paragraph as it is; change it in Word.
    </div>

    <template v-for="picture in pictures" :key="picture.number">
      <Setting
        :name="pictures.length > 1 ? `Picture ${picture.number}` : 'Size'"
        :desc="
          readOnly ? `${picture.width} × ${picture.height} px` : 'In pixels, as Word lays it out'
        "
      >
        <template v-if="!readOnly">
          <span class="abele-word-details__size">
            <Input
              class="abele-word-details__number"
              type="number"
              :model-value="String(sizes[picture.number]?.width ?? picture.width)"
              aria-label="Width in pixels"
              @update:model-value="resize(picture, 'width', $event)"
              @commit="commitSize(picture)"
            />
            <span class="abele-word-details__by" aria-hidden="true">×</span>
            <Input
              class="abele-word-details__number"
              type="number"
              :model-value="String(sizes[picture.number]?.height ?? picture.height)"
              aria-label="Height in pixels"
              @update:model-value="resize(picture, 'height', $event)"
              @commit="commitSize(picture)"
            />
          </span>
          <Icon
            :icon="keepRatio ? 'lock' : 'lock-open'"
            :tooltip="
              keepRatio ? 'Width and height change together' : 'Width and height change apart'
            "
            :active="keepRatio"
            @click="keepRatio = !keepRatio"
          />
        </template>
      </Setting>
      <Setting
        v-if="!readOnly"
        :name="picture.alt || `Picture ${picture.number}`"
        desc="Put another picture from the vault in its place, or take this one out"
      >
        <Icon
          icon="replace"
          tooltip="Replace with a picture from the vault"
          @click="emit('pickImage', { paragraph: picture.paragraph, image: picture.number })"
        />
        <Icon
          icon="trash-2"
          tooltip="Delete this picture"
          @click="edit('image_delete', { image: picture.number }, picture.paragraph)"
        />
      </Setting>
    </template>

    <template v-if="cell">
      <Setting
        :name="`Row ${cell.row}`"
        :desc="
          readOnly
            ? `${cell.rows} rows, ${cell.columns} columns`
            : 'Of a table with ' + cell.rows + ' rows'
        "
      >
        <template v-if="!readOnly">
          <Icon
            icon="between-horizontal-end"
            tooltip="Add a row below"
            @click="edit('row_add', where())"
          />
          <Icon
            icon="trash-2"
            :tooltip="
              cell.rows > 1 ? 'Delete this row' : 'Delete this row: the table has only this one'
            "
            :disabled="cell.rows <= 1"
            @click="edit('row_delete', where())"
          />
        </template>
      </Setting>
      <Setting :name="`Cell in column ${cell.column}`" :desc="spanText">
        <template v-if="!readOnly">
          <Icon
            icon="arrow-right-to-line"
            :tooltip="
              mergeRight
                ? 'Merge with the cell to the right'
                : 'Merge with the cell to the right: this is the last column'
            "
            :disabled="!mergeRight"
            @click="
              mergeRight &&
              edit('cells_merge', { ...where(), to_row: cell.row, to_column: mergeRight })
            "
          />
          <Icon
            icon="arrow-down-to-line"
            :tooltip="
              mergeDown
                ? 'Merge with the cell below'
                : 'Merge with the cell below: this is the last row'
            "
            :disabled="!mergeDown"
            @click="
              mergeDown &&
              edit('cells_merge', { ...where(), to_row: mergeDown, to_column: cell.column })
            "
          />
          <Icon
            icon="table-cells-split"
            :tooltip="merged ? 'Split back into single cells' : 'Split: this cell is a single one'"
            :disabled="!merged"
            @click="merged && edit('cells_split', where())"
          />
        </template>
      </Setting>
    </template>

    <template v-if="paragraph && !paragraph.locked && !pictureOnly">
      <Setting
        v-for="link in links"
        :key="link.from"
        :name="link.text"
        :desc="readOnly ? link.url : 'Link'"
      >
        <template v-if="!readOnly">
          <Input
            class="abele-word-details__url"
            type="text"
            :model-value="urls[link.from] ?? link.url"
            :aria-label="`Address of the link on ${link.text}`"
            @update:model-value="urls[link.from] = $event"
            @commit="relink(link)"
          />
          <Icon icon="unlink" tooltip="Remove the link, keep the words" @click="unlink(link)" />
        </template>
      </Setting>
      <Setting v-if="!readOnly" name="Join with the next paragraph" :desc="joinText">
        <Icon
          icon="merge"
          :tooltip="
            next ? 'Join the next paragraph onto this one' : `Join: ${joinText.toLowerCase()}`
          "
          :disabled="!next"
          @click="next && edit('paragraph_merge', {})"
        />
      </Setting>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import Setting from '@/components/obsidian/Setting.vue'
import Input from '@/components/obsidian/Input.vue'
import Icon from '@/components/obsidian/Icon.vue'
import {
  allParagraphs,
  paragraphText,
  tableCells,
  type WordPageBlock,
  type WordPageEdit,
  type WordPageImage,
  type WordPageModel,
  type WordPageParagraph,
  type WordPageTable,
} from './pageModel'

const props = defineProps<{
  model: WordPageModel
  /** The paragraph chosen on the page; a picture is chosen through the paragraph it stands in. */
  paragraph: number
  /** A picture was chosen rather than the words: only the picture's rows are shown. */
  pictureOnly?: boolean
  /** Why nothing can be changed, when nothing can: the rows then only say what is there. */
  readOnly?: string
}>()
const emit = defineEmits<{
  edit: [edit: WordPageEdit]
  pickImage: [at: { paragraph: number; image: number }]
}>()

const all = computed(() => allParagraphs(props.model))
const paragraph = computed(() => all.value.find((p) => p.number === props.paragraph))

const pictures = computed<WordPageImage[]>(() => {
  const out: WordPageImage[] = []
  const visit = (blocks: WordPageBlock[]) => {
    for (const block of blocks) {
      if (block.kind === 'image' && block.paragraph === props.paragraph) out.push(block)
      if (block.kind === 'table')
        for (const p of block.rows.flat()) {
          out.push(...(p.images ?? []).filter((i) => i.paragraph === props.paragraph))
          visit(p.beforeTables ?? [])
          visit(p.afterTables ?? [])
        }
    }
  }
  visit(props.model.blocks)
  return out
})

/** Where the paragraph stands in a table: row and grid column from 1, and the table's size. */
const cell = computed(() => {
  const find = (blocks: WordPageBlock[]): ReturnType<typeof place> | undefined => {
    for (const block of blocks) {
      if (block.kind !== 'table') continue
      const here = place(block)
      if (here) return here
      for (const p of block.rows.flat()) {
        const inner = find([...(p.beforeTables ?? []), ...(p.afterTables ?? [])])
        if (inner) return inner
      }
    }
    return undefined
  }
  return find(props.model.blocks)
})
function place(table: WordPageTable) {
  const columns = Math.max(
    ...table.rows.map((row) => tableCells(row).reduce((n, c) => n + c.colSpan, 0))
  )
  for (const [r, row] of table.rows.entries()) {
    let column = 1
    for (const c of tableCells(row)) {
      if (c.paragraphs.some((p) => p.number === props.paragraph))
        return {
          table: table.number,
          row: r + 1,
          column,
          colSpan: c.colSpan,
          rowSpan: c.rowSpan,
          rows: table.rows.length,
          columns,
          paragraphs: c.paragraphs.map((p) => p.number),
        }
      column += c.colSpan
    }
  }
  return undefined
}
const merged = computed(() => !!cell.value && (cell.value.colSpan > 1 || cell.value.rowSpan > 1))
const mergeRight = computed(() => {
  const c = cell.value
  return c && c.column + c.colSpan <= c.columns ? c.column + c.colSpan : 0
})
const mergeDown = computed(() => {
  const c = cell.value
  return c && c.row + c.rowSpan <= c.rows ? c.row + c.rowSpan : 0
})
const spanText = computed(() => {
  const c = cell.value
  if (!c || !merged.value) return 'A single cell'
  const parts = [
    c.colSpan > 1 ? `${c.colSpan} columns` : '',
    c.rowSpan > 1 ? `${c.rowSpan} rows` : '',
  ].filter(Boolean)
  return `Merged across ${parts.join(' and ')}`
})
const where = () => {
  const c = cell.value
  return c ? { table: c.table, row: c.row, column: c.column } : {}
}

/** The links in the paragraph, each a stretch of words with one address. */
const links = computed(() => {
  const out: { text: string; url: string; from: number; to: number }[] = []
  let at = 0
  for (const run of paragraph.value?.runs ?? []) {
    const last = out[out.length - 1]
    if (run.link && last && last.url === run.link && last.to === at) {
      last.text += run.text
      last.to += run.text.length
    } else if (run.link)
      out.push({ text: run.text, url: run.link, from: at, to: at + run.text.length })
    at += run.text.length
  }
  return out
})
const urls = reactive<Record<number, string>>({})
/** Enter and leaving the field both commit; one value is sent once. */
const sent: Record<string, string> = {}
const relink = (link: { from: number; to: number; url: string }) => {
  const url = urls[link.from]?.trim()
  if (!url || url === link.url || sent[`link ${link.from}`] === url) return
  sent[`link ${link.from}`] = url
  edit('link', { from: link.from, to: link.to, url })
}
const unlink = (link: { from: number; to: number }) =>
  edit('link', { from: link.from, to: link.to, url: '' })

/** The paragraph after this one, when the two can be joined: in the same cell, or both outside
 *  any table, and both changeable. */
const next = computed<WordPageParagraph | undefined>(() => {
  const at = all.value.findIndex((p) => p.number === props.paragraph)
  const after = at >= 0 ? all.value[at + 1] : undefined
  if (!after || after.locked) return undefined
  const together = cell.value
    ? cell.value.paragraphs.includes(after.number)
    : props.model.blocks.includes(after)
  return together ? after : undefined
})
const joinText = computed(() => {
  if (next.value) {
    const words = paragraphText(next.value)
    return words
      ? `«${words.length > 40 ? words.slice(0, 40) + '…' : words}» moves up onto its end`
      : 'The empty one after it goes'
  }
  const at = all.value.findIndex((p) => p.number === props.paragraph)
  const after = all.value[at + 1]
  if (!after) return 'This is the last paragraph'
  if (after.locked) return 'Word keeps the next one as it is'
  return cell.value ? 'This is the last paragraph in the cell' : 'The next one is in a table'
})

const keepRatio = ref(true)
const sizes = reactive<Record<number, { width: number; height: number }>>({})
const resize = (picture: WordPageImage, side: 'width' | 'height', value: string) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < 1) return
  const was = sizes[picture.number] ?? { width: picture.width, height: picture.height }
  const ratio = picture.height / picture.width
  sizes[picture.number] =
    side === 'width'
      ? { width: n, height: keepRatio.value ? Math.max(1, Math.round(n * ratio)) : was.height }
      : { width: keepRatio.value ? Math.max(1, Math.round(n / ratio)) : was.width, height: n }
}
const commitSize = (picture: WordPageImage) => {
  const size = sizes[picture.number]
  if (!size || (size.width === picture.width && size.height === picture.height)) return
  const key = `${size.width}×${size.height}`
  if (sent[`picture ${picture.number}`] === key) return
  sent[`picture ${picture.number}`] = key
  edit('image_resize', { image: picture.number, ...size }, picture.paragraph)
}

function edit(
  operation: WordPageEdit['operation'],
  more: Partial<WordPageEdit>,
  paragraphNumber = props.paragraph
) {
  if (props.readOnly) return
  emit('edit', { operation, paragraph: paragraphNumber, ...more })
}
</script>

<style lang="scss">
.abele-word-details__lead {
  margin-bottom: var(--size-4-2);
}

.abele-word-details__size {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-2);
}

.abele-word-details__number {
  width: 6em;
}

.abele-word-details__by {
  color: var(--text-muted);
}

.abele-word-details__url {
  flex: 1 1 12em;
}
</style>
