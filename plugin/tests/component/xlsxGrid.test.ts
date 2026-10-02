import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkbookGrid from '@/spreadsheet/WorkbookGrid.vue'
import { openXlsx } from '@/spreadsheet/package'
import { sampleXlsx } from '../fixtures/xlsx/sampleXlsx'

describe('workbook grid', () => {
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
