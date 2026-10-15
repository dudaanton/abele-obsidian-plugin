<template>
  <div class="abele-word-editor">
    <Input
      ref="field"
      v-model="text"
      as-text-area
      :aria-label="`Edit paragraph ${paragraph.number}`"
      :disabled="!paragraph.editable || readOnly"
    />
    <div role="status">{{ status }}</div>
    <Button
      text="Save"
      accent
      tooltip="Save the paragraph text"
      :disabled="!paragraph.editable || readOnly || busy"
      @click="run(paragraphTextEdit(paragraph, currentText()), true)"
    />
    <Button text="Cancel" tooltip="Close without saving" :disabled="busy" @click="cancel" />

    <template v-if="paragraph.editable">
      <div class="setting-item-description">
        Select text above to format it or add a link. With no selection, the whole paragraph is
        used.
      </div>
      <Section class="abele-word-editor-section">
        <strong class="abele-word-editor-label">Formatting</strong>
        <Button
          v-for="item in FORMATS"
          :key="item.name"
          :text="item.label"
          :tooltip="item.tooltip"
          :disabled="locked"
          @click="run(format(item.name, item.property))"
        />
        <Dropdown
          v-model="style"
          :options="styles"
          aria-label="Paragraph style"
          :disabled="readOnly"
        />
        <Button
          text="Apply style"
          tooltip="Give the paragraph the chosen style"
          :disabled="locked"
          @click="run({ ...base('style'), style_id: style })"
        />
        <Dropdown v-model="list" :options="LISTS" aria-label="List kind" :disabled="readOnly" />
        <Button
          text="Apply list"
          tooltip="Make the paragraph the chosen kind of list item"
          :disabled="locked"
          @click="run({ ...base('list'), list: list as WordEdit['list'] })"
        />
      </Section>
      <Section class="abele-word-editor-section">
        <strong class="abele-word-editor-label">Paragraphs</strong>
        <Input
          v-model="added"
          aria-label="New paragraph text"
          placeholder="New paragraph text"
          :disabled="readOnly"
        />
        <Button
          text="Add paragraph below"
          tooltip="Add a paragraph with this text after this one"
          :disabled="locked"
          @click="run({ ...base('paragraph_add'), text: added })"
        />
        <Button
          text="Split at cursor"
          tooltip="Split the paragraph in two where the cursor is"
          :disabled="locked"
          @click="run({ ...base('paragraph_split'), offset: fieldEl()?.selectionStart ?? 0 })"
        />
        <Button
          text="Merge with next"
          tooltip="Join the next paragraph onto this one"
          :disabled="locked"
          @click="run(base('paragraph_merge'))"
        />
        <Button
          text="Delete paragraph"
          tooltip="Delete this paragraph"
          :disabled="locked"
          @click="run(base('paragraph_delete'))"
        />
      </Section>
      <Section class="abele-word-editor-section">
        <strong class="abele-word-editor-label">Links</strong>
        <Input
          v-model="url"
          aria-label="Link URL"
          placeholder="Link address"
          :disabled="readOnly"
        />
        <Button
          text="Apply link"
          tooltip="Link the selected words to this address"
          :disabled="locked"
          @click="run({ ...base('link'), ...range(), url })"
        />
        <Button
          text="Remove link"
          tooltip="Take the link off the selected words"
          :disabled="locked"
          @click="run({ ...base('link'), ...range(), url: '' })"
        />
      </Section>
    </template>
    <div v-else class="setting-item-description">
      This paragraph contains read-only structure. Inline images can still be selected below.
    </div>

    <Section v-if="paragraph.table && paragraph.editable" class="abele-word-editor-section">
      <strong class="abele-word-editor-label">Table {{ paragraph.table }}</strong>
      <label v-for="item in cellFields" :key="item.label">
        {{ item.label }}
        <Input
          v-model="cellValues[item.key]"
          class="abele-word-editor__number"
          type="number"
          min="1"
          :aria-label="item.label"
          :disabled="readOnly"
        />
      </label>
      <Button
        text="Add row below"
        tooltip="Add a table row below this one"
        :disabled="locked"
        @click="run({ ...base('row_add'), ...cell() })"
      />
      <Button
        text="Delete row"
        tooltip="Delete this table row"
        :disabled="locked"
        @click="run({ ...base('row_delete'), ...cell() })"
      />
      <Button
        text="Merge cells"
        tooltip="Merge the cells up to the last row and column"
        :disabled="locked"
        @click="
          run({
            ...base('cells_merge'),
            ...cell(),
            to_row: Number(cellValues.lastRow),
            to_column: Number(cellValues.lastColumn),
          })
        "
      />
      <Button
        text="Split cells"
        tooltip="Split merged cells apart again"
        :disabled="locked"
        @click="run({ ...base('cells_split'), ...cell() })"
      />
    </Section>

    <Section v-if="!paragraph.protected" class="abele-word-editor-section">
      <strong class="abele-word-editor-label">Inline images</strong>
      <Dropdown v-model="picture" :options="pictures" aria-label="Image" :disabled="readOnly" />
      <Input
        ref="pathField"
        v-model="path"
        aria-label="Vault image path"
        placeholder="Vault image path"
        :disabled="readOnly"
      />
      <label v-for="item in sizeFields" :key="item.label">
        {{ item.label }}
        <Input
          v-model="size[item.key]"
          class="abele-word-editor__number"
          type="number"
          min="1"
          :aria-label="item.label"
          :disabled="readOnly"
        />
      </label>
      <Button
        text="Insert image"
        tooltip="Insert the vault image at the cursor, or at the end"
        :disabled="locked"
        @click="run({ ...base('image_insert'), ...image(), offset: insertAt() })"
      />
      <Button
        text="Replace image"
        tooltip="Put the vault image in place of the chosen one"
        :disabled="locked"
        @click="run({ ...base('image_replace'), ...image() })"
      />
      <Button
        text="Resize image"
        tooltip="Give the chosen image this width and height"
        :disabled="locked"
        @click="run({ ...base('image_resize'), ...image() })"
      />
      <Button
        text="Delete image"
        tooltip="Delete the chosen image"
        :disabled="locked"
        @click="run({ ...base('image_delete'), ...image() })"
      />
    </Section>
  </div>
</template>

<script setup lang="ts">
// Plain desktop fields acting on the package's own operations, one group per subject. Each
// button sends one edit to the host, which saves it and redraws the page.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import Button from '@/components/obsidian/Button.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Input from '@/components/obsidian/Input.vue'
import Section from '@/components/obsidian/Section.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import type { DesktopEditHost } from './desktopEditor'
import type { WordEdit } from './edit'
import type { WordPackage, WordParagraph } from './package'
import { paragraphTextEdit } from './textEditor'
import { attr, child } from './xml'

const props = defineProps<{
  doc: WordPackage
  paragraph: WordParagraph
  host: DesktopEditHost
}>()

const FORMATS = [
  { name: 'bold', label: 'Bold', property: 'b', tooltip: 'Bold the selected words' },
  { name: 'italic', label: 'Italic', property: 'i', tooltip: 'Italicise the selected words' },
  { name: 'underline', label: 'Underline', property: 'u', tooltip: 'Underline the selected words' },
  {
    name: 'strike',
    label: 'Strikethrough',
    property: 'strike',
    tooltip: 'Strike through the selected words',
  },
] as const
const LISTS = [
  { value: 'none', display: 'No list' },
  { value: 'bullet', display: 'Bulleted list' },
  { value: 'decimal', display: 'Numbered list' },
]

const readOnly = computed(() => !!props.host.readOnly)
/** An edit is with the host: every button waits, as a second press would send it twice. */
const busy = ref(false)
const locked = computed(() => readOnly.value || busy.value)
const status = ref('')

const field = ref<InstanceType<typeof Input>>()
const pathField = ref<InstanceType<typeof Input>>()
const fieldEl = () => field.value?.inputRef as HTMLTextAreaElement | undefined
/** What the field holds now, read off the field itself rather than the last input event. */
const currentText = () => fieldEl()?.value ?? text.value

const text = ref(props.paragraph.text)
const styles = props.doc.styles.map((s) => ({ value: s.id, display: s.name || s.id }))
// A style the document does not define selects nothing, as a native select does.
const style = ref(
  props.paragraph.style
    ? styles.some((s) => s.value === props.paragraph.style)
      ? props.paragraph.style
      : ''
    : (styles[0]?.value ?? '')
)
const list = ref('none')
const added = ref('')
const url = ref(props.doc.links.find((l) => l.paragraph === props.paragraph.number)?.url ?? '')

const cellFields = [
  { key: 'row', label: 'Row' },
  { key: 'column', label: 'Grid column' },
  { key: 'lastRow', label: 'Last row' },
  { key: 'lastColumn', label: 'Last column' },
] as const
const cellValues = reactive({
  row: String(props.paragraph.row ?? 1),
  column: String(props.paragraph.cell ?? 1),
  lastRow: String(props.paragraph.row ?? 1),
  lastColumn: String(props.paragraph.cell ?? 1),
})
const cell = () => ({
  table: props.paragraph.table,
  row: Number(cellValues.row),
  column: Number(cellValues.column),
})

const pictures = [
  { value: '0', display: 'New image' },
  ...props.doc.images
    .filter((i) => i.paragraph === props.paragraph.number)
    .map((i) => ({
      value: String(i.number),
      display: `Image ${i.number}${i.inline ? '' : ' (floating, read-only)'}`,
    })),
]
const picture = ref('0')
const path = ref('')
const sizeFields = [
  { key: 'width', label: 'Width (px)' },
  { key: 'height', label: 'Height (px)' },
] as const
const size = reactive({ width: '120', height: '80' })
// Choosing an existing picture starts from its own size; a new one keeps what was typed.
watch(picture, (value) => {
  const chosen = props.doc.images.find((i) => i.number === Number(value))
  if (chosen) {
    size.width = String(chosen.width)
    size.height = String(chosen.height)
  }
})
const image = () => ({
  image: Number(picture.value),
  image_path: path.value,
  width: Number(size.width),
  height: Number(size.height),
})

const base = (operation: WordEdit['operation']): WordEdit => ({
  operation,
  paragraph: props.paragraph.number,
})
/** The selected words, or the whole paragraph when nothing is selected. */
const range = () => {
  const el = fieldEl()
  const from = el?.selectionStart ?? 0
  const to = el?.selectionEnd ?? 0
  return from === to ? { from: 0, to: props.paragraph.text.length } : { from, to }
}
const insertAt = () => {
  const el = fieldEl()
  return !el || el.selectionStart === el.selectionEnd
    ? props.paragraph.text.length
    : el.selectionStart
}
/** Turns a format off when every selected run already has it, on otherwise. */
function format(name: (typeof FORMATS)[number]['name'], property: string): WordEdit {
  const selection = range()
  const runs = props.paragraph.runs.filter(
    (r) => r.offset < selection.to && r.offset + r.text.length > selection.from
  )
  const active =
    runs.length > 0 &&
    runs.every((r) => {
      const prop = r.run && child(child(r.run, 'rPr') ?? r.run, property)
      return !!prop && !['0', 'false', 'off', 'none'].includes(attr(prop, 'val') ?? '')
    })
  return { ...base('format'), ...selection, format: name, enabled: !active }
}

const suggestions: FileSuggest[] = []
const closeSuggestions = () => suggestions.forEach((s) => s.close())

async function run(edit: WordEdit, textChange = false): Promise<void> {
  if (readOnly.value || busy.value) return
  if (!textChange && currentText() !== props.paragraph.text) {
    status.value = 'Save text changes before formatting or changing structure.'
    return
  }
  busy.value = true
  try {
    await props.host.apply(edit)
    closeSuggestions()
  } catch (error) {
    status.value = (error as Error).message
    busy.value = false
  }
}

function cancel(): void {
  closeSuggestions()
  props.host.cancel()
}

onMounted(() => {
  const input = pathField.value?.inputRef as HTMLInputElement | undefined
  if (input) suggestions.push(new FileSuggest(props.host.app, input, { allFileTypes: true }))
  const el = fieldEl()
  if (!el) return
  if (!readOnly.value) el.focus()
  if (props.host.range) el.setSelectionRange(props.host.range.from, props.host.range.to)
})
onBeforeUnmount(closeSuggestions)
</script>

<style lang="scss">
// The groups sit one under another at the form's own gap, not a settings page's section spacing.
.abele-word-editor > .abele-word-editor-section {
  margin-top: 0;
}

// A number field stands inline after its label, as wide as the numbers it holds.
.abele-word-editor .abele-word-editor__number {
  display: inline-flex;
  width: auto;
}
</style>
