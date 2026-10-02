import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import WorkbookGrid from '@/spreadsheet/WorkbookGrid.vue'
import { openXlsx } from '@/spreadsheet/package'
import { sampleXlsx, sampleParts } from '../fixtures/xlsx/sampleXlsx'
import { zipSync, strToU8, strFromU8, unzipSync } from 'fflate'
import { applyWorkbookFormat } from '@/spreadsheet/format'
import { parseXml } from '@/ooxml/xml'

describe('workbook grid', () => {
  it('sends only changed formatting properties, retaining theme fill and unknown built-in number format', async () => {
    const parts = sampleParts()
    const styles = strFromU8(parts['xl/styles.xml'])
      .replace('<fills count="3">', '<fills count="4">')
      .replace(
        '</fills>',
        '<fill><patternFill patternType="solid"><fgColor theme="4"/></patternFill></fill></fills>'
      )
      .replace('<cellXfs count="3">', '<cellXfs count="4">')
      .replace(
        '</cellXfs>',
        '<xf numFmtId="44" fontId="0" fillId="3" borderId="0" xfId="0"/></cellXfs>'
      )
    parts['xl/styles.xml'] = strToU8(styles)
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      strFromU8(parts['xl/worksheets/sheet1.xml']).replace(
        '<c r="B2"><v>20</v></c>',
        '<c r="B2" s="3"><v>20</v></c>'
      )
    )
    const book = await openXlsx(zipSync(parts))
    const save = vi.fn(
      async (
        edit: Parameters<typeof applyWorkbookFormat>[1] & { operation: string; values: unknown[] }
      ) => {
        const updated = await applyWorkbookFormat(book, edit)
        const reopened = await openXlsx(updated)
        const cell = (await reopened.sheet('Sample')).cells.get('B2')!
        const xml = strFromU8(unzipSync(updated)['xl/styles.xml'])
        const root = await parseXml(xml)
        const xfs = root.children.find((n) => n.local === 'cellXfs')!.children
        expect(cell.style.bold).toBe(true)
        expect(xfs[cell.styleId].attrs).toMatchObject({ fillId: '3', numFmtId: '44' })
        expect(xml).toContain('<fgColor theme="4"/>')
      }
    )
    const wrapper = mount(WorkbookGrid, { props: { book, mobile: false, save } })
    await flushPromises()
    await wrapper.find('[data-cell="B2"]').trigger('click')
    await wrapper.find('.abele-workbook-edit').trigger('click')
    expect((wrapper.find('[aria-label="Fill colour"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.find('[aria-label="Number format"]').element as HTMLInputElement).value).toBe(
      'General'
    )
    await wrapper.find('[aria-label="Bold"]').setValue(true)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Apply formatting')!
      .trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ format: { bold: true } }))
    wrapper.unmount()
  })
  it('zooms the virtual grid with a two-finger pinch without offering phone editing', async () => {
    const book = await openXlsx(sampleXlsx())
    const wrapper = mount(WorkbookGrid, { props: { book, mobile: true } })
    await flushPromises()
    const cell = wrapper.find('[data-cell="A1"]')
    const before = Number.parseFloat((cell.element as HTMLElement).style.width)
    const viewport = wrapper.find('.abele-workbook-viewport')
    await viewport.trigger('touchstart', {
      touches: [
        { clientX: 100, clientY: 200 },
        { clientX: 200, clientY: 200 },
      ],
    })
    await viewport.trigger('touchmove', {
      touches: [
        { clientX: 50, clientY: 200 },
        { clientX: 250, clientY: 200 },
      ],
    })
    await flushPromises()
    expect(
      Number.parseFloat((wrapper.find('[data-cell="A1"]').element as HTMLElement).style.width)
    ).toBe(before * 2)
    expect(wrapper.find('.abele-workbook-edit').exists()).toBe(false)
    wrapper.unmount()
  })
  it('uses a bounded physical canvas but can still reach the last logical row of a full sheet', async () => {
    const book = await openXlsx(sampleXlsx())
    const sheet = await book.sheet('Sample')
    sheet.maxRow = 1048576
    sheet.maxColumn = 16384
    const wrapper = mount(WorkbookGrid, { props: { book, mobile: true } })
    await flushPromises()
    expect(
      Number.parseFloat((wrapper.find('.abele-workbook-space').element as HTMLElement).style.height)
    ).toBeLessThanOrEqual(8000000)
    await wrapper.find('[aria-label="Cell address"]').setValue('A1048576')
    await wrapper.find('[aria-label="Cell address"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.find('[data-cell="A1048576"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('uses the same desktop save boundary for values and formatting, and hides it on phones', async () => {
    const book = await openXlsx(sampleXlsx())
    const save = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(WorkbookGrid, { props: { book, mobile: false, save } })
    await flushPromises()
    await wrapper.find('.abele-workbook-edit').trigger('click')
    expect(wrapper.find('.abele-workbook-format').exists()).toBe(true)
    await wrapper.find('[aria-label="Formatting range"]').setValue('B1:B2')
    await wrapper.find('[aria-label="Fill colour"]').setValue('#33AA77')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Apply formatting')!
      .trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'format',
        range: 'B1:B2',
        format: expect.objectContaining({ fill: '#33AA77' }),
      })
    )
    await wrapper.setProps({ mobile: true })
    expect(wrapper.find('.abele-workbook-edit').exists()).toBe(false)
    wrapper.unmount()
  })
  it('renders cached values and a formula bar without treating strings as HTML', async () => {
    const book = await openXlsx(sampleXlsx())
    const wrapper = mount(WorkbookGrid, { props: { book, mobile: false } })
    await flushPromises()
    expect(wrapper.find('[data-cell="A1"]').text()).toBe('Sample heading')
    expect(wrapper.find('[data-cell="B4"]').exists()).toBe(false)
    await wrapper.find('[data-cell="C1"]').trigger('click')
    expect(wrapper.find('.abele-workbook-formula').text()).toContain('SUM(B1:B2)')
    expect(wrapper.findAll('[data-cell]').length).toBeLessThan(100)
    await wrapper.find('select').setValue('Other')
    await flushPromises()
    expect(wrapper.find('[data-cell="A1"]').text()).toBe('60')
    wrapper.unmount()
  })
  it('bounds DOM rows and columns even for a full-sheet dimension', async () => {
    const book = await openXlsx(sampleXlsx())
    const sheet = await book.sheet('Sample')
    sheet.maxRow = 1048576
    sheet.maxColumn = 16384
    const wrapper = mount(WorkbookGrid, { props: { book, mobile: true } })
    await flushPromises()
    expect(wrapper.findAll('[data-cell]').length).toBeLessThan(400)
    expect(wrapper.text()).toContain('View and agent editing')
    wrapper.unmount()
  })
})
