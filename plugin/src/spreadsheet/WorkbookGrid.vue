<template>
  <div class="abele-workbook-grid" :data-zoom="zoom">
    <!--
      The bar a spreadsheet app has: where you are (the cell's address, to type another into),
      what is in it (its formula or value), then glyphs for zoom and editing, the sheet last.
    -->
    <div class="abele-workbook-bar">
      <input
        v-model="goAddress"
        class="abele-workbook-address"
        :aria-label="t('streamC.b740c237ed4ab69d')"
        spellcheck="false"
        @keydown.enter="go"
        @blur="goAddress = selected"
      />
      <div class="abele-workbook-formula" :class="{ 'mod-error': selectedCell?.formulaProblem }">
        <span v-if="selectedCell?.formula" class="abele-workbook-fx">fx</span>
        <span class="abele-workbook-formula__text">{{
          inCell
            ? inCellValue
            : selectedCell?.formulaProblem
              ? t('streamC.ae255f9c8846dfbc', { v1: selectedCell.formulaProblem })
              : selectedCell?.formula
                ? selectedCell.formula
                : String(selectedCell?.value ?? '')
        }}</span>
        <span class="abele-workbook-formula__where">{{ selected }}</span>
      </div>
      <div class="abele-workbook-actions">
        <Icon
          icon="zoom-out"
          :tooltip="t('streamC.bc7b631a689b45ca')"
          @click="setZoom(zoom / 1.2)"
        />
        <Icon
          :text-right="`${Math.round(zoom * 100)}%`"
          :label="t('streamC.91a661b24f1bc2bf')"
          :tooltip="t('streamC.91a661b24f1bc2bf')"
          class="abele-workbook-zoom"
          @click="setZoom(1)"
        />
        <Icon
          icon="zoom-in"
          :tooltip="t('streamC.0e47f09a748fa132')"
          @click="setZoom(zoom * 1.2)"
        />
        <template v-if="canEdit">
          <Icon
            icon="pencil"
            :tooltip="t('streamC.e0b23fdfcea011fc')"
            class="abele-workbook-edit"
            :active="editing"
            @click="beginEdit"
          />
          <Icon
            icon="refresh-cw"
            :tooltip="book.stale ? t('streamC.0e74903303a194c7') : t('streamC.84bd94d3c641fc57')"
            :disabled="busy"
            @click="recalculate"
          />
          <Icon
            ref="moreButton"
            icon="more-horizontal"
            :tooltip="t('streamC.f3eb452a0ab58810')"
            :disabled="busy"
            @click="rowMenu"
          />
        </template>
        <Icon
          v-else
          icon="lock"
          no-hover
          :tooltip="book.readOnly ? t('streamC.4bb99e60355e0692') : t('streamC.d7bc1099c9fde3c0')"
          class="abele-workbook-mode"
          :text-right="
            book.readOnly
              ? t('streamC.4bb99e60355e0692')
              : mobile
                ? t('streamC.84e4da5a81f460af')
                : ''
          "
        />
      </div>
      <select
        v-if="book.sheets.length > 1"
        v-model="sheetName"
        class="dropdown abele-workbook-sheet"
        :aria-label="t('streamC.54bf0ebbfb3e0e37')"
        :disabled="busy"
      >
        <option v-for="s in book.sheets" :key="s.name" :value="s.name">
          {{ s.name }}{{ s.hidden ? t('streamC.b8bab1f7e039cd31') : '' }}
        </option>
      </select>
    </div>
    <!-- Said only when there is something to say: an error, a note, values out of date. -->
    <div
      class="abele-workbook-status"
      :class="{ 'mod-error': error }"
      role="status"
      :hidden="!statusText"
    >
      {{ statusText }}
    </div>
    <!-- Changing the cell, under the bar it was chosen in: what it is, its value, and how it looks. -->
    <form v-if="editing && canEdit" class="abele-workbook-editor" @submit.prevent="saveCell">
      <div class="abele-workbook-editor__row">
        <span class="abele-workbook-editor__where">{{ sheetName }}!{{ editAddress }}</span>
        <select v-model="editType" class="dropdown" :aria-label="t('streamC.df3d482d287d96fe')">
          <option value="text">{{ t('settings.ai.AgentEditorModal.text.71988c4d') }}</option>
          <option value="number">{{ t('streamC.bd82cf16699be29e') }}</option>
          <option value="boolean">{{ t('streamC.a066ff921096d0f9') }}</option>
          <option value="formula">{{ t('streamC.d00bd4ec32e4e1cc') }}</option>
          <option value="clear">{{ t('kit.clear') }}</option>
        </select>
        <textarea
          v-model="editValue"
          :aria-label="t('streamC.47840ba055b544b9')"
          rows="1"
          :disabled="editType === 'clear' || busy"
        />
      </div>
      <div class="abele-workbook-editor__row abele-workbook-format">
        <span class="abele-workbook-editor__where">{{ t('streamC.2f343666aaa88c44') }}</span>
        <input
          v-model="formatRange"
          :aria-label="t('streamC.dff9d33a70a638ae')"
          spellcheck="false"
        />
        <Icon
          icon="bold"
          :tooltip="t('settings.reader.stroke.bold')"
          :active="formatBold"
          @click="((formatBold = !formatBold), markFormat('bold'))"
        />
        <Icon
          icon="italic"
          :tooltip="t('streamC.9bf37cb58a694456')"
          :active="formatItalic"
          @click="((formatItalic = !formatItalic), markFormat('italic'))"
        />
        <input
          v-model="formatFill"
          :aria-label="t('streamC.1c298130493715ff')"
          :placeholder="t('streamC.df0f9fbd3d29d55c')"
          spellcheck="false"
          @input="markFormat('fill')"
        />
        <input
          v-model="numberFormat"
          :aria-label="t('streamC.457421f8b5d4c967')"
          spellcheck="false"
          @input="markFormat('number_format')"
        />
        <button type="button" :disabled="busy" @click="saveFormat">
          {{ t('streamC.4d737960f57aaa8c') }}
        </button>
      </div>
      <div class="abele-workbook-editor__foot">
        <button type="button" :disabled="busy" @click="editing = false">
          {{ t('kit.cancel') }}
        </button>
        <button type="submit" class="mod-cta" :disabled="busy">
          {{ t('settings.GithubConnectionEditor.save.1509f561') }}
        </button>
      </div>
    </form>
    <div
      ref="viewport"
      class="abele-workbook-viewport"
      @scroll="scroll"
      @touchstart="startPinch"
      @touchmove="movePinch"
      @touchend="endPinch"
      @touchcancel="endPinch"
    >
      <div
        v-if="sheet"
        class="abele-workbook-space"
        :style="{
          width: canvasWidth + 'px',
          height: canvasHeight + 'px',
          fontSize: `calc(var(--font-ui-small) * ${zoom})`,
        }"
      >
        <div
          v-for="col in visibleColumns"
          :key="'h' + col.column"
          class="abele-workbook-cell abele-workbook-header"
          :style="{
            left: scrollLeft + col.left - logicalX + 'px',
            top: scrollTop + 'px',
            width: col.width + 'px',
            height: rowHeight + 'px',
          }"
        >
          {{ columnName(col.column) }}
        </div>
        <template v-for="row in visibleRows" :key="row">
          <div
            class="abele-workbook-cell abele-workbook-header"
            :style="{
              left: scrollLeft + 'px',
              top: rowTop(row) + 'px',
              width: rowNumberWidth + 'px',
              height: rowHeight + 'px',
            }"
          >
            {{ row }}
          </div>
          <template v-for="cell in rowCells(row)" :key="cell.address">
            <!-- Written in where it stands, as in Excel: the field takes the cell's place. -->
            <input
              v-if="inCell === cell.address"
              ref="inCellField"
              v-model="inCellValue"
              class="abele-workbook-cell abele-workbook-cell__field"
              :data-cell="cell.address"
              :style="cell.css"
              :aria-label="t('streamC.833f5668fbbd72ce', { v1: String(cell.address) })"
              @keydown="inCellKeys"
              @blur="commitInCell()"
            />
            <button
              v-else
              class="abele-workbook-cell"
              :class="{ 'is-selected': selected === cell.address, 'is-frozen': row <= frozen }"
              :data-cell="cell.address"
              :title="cell.formula ? '=' + cell.formula : cell.text"
              :style="cell.css"
              @click="selected = cell.address"
              @dblclick="startInCell()"
              @keydown="cellKeys"
            >
              {{ cell.text }}
            </button>
          </template>
        </template>
      </div>
      <EmptyState
        v-else
        variant="loading"
        icon="sheet"
        :title="t('streamC.9c589978693e846b', { v1: String(sheetName) })"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { t } from '@/i18n'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Menu } from 'obsidian'
import Icon from '../components/obsidian/Icon.vue'
import EmptyState from '../components/obsidian/EmptyState.vue'
import { cellAddress, columnName, contains, parseCell } from './address'
import { formatValue } from './styles'
import type { Workbook, WorkbookSheet } from './package'
import type { CellInput, WorkbookEdit } from './edit'
import type { CellFormat } from './format'
const props = defineProps<{
  book: Workbook
  mobile: boolean
  save?: (edit: WorkbookEdit) => Promise<void>
  initialSheet?: string
  initialAddress?: string
  initialZoom?: number
  context?: (sheet: string, address: string, zoom: number) => void
  editorState?: (open: boolean) => void
}>()
const book = computed(() => props.book)
/** Only what is worth a line: an error, the workbook's note, values that may be out of date. */
const statusText = computed(
  () =>
    error.value ||
    props.book.calculationNote ||
    (props.book.stale ? t('streamC.32f0ac2f6e540bdc') : '')
)
const sheetName = ref(
  props.book.sheets.find((s) => s.name === props.initialSheet)?.name ?? props.book.sheets[0].name
)
const sheet = shallowRef<WorkbookSheet | null>(null)
const error = ref('')
const selected = ref(props.initialAddress ?? 'A1')
const goAddress = ref(selected.value)
const zoom = ref(props.initialZoom ?? 1)
watch(
  [sheetName, selected, zoom],
  ([name, address, scale]) => {
    props.context?.(name, address, scale)
    goAddress.value = address
  },
  { immediate: true }
)
const viewport = ref<HTMLElement>()
const scrollTop = ref(0)
const scrollLeft = ref(0)
const height = ref(600)
const width = ref(800)
const rowHeight = computed(() => 28 * zoom.value)
const rowNumberWidth = computed(() => 48 * zoom.value)
const logicalHeight = computed(() => ((sheet.value?.maxRow ?? 1) + 1) * rowHeight.value)
// WebViews impose physical layout limits; scroll fractions map into the full logical sheet.
const canvasHeight = computed(() => Math.min(8000000, logicalHeight.value))
const canvasWidth = computed(() => Math.min(8000000, totalWidth.value))
const logicalY = computed(() =>
  unmap(scrollTop.value, logicalHeight.value, canvasHeight.value, height.value)
)
const logicalX = computed(() =>
  unmap(scrollLeft.value, totalWidth.value, canvasWidth.value, width.value)
)
function unmap(value: number, logical: number, physical: number, viewportSize: number): number {
  return (value * Math.max(0, logical - viewportSize)) / Math.max(1, physical - viewportSize)
}
function mapScroll(value: number, logical: number, physical: number, viewportSize: number): number {
  const max = Math.max(0, logical - viewportSize)
  return (
    (Math.min(max, Math.max(0, value)) * Math.max(0, physical - viewportSize)) / Math.max(1, max)
  )
}
const frozen = computed(() => Math.min(sheet.value?.frozenRows ?? 0, 1))
let version = 0
watch(
  sheetName,
  async (name) => {
    const v = ++version
    error.value = ''
    sheet.value = null
    try {
      const loaded = await props.book.sheet(name)
      if (version === v) {
        sheet.value = loaded
        if (viewport.value) {
          viewport.value.scrollTop = 0
          viewport.value.scrollLeft = 0
        }
        scrollTop.value = 0
        scrollLeft.value = 0
        go()
      }
    } catch (e) {
      if (v === version) error.value = (e as Error).message
    }
  },
  { immediate: true }
)
const selectedCell = computed(() => sheet.value?.cells.get(selected.value))
const canEdit = computed(
  () => !props.mobile && !props.book.readOnly && !!props.save && !sheet.value?.protected
)
const editing = ref(false)
watch(editing, (open) => props.editorState?.(open), { flush: 'sync' })
const busy = ref(false)
const editType = ref('text')
const editAddress = ref('A1')
const editValue = ref('')
const formatRange = ref('A1')
const formatBold = ref(false)
const formatItalic = ref(false)
const formatFill = ref('')
const numberFormat = ref('General')
const formatChanged = new Set<keyof CellFormat>()
function markFormat(property: keyof CellFormat) {
  formatChanged.add(property)
}
watch(sheetName, () => {
  editing.value = false
  selected.value = 'A1'
})
function beginEdit() {
  const cell = selectedCell.value
  editAddress.value = selected.value
  editType.value =
    cell?.formula !== undefined
      ? 'formula'
      : typeof cell?.value === 'number'
        ? 'number'
        : typeof cell?.value === 'boolean'
          ? 'boolean'
          : 'text'
  editValue.value = cell?.formula ?? String(cell?.value ?? '')
  formatRange.value = selected.value
  formatChanged.clear()
  formatBold.value = cell?.style.bold ?? false
  formatItalic.value = cell?.style.italic ?? false
  formatFill.value = cell?.style.fill ?? ''
  numberFormat.value = cell?.style.numberFormat ?? 'General'
  editing.value = true
}
async function saveFormat() {
  if (!canEdit.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const format: CellFormat = {}
    if (formatChanged.has('bold')) format.bold = formatBold.value
    if (formatChanged.has('italic')) format.italic = formatItalic.value
    if (formatChanged.has('fill')) format.fill = formatFill.value
    if (formatChanged.has('number_format')) format.number_format = numberFormat.value
    if (!formatChanged.size) throw new Error(t('streamC.d09bd58d5d52fd70'))
    await props.save({
      operation: 'format',
      sheet: sheetName.value,
      range: formatRange.value,
      values: [],
      format,
    })
    editing.value = false
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
/** The rarer edits, in a menu under the bar's last glyph. */
function rowMenu(event: MouseEvent) {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.775c0842ed922a81'))
      .setIcon('between-horizontal-end')
      .onClick(() => void changeRow('row_add'))
  )
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.3f663bb099f29f6c'))
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => void changeRow('row_delete'))
  )
  menu.showAtMouseEvent(event)
}

async function changeRow(operation: 'row_add' | 'row_delete') {
  if (!canEdit.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await props.save({
      operation,
      sheet: sheetName.value,
      range: selected.value,
      values: [],
      rows: 1,
    })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function recalculate() {
  if (!canEdit.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await props.save({
      operation: 'recalculate',
      sheet: sheetName.value,
      range: selected.value,
      values: [],
    })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function saveCell() {
  if (!canEdit.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    let value: CellInput = { value: editValue.value }
    if (editType.value === 'formula') value = { formula: editValue.value }
    if (editType.value === 'number') {
      if (!editValue.value.trim() || !Number.isFinite(Number(editValue.value)))
        throw new Error(t('streamC.ac69409ff3df45cf'))
      value = Number(editValue.value)
    }
    if (editType.value === 'boolean') {
      if (!/^(true|false)$/i.test(editValue.value)) throw new Error(t('streamC.b4b35cf46853b453'))
      value = editValue.value.toLowerCase() === 'true'
    }
    if (editType.value === 'clear') value = null
    await props.save({ sheet: sheetName.value, range: editAddress.value, values: [[value]] })
    editing.value = false
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
const columns = computed(() => {
  const result: { column: number; left: number; width: number }[] = []
  let left = rowNumberWidth.value
  for (let column = 1; column <= (sheet.value?.maxColumn ?? 1); column++) {
    const w = (sheet.value?.columnWidths.get(column) ?? 100) * zoom.value
    result.push({ column, left, width: w })
    left += w
  }
  return result
})
const totalWidth = computed(() => {
  const last = columns.value.at(-1)
  return last ? last.left + last.width : 148
})
const visibleColumns = computed(() =>
  columns.value.filter(
    (c) =>
      c.width > 0 &&
      c.left + c.width >= logicalX.value &&
      c.left <= logicalX.value + width.value + 100
  )
)
const visibleRows = computed(() => {
  if (!sheet.value) return []
  const from = Math.max(frozen.value + 1, Math.floor(logicalY.value / rowHeight.value) - 2)
  const to = Math.min(sheet.value.maxRow, from + Math.ceil(height.value / rowHeight.value) + 5)
  const rows = frozen.value ? [1] : []
  for (let row = from; row <= to; row++) rows.push(row)
  // Include merge anchors just outside the viewport so their spanning cell stays visible.
  for (const m of sheet.value.merges)
    if (m.from.row < from && m.to.row >= from && !rows.includes(m.from.row)) rows.push(m.from.row)
  return rows
})
const rowTop = (row: number) =>
  row <= frozen.value
    ? scrollTop.value + rowHeight.value
    : scrollTop.value + row * rowHeight.value - logicalY.value
function rowCells(row: number) {
  const current = sheet.value
  const result = []
  const visibleMerges = current.merges.filter((m) => contains(m, { row, column: m.from.column }))
  const cols = [...visibleColumns.value]
  for (const m of visibleMerges) {
    const anchor = columns.value[m.from.column - 1]
    const end = columns.value[m.to.column - 1]
    if (
      anchor &&
      end &&
      anchor.left < logicalX.value &&
      end.left + end.width >= logicalX.value &&
      !cols.includes(anchor)
    )
      cols.push(anchor)
  }
  for (const col of cols) {
    const merge = visibleMerges.find((m) => contains(m, { row, column: col.column }))
    if (merge && (merge.from.row !== row || merge.from.column !== col.column)) continue
    const address = cellAddress(row, col.column)
    const cell = current.cells.get(address)
    const pending = cell?.formula !== undefined && cell.value === null
    const end = merge ? columns.value[merge.to.column - 1] : col
    result.push({
      address,
      formula: cell?.formula,
      text: pending
        ? t('streamC.6187bb0d6959f72e')
        : formatValue(
            cell?.value ?? null,
            cell?.style.numberFormat ?? 'General',
            props.book.date1904
          ),
      css: {
        left: scrollLeft.value + col.left - logicalX.value + 'px',
        top: rowTop(row) + 'px',
        width: end.left + end.width - col.left + 'px',
        height: (merge ? merge.to.row - row + 1 : 1) * rowHeight.value + 'px',
        fontWeight: cell?.style.bold ? 'bold' : undefined,
        fontStyle: cell?.style.italic ? 'italic' : undefined,
        backgroundColor: cell?.style.fill,
        // Numbers and dates to the right, words to the left, as a spreadsheet app sets them.
        textAlign:
          typeof cell?.value === 'number' || typeof cell?.value === 'boolean'
            ? ('end' as const)
            : undefined,
        zIndex: row <= frozen.value ? 3 : undefined,
      },
    })
  }
  return result
}
/** The cell written in where it stands, and what is in its field. */
const inCell = ref<string | null>(null)
const inCellValue = ref('')
const inCellField = ref<HTMLInputElement[] | HTMLInputElement>()

async function startInCell(typed?: string) {
  if (!canEdit.value || busy.value) return
  const cell = selectedCell.value
  inCell.value = selected.value
  inCellValue.value =
    typed ?? (cell?.formula !== undefined ? '=' + cell.formula : String(cell?.value ?? ''))
  await nextTick()
  const field = Array.isArray(inCellField.value) ? inCellField.value[0] : inCellField.value
  field?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  field?.focus()
  if (typed === undefined) field?.select()
}

/** What is typed is read as Excel reads it: =… a formula, a number, TRUE or FALSE, else text. */
function typedValue(text: string): CellInput {
  if (text.startsWith('=')) return { formula: text.slice(1) }
  if (text.trim() === '') return null
  if (/^(true|false)$/i.test(text.trim())) return text.trim().toLowerCase() === 'true'
  const number = Number(text)
  if (text.trim() !== '' && Number.isFinite(number)) return number
  return { value: text }
}

let committing = false
async function commitInCell(move?: { row: number; column: number }) {
  const address = inCell.value
  if (!address || committing) return
  committing = true
  const before = sheet.value?.cells.get(address)
  const was = before?.formula !== undefined ? '=' + before.formula : String(before?.value ?? '')
  const text = inCellValue.value
  inCell.value = null
  try {
    if (text !== was) {
      busy.value = true
      error.value = ''
      await props.save?.({ sheet: sheetName.value, range: address, values: [[typedValue(text)]] })
    }
    if (move) step(move.row, move.column)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
    committing = false
  }
  focusSelected()
}

function cancelInCell() {
  inCell.value = null
  focusSelected()
}

function step(rows: number, columns: number) {
  const pos = parseCell(selected.value)
  const row = Math.max(1, pos.row + rows)
  const column = Math.max(1, pos.column + columns)
  selected.value = cellAddress(row, column)
}

function focusSelected() {
  void nextTick(() =>
    viewport.value?.querySelector<HTMLElement>(`button[data-cell="${selected.value}"]`)?.focus()
  )
}

/** On a chosen cell: arrows move, Enter or F2 writes in it, a letter starts it afresh. */
function cellKeys(e: KeyboardEvent) {
  const moves: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  }
  if (moves[e.key]) {
    e.preventDefault()
    step(...moves[e.key])
    focusSelected()
  } else if (e.key === 'Enter' || e.key === 'F2') {
    e.preventDefault()
    void startInCell()
  } else if (e.key === 'Tab') {
    e.preventDefault()
    step(0, e.shiftKey ? -1 : 1)
    focusSelected()
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit.value) {
    e.preventDefault()
    inCell.value = selected.value
    inCellValue.value = ''
    void commitInCell()
  } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    void startInCell(e.key)
  }
}

/** In the field: Enter keeps it and goes down, Tab right, Esc leaves the cell as it was. */
function inCellKeys(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    void commitInCell({ row: e.shiftKey ? -1 : 1, column: 0 })
  } else if (e.key === 'Tab') {
    e.preventDefault()
    void commitInCell({ row: 0, column: e.shiftKey ? -1 : 1 })
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelInCell()
  }
}

function scroll() {
  scrollTop.value = viewport.value?.scrollTop ?? 0
  scrollLeft.value = viewport.value?.scrollLeft ?? 0
}
function go() {
  try {
    const pos = parseCell(goAddress.value)
    selected.value = cellAddress(pos.row, pos.column)
    if (viewport.value && sheet.value) {
      viewport.value.scrollTop = mapScroll(
        Math.max(0, Math.min(pos.row, sheet.value.maxRow) - 2) * rowHeight.value,
        logicalHeight.value,
        canvasHeight.value,
        height.value
      )
      viewport.value.scrollLeft = mapScroll(
        (columns.value[Math.min(pos.column, sheet.value.maxColumn) - 1]?.left ??
          rowNumberWidth.value) - rowNumberWidth.value,
        totalWidth.value,
        canvasWidth.value,
        width.value
      )
      scroll()
    }
    error.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}
function setZoom(value: number) {
  zoom.value = Math.round(Math.max(0.5, Math.min(2.5, value)) * 100) / 100
}
let pinch:
  | { distance: number; zoom: number; x: number; y: number; offsetX: number; offsetY: number }
  | undefined
function startPinch(event: TouchEvent) {
  if (event.touches.length !== 2 || !viewport.value) return
  event.preventDefault()
  const [a, b] = [event.touches[0], event.touches[1]]
  const rect = viewport.value.getBoundingClientRect()
  const offsetX = (a.clientX + b.clientX) / 2 - rect.left
  const offsetY = (a.clientY + b.clientY) / 2 - rect.top
  pinch = {
    distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    zoom: zoom.value,
    x: logicalX.value + offsetX,
    y: logicalY.value + offsetY,
    offsetX,
    offsetY,
  }
}
function movePinch(event: TouchEvent) {
  if (event.touches.length !== 2 || !pinch || !pinch.distance) return
  event.preventDefault()
  const state = pinch
  const [a, b] = [event.touches[0], event.touches[1]]
  setZoom((state.zoom * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) / state.distance)
  const ratio = zoom.value / state.zoom
  void nextTick(() => {
    if (!viewport.value) return
    viewport.value.scrollLeft = mapScroll(
      state.x * ratio - state.offsetX,
      totalWidth.value,
      canvasWidth.value,
      width.value
    )
    viewport.value.scrollTop = mapScroll(
      state.y * ratio - state.offsetY,
      logicalHeight.value,
      canvasHeight.value,
      height.value
    )
    scroll()
  })
}
function endPinch() {
  pinch = undefined
}
let observer: ResizeObserver | undefined
onMounted(() => {
  if (viewport.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      height.value = viewport.value.clientHeight || 600
      width.value = viewport.value.clientWidth || 800
    })
    observer.observe(viewport.value)
  }
})
onBeforeUnmount(() => {
  ++version
  observer?.disconnect()
})
</script>
