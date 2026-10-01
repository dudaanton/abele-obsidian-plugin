import type { App } from 'obsidian'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import type { WordEdit } from './edit'
import type { WordPackage, WordParagraph } from './package'
import { paragraphTextEdit } from './textEditor'
import { attr, child } from './xml'

export interface DesktopEditHost {
  app: App
  apply(edit: WordEdit): Promise<void>
  cancel(): void
}
/** Plain desktop fields act on original package operations; never a lossy contenteditable model. */
export function mountWordEditor(
  row: HTMLElement,
  doc: WordPackage,
  p: WordParagraph,
  host: DesktopEditHost
): void {
  const form = row.createDiv({ cls: 'abele-word-editor' })
  const input = form.createEl('textarea', { attr: { 'aria-label': `Edit paragraph ${p.number}` } })
  input.value = p.text
  input.disabled = !p.editable
  const status = form.createDiv({ attr: { role: 'status' } })
  const suggestions: FileSuggest[] = []
  const section = (title: string) => {
    const el = form.createDiv({ cls: 'abele-word-editor-section' })
    el.createEl('strong', { text: title, cls: 'abele-word-editor-label' })
    return el
  }
  const run = async (edit: WordEdit, textChange = false) => {
    if (!textChange && input.value !== p.text) {
      status.setText('Save text changes before formatting or changing structure.')
      return
    }
    const buttons = Array.from(form.querySelectorAll('button')).map((button) => ({
      button,
      disabled: button.disabled,
    }))
    buttons.forEach(({ button }) => (button.disabled = true))
    try {
      await host.apply(edit)
      suggestions.forEach((s) => s.close())
    } catch (error) {
      status.setText((error as Error).message)
      buttons.forEach(({ button, disabled }) => (button.disabled = disabled))
    }
  }
  const button = (el: HTMLElement, text: string, edit: () => WordEdit, textChange = false) => {
    const b = el.createEl('button', { text })
    b.onclick = () => void run(edit(), textChange)
    return b
  }
  const base = (operation: WordEdit['operation']): WordEdit => ({ operation, paragraph: p.number })
  const range = () => ({
    from: input.selectionStart === input.selectionEnd ? 0 : input.selectionStart,
    to: input.selectionStart === input.selectionEnd ? p.text.length : input.selectionEnd,
  })
  const number = (el: HTMLElement, label: string, value: number) => {
    const item = el.createEl('label', { text: label + ' ' })
    return item.createEl('input', {
      type: 'number',
      attr: { 'aria-label': label, min: '1', value: String(value) },
    })
  }
  const save = form.createEl('button', { text: 'Save', cls: 'mod-cta' })
  save.disabled = !p.editable
  save.onclick = () => void run(paragraphTextEdit(p, input.value), true)
  const cancel = form.createEl('button', { text: 'Cancel' })
  cancel.onclick = () => {
    suggestions.forEach((s) => s.close())
    host.cancel()
  }
  if (p.editable) {
    form.createDiv({
      text: 'Select text above to format it or add a link. With no selection, the whole paragraph is used.',
      cls: 'setting-item-description',
    })
    const format = section('Formatting')
    for (const [name, label, property] of [
      ['bold', 'Bold', 'b'],
      ['italic', 'Italic', 'i'],
      ['underline', 'Underline', 'u'],
      ['strike', 'Strikethrough', 'strike'],
    ] as const) {
      button(format, label, () => {
        const selection = range()
        const runs = p.runs.filter(
          (r) => r.offset < selection.to && r.offset + r.text.length > selection.from
        )
        const active =
          runs.length > 0 &&
          runs.every((r) => {
            const prop = r.run && child(child(r.run, 'rPr') ?? r.run, property)
            return !!prop && !['0', 'false', 'off', 'none'].includes(attr(prop, 'val') ?? '')
          })
        return { ...base('format'), ...selection, format: name, enabled: !active }
      })
    }
    const style = format.createEl('select', { attr: { 'aria-label': 'Paragraph style' } })
    for (const s of doc.styles) style.createEl('option', { text: s.name || s.id, value: s.id })
    if (p.style) style.value = p.style
    button(format, 'Apply style', () => ({ ...base('style'), style_id: style.value }))
    const list = format.createEl('select', { attr: { 'aria-label': 'List kind' } })
    for (const [value, label] of [
      ['none', 'No list'],
      ['bullet', 'Bulleted list'],
      ['decimal', 'Numbered list'],
    ])
      list.createEl('option', { text: label, value })
    button(format, 'Apply list', () => ({ ...base('list'), list: list.value as WordEdit['list'] }))
    const paragraphs = section('Paragraphs')
    const added = paragraphs.createEl('input', {
      type: 'text',
      attr: { 'aria-label': 'New paragraph text', placeholder: 'New paragraph text' },
    })
    button(paragraphs, 'Add paragraph below', () => ({
      ...base('paragraph_add'),
      text: added.value,
    }))
    button(paragraphs, 'Split at cursor', () => ({
      ...base('paragraph_split'),
      offset: input.selectionStart,
    }))
    button(paragraphs, 'Merge with next', () => base('paragraph_merge'))
    button(paragraphs, 'Delete paragraph', () => base('paragraph_delete'))
    const links = section('Links')
    const url = links.createEl('input', {
      type: 'text',
      attr: { 'aria-label': 'Link URL', placeholder: 'Link address' },
    })
    url.value = doc.links.find((l) => l.paragraph === p.number)?.url ?? ''
    button(links, 'Apply link', () => ({ ...base('link'), ...range(), url: url.value }))
    button(links, 'Remove link', () => ({ ...base('link'), ...range(), url: '' }))
  } else
    form.createDiv({
      text: 'This paragraph contains read-only structure. Inline images can still be selected below.',
      cls: 'setting-item-description',
    })
  if (p.table && p.editable) {
    const table = section(`Table ${p.table}`)
    const r = number(table, 'Row', p.row ?? 1)
    const c = number(table, 'Grid column', p.cell ?? 1)
    const tr = number(table, 'Last row', p.row ?? 1)
    const tc = number(table, 'Last column', p.cell ?? 1)
    const cell = () => ({ table: p.table, row: Number(r.value), column: Number(c.value) })
    button(table, 'Add row below', () => ({ ...base('row_add'), ...cell() }))
    button(table, 'Delete row', () => ({ ...base('row_delete'), ...cell() }))
    button(table, 'Merge cells', () => ({
      ...base('cells_merge'),
      ...cell(),
      to_row: Number(tr.value),
      to_column: Number(tc.value),
    }))
    button(table, 'Split cells', () => ({ ...base('cells_split'), ...cell() }))
  }
  if (!p.protected) {
    const pictures = section('Inline images')
    const selected = pictures.createEl('select', { attr: { 'aria-label': 'Image' } })
    selected.createEl('option', { text: 'New image', value: '0' })
    for (const image of doc.images.filter((i) => i.paragraph === p.number))
      selected.createEl('option', {
        text: `Image ${image.number}${image.inline ? '' : ' (floating, read-only)'}`,
        value: String(image.number),
      })
    const path = pictures.createEl('input', {
      type: 'text',
      attr: { 'aria-label': 'Vault image path', placeholder: 'Vault image path' },
    })
    suggestions.push(new FileSuggest(host.app, path, { allFileTypes: true }))
    const width = number(pictures, 'Width (px)', 120)
    const height = number(pictures, 'Height (px)', 80)
    selected.onchange = () => {
      const image = doc.images.find((i) => i.number === Number(selected.value))
      if (image) {
        width.value = String(image.width)
        height.value = String(image.height)
      }
    }
    const image = () => ({
      image: Number(selected.value),
      image_path: path.value,
      width: Number(width.value),
      height: Number(height.value),
    })
    button(pictures, 'Insert image', () => ({
      ...base('image_insert'),
      ...image(),
      offset: input.selectionStart === input.selectionEnd ? p.text.length : input.selectionStart,
    }))
    button(pictures, 'Replace image', () => ({ ...base('image_replace'), ...image() }))
    button(pictures, 'Resize image', () => ({ ...base('image_resize'), ...image() }))
    button(pictures, 'Delete image', () => ({ ...base('image_delete'), ...image() }))
  }
  input.focus()
}
