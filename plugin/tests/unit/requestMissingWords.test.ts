import { expect, it } from 'vitest'
import { reasonOf } from '@/requests/shapes'
it('explains a removed saved request', () => {
  expect(reasonOf(new Error('http_request_not_found'))).toBe(
    'This request is no longer on the node.'
  )
})
