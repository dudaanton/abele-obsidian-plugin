import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TraceRunView from '@/components/debugger/trace/TraceRunView.vue'
import DebugPanel from '@/components/debugger/DebugPanel.vue'
import { useVault } from '../helpers/testEnv'

it('uses a readable method name in the variables heading', () => {
  useVault([])
  const w = mount(DebugPanel, {
    props: {
      session: {
        program: 'sample.js',
        status: 'paused',
        frames: [{ name: 'Timer {.tick', file: 'sample.js', line: 4 }],
        frame: 0,
        variables: [],
        breakpoints: [],
        watches: [],
        output: '',
        mode: 'ask',
        seen: '',
      },
    },
  })
  expect(w.findAll('.tree-item-flair').map((e) => e.text())).toContain('tick')
  expect(w.text()).not.toContain('Timer {.tick')
  w.unmount()
})

it('explains why a server recording contains no HTTP requests', async () => {
  const w = mount(TraceRunView, {
    props: { run: { id: 'sample', name: 'Sample', length: '', steps: [] } },
  })
  await w.get('[aria-label="Only the requests"]').trigger('click')
  expect(w.text()).toContain('Requests are recorded from a connected browser')
  w.unmount()
})

