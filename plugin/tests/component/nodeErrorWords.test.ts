import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import NodeErrorText from '@/components/NodeErrorText.vue'
import { nodeErrorNotice } from '@/node/errorNotice'

it('shows words and retains the exact diagnostic only in a tooltip', () => {
  const wrapper = mount(NodeErrorText, { props: { error: 'paired_route_tls_or_unreachable' } })
  expect(wrapper.text()).toBe(
    'The node could not be reached securely. Check its address, certificate and connection.'
  )
  expect(wrapper.text()).not.toContain('paired_route_tls_or_unreachable')
  expect(wrapper.attributes('title')).toBe('paired_route_tls_or_unreachable')
  wrapper.unmount()
})

it('retains a transient error diagnostic without displaying it as the notice', () => {
  const notice = nodeErrorNotice(new Error('unauthorized'))
  expect(notice.messageEl.textContent).toBe(
    'The node refused access. Pair again or check your permissions.'
  )
  expect(notice.messageEl.querySelector('span')?.title).toBe('unauthorized')
  notice.hide()
})

it('shows an unknown code in persistent errors and keeps the raw tooltip', () => {
  const raw = 'Not accepted: Future_Failure.'
  const wrapper = mount(NodeErrorText, { props: { error: raw } })
  expect(wrapper.text()).toBe(
    'The node could not complete the request. Check the details before trying again. (Future_Failure)'
  )
  expect(wrapper.attributes('title')).toBe(raw)
  wrapper.unmount()
})

it('shows an unknown code in notices and keeps the raw tooltip', () => {
  const raw = 'Not accepted: Future_Failure.'
  const notice = nodeErrorNotice(new Error(raw))
  expect(notice.messageEl.textContent).toBe(
    'The node could not complete the request. Check the details before trying again. (Future_Failure)'
  )
  expect(notice.messageEl.querySelector('span')?.title).toBe(raw)
  notice.hide()
})
