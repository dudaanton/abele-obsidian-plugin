<template>
  <div class="abele-word-editor">
    <Input
      ref="field"
      v-model="text"
      as-text-area
      :aria-label="t('streamC.bb4dd3b610336ee0', { v1: String(paragraph.number) })"
      :disabled="!paragraph.editable || readOnly"
    />
    <div role="status">{{ status }}</div>
    <Button
      :text="t('settings.GithubConnectionEditor.save.1509f561')"
      accent
      :tooltip="t('streamC.4e3f207fd5809528')"
      :disabled="!paragraph.editable || readOnly || busy"
      @click="run(paragraphTextEdit(paragraph, currentText()), true)"
    />
    <Button
      :text="t('kit.cancel')"
      :tooltip="t('streamC.bb5e6ee5e7fd97a9')"
      :disabled="busy"
      @click="cancel"
    />

    <template v-if="paragraph.editable">
      <div class="setting-item-description">{{ t('streamC.4f756acc7ba4ecc6') }}</div>
      <Section class="abele-word-editor-section">
        <strong class="abele-word-editor-label">{{ t('streamC.29d4198e41d8221a') }}</strong>
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
          :aria-label="t('streamC.9aa08be49bddd559')"
          :disabled="readOnly"
        />
        <Button
          :text="t('streamC.1745c4124fdc6401')"
          :tooltip="t('streamC.f14fcdb0f1b80f19')"
          :disabled="locked"
          @click="run({ ...base('style'), style_id: style })"
        />
        <Dropdown
          v-model="list"
          :options="LISTS"
          :aria-label="t('streamC.fbe8962b55d41984')"
          :disabled="readOnly"
        />
        <Button
          :text="t('streamC.05273844af652b5d')"
          :tooltip="t('streamC.765a3e36365d3ad6')"
          :disabled="locked"
          @click="run({ ...base('list'), list: list as WordEdit['list'] })"
        />
      </Section>
      <Section class="abele-word-editor-section">
        <strong class="abele-word-editor-label">{{ t('streamC.d2ef75e86bb76390') }}</strong>
        <Input
          v-model="added"
          :aria-label="t('streamC.6b3089754496aee4')"
          :placeholder="t('streamC.6b3089754496aee4')"
          :disabled="readOnly"
        />
        <Button
          :text="t('streamC.98388c4cd9d7c6ed')"
          :tooltip="t('streamC.1ddb710bdc77fc82')"
          :disabled="locked"
          @click="run({ ...base('paragraph_add'), text: added })"
        />
        <Button
          :text="t('streamC.bb4a0b48b83d4496')"
          :tooltip="t('streamC.f4f56215be93d167')"
          :disabled="locked"
          @click="run({ ...base('paragraph_split'), offset: fieldEl()?.selectionStart ?? 0 })"
        />
        <Button
          :text="t('streamC.2e0a6cdd619108b4')"
          :tooltip="t('streamC.464a707a4d99d4be')"
          :disabled="locked"
          @click="run(base('paragraph_merge'))"
        />
        <Button
          :text="t('streamC.14d3db3b974f65b8')"
          :tooltip="t('streamC.eedcdf69ed8fc8dc')"
          :disabled="locked"
          @click="run(base('paragraph_delete'))"
        />
      </Section>
      <Section class="abele-word-editor-section">
        <strong class="abele-word-editor-label">{{ t('settings.tabs.links') }}</strong>
        <Input
          v-model="url"
          :aria-label="t('streamC.9dfd0b9f8f42b404')"
          :placeholder="t('streamC.13844ffc728705a2')"
          :disabled="readOnly"
        />
        <Button
          :text="t('streamC.e810e30ed767b221')"
          :tooltip="t('streamC.0e5a9bd10c0eeb5b')"
          :disabled="locked"
          @click="run({ ...base('link'), ...range(), url })"
        />
        <Button
          :text="t('streamC.4953f897094826d3')"
          :tooltip="t('streamC.4fed66766017a7bb')"
          :disabled="locked"
          @click="run({ ...base('link'), ...range(), url: '' })"
        />
      </Section>
    </template>
    <div v-else class="setting-item-description">{{ t('streamC.8c085488d3b9ae6a') }}</div>

    <Section v-if="paragraph.table && paragraph.editable" class="abele-word-editor-section">
      <strong class="abele-word-editor-label"
        >{{ t('streamC.16d1c9050a0b32e8') }} {{ paragraph.table }}</strong
      >
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
        :text="t('streamC.3d48302e0e564436')"
        :tooltip="t('streamC.ac29ee4f59bda346')"
        :disabled="locked"
        @click="run({ ...base('row_add'), ...cell() })"
      />
      <Button
        :text="t('streamC.5260f6b2fa9f539a')"
        :tooltip="t('streamC.1b0f7b9eebfbca86')"
        :disabled="locked"
        @click="run({ ...base('row_delete'), ...cell() })"
      />
      <Button
        :text="t('streamC.d042a07a3d5f7c72')"
        :tooltip="t('streamC.4888a148ab2dc755')"
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
        :text="t('streamC.ec306591839f83d2')"
        :tooltip="t('streamC.d43f5339edf1f747')"
        :disabled="locked"
        @click="run({ ...base('cells_split'), ...cell() })"
      />
    </Section>

    <Section v-if="!paragraph.protected" class="abele-word-editor-section">
      <strong class="abele-word-editor-label">{{ t('streamC.1a1f337f74d0915b') }}</strong>
      <Dropdown
        v-model="picture"
        :options="pictures"
        :aria-label="t('streamC.1aa4cb0bcca76e92')"
        :disabled="readOnly"
      />
      <Input
        ref="pathField"
        v-model="path"
        :aria-label="t('streamC.ec2051eb304f51db')"
        :placeholder="t('streamC.ec2051eb304f51db')"
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
        :text="t('streamC.cf3a92dadb38f288')"
        :tooltip="t('streamC.438bba1ff2e908d9')"
        :disabled="locked"
        @click="run({ ...base('image_insert'), ...image(), offset: insertAt() })"
      />
      <Button
        :text="t('streamC.fcedcb5edd38a849')"
        :tooltip="t('streamC.c5a3081773ccece5')"
        :disabled="locked"
        @click="run({ ...base('image_replace'), ...image() })"
      />
      <Button
        :text="t('streamC.ab28be14e4fa6152')"
        :tooltip="t('streamC.7bd92f4e55e7f5dd')"
        :disabled="locked"
        @click="run({ ...base('image_resize'), ...image() })"
      />
      <Button
        :text="t('streamC.fbbc98ee63a50b30')"
        :tooltip="t('streamC.999624402fdc880d')"
        :disabled="locked"
        @click="run({ ...base('image_delete'), ...image() })"
      />
    </Section>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

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
  {
    name: 'bold',
    label: t('settings.reader.stroke.bold'),
    property: 'b',
    tooltip: t('streamC.c928d1fdad9a95bf'),
  },
  {
    name: 'italic',
    label: t('streamC.9bf37cb58a694456'),
    property: 'i',
    tooltip: t('streamC.f0cf2bd8b4862a89'),
  },
  {
    name: 'underline',
    label: t('streamC.02f843261112c2d8'),
    property: 'u',
    tooltip: t('streamC.9ac223819b96fac3'),
  },
  {
    name: 'strike',
    label: t('streamC.9aabbcb2c18def7b'),
    property: 'strike',
    tooltip: t('streamC.3812c6f851b7bd4f'),
  },
] as const
const LISTS = [
  { value: 'none', display: t('streamC.eacd31d849f9f7ed') },
  { value: 'bullet', display: t('streamC.ce51b395cd6b5ece') },
  { value: 'decimal', display: t('streamC.cc62f6c7b2a82fd1') },
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
  { key: 'row', label: t('streamC.95110d74c4c00912') },
  { key: 'column', label: t('streamC.22756377abd254bf') },
  { key: 'lastRow', label: t('streamC.d4b57e76ee2fdc3c') },
  { key: 'lastColumn', label: t('streamC.d92de968c0ae5e69') },
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
  { value: '0', display: t('streamC.1699c31990887ee5') },
  ...props.doc.images
    .filter((i) => i.paragraph === props.paragraph.number)
    .map((i) => ({
      value: String(i.number),
      display: i.inline
        ? t('streamC.82e2773be1f2ecda', { v1: i.number })
        : t('streamC.2d4c1a845d0a6751', { v1: i.number }),
    })),
]
const picture = ref('0')
const path = ref('')
const sizeFields = [
  { key: 'width', label: t('streamC.bad5f0ee7ade0c10') },
  { key: 'height', label: t('streamC.a8af39afa89df046') },
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
    status.value = t('streamC.7142a8dca36f2519')
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
