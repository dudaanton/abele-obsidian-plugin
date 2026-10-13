import { expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { openDocx } from '@/word/package'
import { wordPageModel } from '@/word/pageAdapter'
import WordPage from '@/word/WordPage.vue'
import { paragraph, sampleDocx } from '../fixtures/docx/sampleDocx'

it('reads real styles, marks, lists, tables, images and supplementary paragraphs into the page', async () => {
  const model = await wordPageModel(await openDocx(sampleDocx()))
  const page = mount(WordPage, { props: { model } })
  expect(page.findAll('[data-paragraph]')).toHaveLength(11)
  expect(page.find('.abele-word-mark_bold').element.textContent).toBe('Sample ')
  expect(page.find('[data-paragraph="2"]').attributes('data-marker')).toBe('•')
  expect(page.find('table').text()).toContain('Cell sample')
  expect(page.find('img').attributes('src')).toMatch(/^data:image\/png;base64,/)
  expect(page.text()).toContain('Sample comment')
  expect(page.find('[data-paragraph="5"]').classes()).toContain('abele-word-line_locked')
  page.unmount()
})

it('preserves tabs, breaks and multiple paragraphs in one table cell', async () => {
  const body =
    '<w:p><w:r><w:t>First</w:t><w:tab/><w:t>second</w:t><w:br/><w:t>third</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' +
    paragraph('Cell first') +
    paragraph('Cell second') +
    '</w:tc></w:tr></w:tbl>'
  const page = mount(WordPage, {
    props: { model: await wordPageModel(await openDocx(sampleDocx(body))) },
  })
  expect(page.find('[data-paragraph="1"]').element.textContent).toBe('First\tsecond\nthird')
  expect(page.findAll('td')).toHaveLength(1)
  expect(page.find('td').attributes('colspan')).toBe('2')
  expect(page.find('td').text()).toContain('Cell second')
  page.unmount()
})

it('keeps a vertical merge as one cell spanning its rows', async () => {
  const body =
    '<w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' +
    paragraph('Merged sample') +
    '</w:tc><w:tc>' +
    paragraph('Sample right one') +
    '</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>' +
    paragraph('') +
    '</w:tc><w:tc>' +
    paragraph('Sample right two') +
    '</w:tc></w:tr></w:tbl>'
  const page = mount(WordPage, {
    props: { model: await wordPageModel(await openDocx(sampleDocx(body))) },
  })
  expect(page.findAll('td')).toHaveLength(3)
  expect(page.find('td').attributes('rowspan')).toBe('2')
  expect(page.findAll('[data-paragraph]')).toHaveLength(8)
  page.unmount()
})

it('keeps nested tables inside their original outer cell', async () => {
  const body =
    '<w:tbl><w:tr><w:tc>' +
    paragraph('Outer sample') +
    '<w:tbl><w:tr><w:tc>' +
    paragraph('Nested sample') +
    '</w:tc></w:tr></w:tbl>' +
    paragraph('Outer tail') +
    '</w:tc></w:tr></w:tbl>'
  const page = mount(WordPage, {
    props: { model: await wordPageModel(await openDocx(sampleDocx(body))) },
  })
  expect(page.find('table td table').exists()).toBe(true)
  expect(page.find('table td table').text()).toContain('Nested sample')
  expect(page.findAll('[data-paragraph]')).toHaveLength(7)
  page.unmount()
})

it('renders document text as text and refuses executable hyperlink targets', async () => {
  const doc = await openDocx(sampleDocx(paragraph('&lt;script&gt;sample text&lt;/script&gt;')))
  doc.links.push({
    paragraph: 1,
    from: 0,
    to: doc.paragraphs[0].text.length,
    url: 'javascript:alert(1)',
  })
  const page = mount(WordPage, { props: { model: await wordPageModel(doc) } })
  expect(page.find('script, iframe, object, embed').exists()).toBe(false)
  expect(page.find('a').exists()).toBe(false)
  expect(page.text()).toContain('<script>sample text</script>')
  page.unmount()
})

it('renders every paragraph of a synthetic large document without a paragraph switch', async () => {
  const started = performance.now()
  const model = await wordPageModel(
    await openDocx(
      sampleDocx(
        Array.from({ length: 2000 }, (_, i) => paragraph(`Sample paragraph ${i}`)).join('')
      )
    )
  )
  const mountStarted = performance.now()
  const page = mount(WordPage, { props: { model } })
  const firstPaint = performance.now() - mountStarted
  expect(page.findAll('[data-paragraph]').length).toBeLessThan(2004)
  let pulses = 0
  let maxGap = firstPaint
  let last = performance.now()
  let timer: ReturnType<typeof setTimeout>
  const tick = () => {
    const now = performance.now()
    maxGap = Math.max(maxGap, now - last)
    last = now
    pulses++
    timer = setTimeout(tick, 0)
  }
  timer = setTimeout(tick, 0)
  try {
    await vi.waitFor(() => expect(page.findAll('[data-paragraph]')).toHaveLength(2004), {
      timeout: 5000,
    })
  } finally {
    clearTimeout(timer)
  }
  expect(pulses).toBeGreaterThan(1)
  expect(page.text()).toContain('Sample paragraph 1999')
  expect(page.find('input[type="number"]').exists()).toBe(false)
  console.info(
    `Synthetic 2000 paragraphs: ${Math.round(performance.now() - started)}ms total, ${Math.round(firstPaint)}ms first mount, ${Math.round(maxGap)}ms max task gap, ${pulses} yielding pulses`
  )
  page.unmount()
})
