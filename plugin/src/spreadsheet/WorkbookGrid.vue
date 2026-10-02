<template>
  <div class="abele-workbook-grid" :data-zoom="zoom">
    <div class="abele-workbook-bar">
      <label
        >Sheet
        <select v-model="sheetName" aria-label="Sheet" :disabled="busy">
          <option v-for="s in book.sheets" :key="s.name" :value="s.name">
            {{ s.name }}{{ s.hidden ? ' (hidden)' : '' }}
          </option>
        </select></label
      >
      <label
        >Cell <input v-model="goAddress" aria-label="Cell address" @keydown.enter="go"
      /></label>
      <button @click="go">Go</button>
      <button aria-label="Zoom out" @click="setZoom(zoom / 1.2)">−</button>
      <button aria-label="Reset zoom" @click="setZoom(1)">{{ Math.round(zoom * 100) }}%</button>
      <button aria-label="Zoom in" @click="setZoom(zoom * 1.2)">+</button>
      <button v-if="canEdit" class="abele-workbook-edit" @click="beginEdit">Edit cell</button>
      <button v-if="canEdit" :disabled="busy" @click="recalculate">Recalculate</button>
      <button v-if="canEdit" :disabled="busy" @click="changeRow('row_add')">Append row</button>
      <button v-if="canEdit" :disabled="busy" @click="changeRow('row_delete')">
        Delete last row
      </button>
      <span>{{
        book.readOnly
          ? 'Read-only workbook'
          : mobile
            ? 'View and agent editing'
            : 'Cached workbook values'
      }}</span>
    </div>
    <div class="abele-workbook-status" role="status">
      {{
        error ||
        book.calculationNote ||
        (book.stale
          ? 'Values may be stale. Recalculation is required.'
          : 'Formula results are cached from the spreadsheet app.')
      }}
    </div>
    <div class="abele-workbook-formula">
      {{ selected }}
      {{
        selectedCell?.formulaProblem
          ? '[Formula unavailable: ' + selectedCell.formulaProblem + ']'
          : selectedCell?.formula
            ? '= ' + selectedCell.formula
            : String(selectedCell?.value ?? '')
      }}
    </div>
    <form v-if="editing && canEdit" class="abele-workbook-editor" @submit.prevent="saveCell">
      <span>{{ sheetName }}!{{ editAddress }}</span>
      <label
        >Type
        <select v-model="editType" aria-label="Cell type">
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
          <option value="formula">Formula</option>
          <option value="clear">Clear</option>
        </select></label
      >
      <label
        >Value
        <textarea
          v-model="editValue"
          aria-label="Cell value"
          :disabled="editType === 'clear' || busy"
        />
      </label>
      <button type="submit" :disabled="busy">Save</button>
      <fieldset class="abele-workbook-format">
        <legend>Cell formatting</legend>
        <label>Range <input v-model="formatRange" aria-label="Formatting range" /></label>
        <label
          ><input
            v-model="formatBold"
            type="checkbox"
            aria-label="Bold"
            @change="markFormat('bold')"
          />Bold</label
        >
        <label
          ><input
            v-model="formatItalic"
            type="checkbox"
            aria-label="Italic"
            @change="markFormat('italic')"
          />Italic</label
        >
        <label
          >Fill
          <input
            v-model="formatFill"
            aria-label="Fill colour"
            placeholder="#RRGGBB or empty"
            @input="markFormat('fill')"
        /></label>
        <label
          >Number format
          <input
            v-model="numberFormat"
            aria-label="Number format"
            @input="markFormat('number_format')"
        /></label>
        <button type="button" :disabled="busy" @click="saveFormat">Apply formatting</button>
      </fieldset>
      <button type="button" :disabled="busy" @click="editing = false">Cancel</button>
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
          <button
            v-for="cell in rowCells(row)"
            :key="cell.address"
            class="abele-workbook-cell"
            :class="{ 'is-selected': selected === cell.address, 'is-frozen': row <= frozen }"
            :data-cell="cell.address"
            :title="cell.formula ? '=' + cell.formula : cell.text"
            :style="cell.css"
            @click="selected = cell.address"
          >
            {{ cell.text }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
    if (!formatChanged.size) throw new Error('Choose a formatting change first')
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
        throw new Error('Enter a finite number')
      value = Number(editValue.value)
    }
    if (editType.value === 'boolean') {
      if (!/^(true|false)$/i.test(editValue.value)) throw new Error('Enter TRUE or FALSE')
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
        ? '(pending)'
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
        zIndex: row <= frozen.value ? 3 : undefined,
      },
    })
  }
  return result
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
