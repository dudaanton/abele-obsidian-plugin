import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TracePointEditor from '@/components/debugger/trace/TracePointEditor.vue'
import TraceRunView from '@/components/debugger/trace/TraceRunView.vue'
import TraceValueRow from '@/components/debugger/trace/TraceValueRow.vue'
import TraceStepDetail from '@/components/debugger/trace/TraceStepDetail.vue'
import TraceTrail from '@/components/debugger/trace/TraceTrail.vue'
import BreakpointMark from '@/components/debugger/BreakpointMark.vue'
import type { TraceRun } from '@/components/debugger/trace/types'

it('explains a followed value with no recorded matches', () => {
  const w = mount(TraceTrail, { props: { trail: { value: 'sample body', stops: [] }, steps: [] } })
  expect(w.text()).toContain('No recorded steps contain this value.')
  w.unmount()
})

const run: TraceRun = {
  id: 'sample-run',
  name: 'Sample run',
  length: '1 s',
  steps: [
    { id: 's1', kind: 'http', at: 10, chain: 'a', status: 200, label: 'GET /sample', values: [] },
    {
      id: 's2',
      kind: 'probe',
      at: 40,
      chain: 'a',
      label: 'Sample arrives',
      place: { file: 'src/sample.ts', line: 4 },
      values: [{ name: 'sample', brief: '{ items: 2 }', bytes: 2048, format: 'json' }],
    },
    { id: 's3', kind: 'error', at: 60, label: 'SampleError', values: [] },
  ],
}

describe('a record point set up under its line', () => {
  it('keeps a typed custom expression when Keep is clicked directly', async () => {
    const w = mount(TracePointEditor, { props: { line: 4, inScope: ['sample'] } })
    await w.get('.multi-select-input').setValue('globalThis.sampleCount')
    await w.get('[aria-label="Keep (Enter)"]').trigger('click')
    expect(w.emitted('save')?.[0]?.[0]).toEqual({
      take: ['globalThis.sampleCount'],
      when: undefined,
      note: undefined,
    })
    w.unmount()
  })

  it('prefills a custom expression and saved fields, keeping suggestions and cancel isolated', async () => {
    const point = {
      file: 'sample.ts',
      line: 4,
      state: 'set' as const,
      kind: 'record' as const,
      take: ['globalThis.sampleCount'],
      when: 'sample.ok',
      note: 'Sample count',
    }
    const w = mount(TracePointEditor, { props: { line: 4, point, inScope: ['sample'] } })
    expect(w.get('.multi-select-pill-content').text()).toBe('globalThis.sampleCount')
    expect(w.get('[aria-label="Take sample"]').exists()).toBe(true)
    expect((w.findAll('input')[1].element as HTMLInputElement).value).toBe('sample.ok')
    expect((w.findAll('input')[2].element as HTMLInputElement).value).toBe('Sample count')
    await w.get('[aria-label="Take sample"]').trigger('click')
    await w.get('.abele-trace-point').trigger('keydown', { key: 'Escape' })
    expect(point.take).toEqual(['globalThis.sampleCount'])
    expect(w.emitted('save')).toBeUndefined()
    expect(w.emitted('cancel')).toHaveLength(1)
    w.unmount()
  })

  it('takes an offered name and keeps the point on Enter', async () => {
    const w = mount(TracePointEditor, { props: { line: 4, inScope: ['sample', 'other'] } })
    await w.get('[aria-label="Take sample"]').trigger('click')
    await w.get('input[aria-label="Fire only when this holds"]').setValue('sample.ok')
    await w
      .get('input[aria-label="Fire only when this holds"]')
      .trigger('keydown', { key: 'Enter' })
    expect(w.emitted('save')?.[0]?.[0]).toEqual({
      take: ['sample'],
      when: 'sample.ok',
      note: undefined,
    })
  })

  it('leaves the point as it was on Escape', async () => {
    const w = mount(TracePointEditor, { props: { line: 4 } })
    await w.get('.abele-trace-point').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('save')).toBeUndefined()
  })
})

describe('a recorded run', () => {
  it('searches recorded value summaries and distinguishes record hits by their values', async () => {
    const w = mount(TraceRunView, {
      props: {
        run: {
          ...run,
          steps: [
            {
              ...run.steps[1]!,
              id: 'sample-one',
              values: [
                { name: 'context', brief: 'sample-context', same: true, bytes: 14, format: 'text' },
                { name: 'event', brief: 'sample.created', bytes: 14, format: 'text' },
              ],
            },
            {
              ...run.steps[1]!,
              id: 'sample-two',
              values: [
                { name: 'context', brief: 'sample-context', same: true, bytes: 14, format: 'text' },
                { name: 'event', brief: 'sample.updated', bytes: 14, format: 'text' },
              ],
            },
          ],
        },
      },
    })
    const labels = w.findAll('.abele-trace-run__step > .tree-item-self').map((r) => r.text())
    expect(labels[0]).toMatch(/^event: sample.created/)
    expect(labels[1]).toMatch(/^event: sample.updated/)
    await w.get('input[type="search"]').setValue('sample.updated')
    expect(w.findAll('.abele-trace-run__step')).toHaveLength(1)
    expect(w.text()).toContain('sample.updated')
    w.unmount()
  })
  it('keeps code under its request in the requests filter even if the request arrives last', async () => {
    const w = mount(TraceRunView, {
      props: {
        run: {
          ...run,
          steps: [run.steps[1]!, run.steps[2]!, run.steps[0]!],
        },
      },
    })
    await w.get('[aria-label="Only the requests"]').trigger('click')
    const top = w.findAll('.abele-trace-run__steps > .abele-trace-run__step')
    expect(top.map((r) => r.get('.abele-tree-item__text').text())).toEqual(['GET /sample'])
    const child = top[0]!.get('.tree-item-children .abele-trace-run__step')
    expect(child.text()).toContain('Sample arrives')
    await child.get('.abele-tree-item__text').trigger('click')
    expect(w.emitted('pick')).toEqual([['s2']])
    w.unmount()
  })

  it('selects a top-level step and leaves the followed trail to show its values', async () => {
    const w = mount(TraceRunView, {
      props: { run, trail: { value: 'sample', stops: [{ step: 's2', path: 'sample' }] } },
    })
    await w.get('.abele-trace-run__step > .tree-item-self').trigger('click')
    expect(w.emitted('pick')).toEqual([['s1']])
    expect(w.emitted('unfollow')).toEqual([[]])
    expect(w.emitted('reveal')).toBeUndefined()
    await w.setProps({ picked: 's1', trail: undefined })
    expect(w.get('.abele-trace-step').text()).toContain('GET /sample')
    w.unmount()
  })
  it.each(['.abele-tree-item__text', '.abele-trace-glyph'])(
    'opens a child step value from %s while staying in the run',
    async (selector) => {
      const w = mount(TraceRunView, { props: { run } })
      const step = w.get('.tree-item-children .abele-trace-run__step')
      await step.get(selector).trigger('click')
      expect(w.emitted('pick')).toEqual([['s2']])
      expect(w.emitted('reveal')).toBeUndefined()
      await w.setProps({ picked: 's2' })
      expect(w.get('.abele-trace-step').text()).toContain('sample')
      await w.get('.abele-trace-step__place').trigger('click')
      expect(w.emitted('reveal')).toEqual([['src/sample.ts', 4]])
      w.unmount()
    }
  )

  it.each(['.abele-trace-step__title', '.abele-trace-glyph', '.abele-trace-step__place'])(
    'opens source from the detail %s',
    async (selector) => {
      const w = mount(TraceStepDetail, { props: { step: run.steps[1] } })
      await w.get(selector).trigger('click')
      expect(w.emitted('reveal')).toEqual([['src/sample.ts', 4]])
      w.unmount()
    }
  )
  it('returns to its debugger through a compact toolbar action', async () => {
    const w = mount(TraceRunView, { props: { run, debuggerAvailable: true } })
    await w.get('[aria-label="Back to debugger"]').trigger('click')
    expect(w.emitted('debugger')).toEqual([[]])
    await w.setProps({ picked: 's2' })
    expect(w.get('[aria-label="Back to debugger"]').exists()).toBe(true)
    await w.setProps({ debuggerAvailable: false })
    expect(w.find('[aria-label="Back to debugger"]').exists()).toBe(false)
    w.unmount()
  })
  it('stands the steps of one request under the first and keeps a step of none alone', () => {
    const w = mount(TraceRunView, { props: { run } })
    const top = w.findAll('.abele-trace-run__steps > .abele-trace-run__step')
    expect(top.map((r) => r.get('.abele-tree-item__text').text())).toEqual([
      'GET /sample',
      'SampleError',
    ])
    expect(top[0].findAll('.tree-item-children .abele-trace-run__step')).toHaveLength(1)
  })

  it('shows only what failed under the failed filter', async () => {
    const w = mount(TraceRunView, { props: { run } })
    await w.get('[aria-label="Only what failed"]').trigger('click')
    const texts = w.findAll('.abele-trace-run__step .abele-tree-item__text').map((r) => r.text())
    expect(texts).toEqual(['SampleError'])
  })

  it('moves to the next step with the down arrow', async () => {
    const w = mount(TraceRunView, { props: { run, picked: 's1' } })
    await w.get('.abele-trace-run__steps').trigger('keydown', { key: 'ArrowDown' })
    expect(w.emitted('pick')?.[0]).toEqual(['s2'])
  })
})

describe('a value a step took', () => {
  it('says a blanked secret by its dots and a value that came through unchanged by =', () => {
    const masked = mount(TraceValueRow, {
      props: {
        value: { name: 'Authorization', brief: '', bytes: 0, format: 'headers', masked: true },
      },
    })
    expect(masked.get('.abele-trace-value__size').text()).toBe('••••')
    expect(masked.find('[aria-label="Open whole"]').exists()).toBe(false)
    const same = mount(TraceValueRow, {
      props: { value: { name: 'sample', brief: '{}', bytes: 9, format: 'json', same: true } },
    })
    expect(same.get('.abele-trace-value__size').text()).toBe('=')
  })
})

it('draws a record point as a diamond and names what it takes', () => {
  const w = mount(BreakpointMark, {
    props: {
      breakpoint: {
        file: 'src/sample.ts',
        line: 4,
        state: 'set',
        kind: 'record',
        take: ['sample'],
      },
    },
  })
  expect(w.classes()).toContain('abele-breakpoint-mark_record')
  expect(w.attributes('aria-label')).toBe('Record point: takes sample and goes on')
})

it('shows direction, status and duration of program requests', () => {
  const w = mount(TraceRunView, {
    props: {
      run: {
        ...run,
        steps: [
          { ...run.steps[0], direction: 'incoming', durationMs: 0, host: 'localhost:4000' },
          { ...run.steps[0], id: 'out', chain: 'b', direction: 'outgoing', durationMs: 25 },
          { ...run.steps[0], id: 'sent', chain: 'c', sent: true },
        ],
      },
    },
  })
  expect(w.find('.abele-trace-glyph[aria-label="Incoming, 200"]').exists()).toBe(true)
  expect(w.text()).toContain('localhost:4000')
  expect(w.text()).toContain('Incoming')
  expect(w.text()).toContain('Outgoing')
  expect(w.text()).toContain('A request you sent')
  expect(w.text()).toContain('200')
  expect(w.text()).toContain('0 ms')
  expect(w.text()).toContain('25 ms')
  w.unmount()
})
