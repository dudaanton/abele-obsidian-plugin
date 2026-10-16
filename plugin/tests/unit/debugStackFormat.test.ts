import { expect, it } from 'vitest'
import { formatFrameName } from '@/components/debugger/stackFormat'

it.each([
  ['global.makeOrder', 'makeOrder', ''],
  ['Timeout {.tick', 'tick', 'Timeout'],
  ['Timeout {._onTimeout', '_onTimeout', 'Timeout'],
  ['Object.process', 'process', 'Object'],
  ['Order.submit', 'submit', 'Order'],
  ['new Order', 'new Order', ''],
  ['Promise.then', 'then', 'Promise'],
  ['async Order.submit', 'async submit', 'Order'],
  ['<anonymous>', '(anonymous)', ''],
  ['', '(anonymous)', ''],
  ['(anonymous)', '(anonymous)', ''],
  ['Module._compile', '_compile', 'Module'],
  ['<module>', '<module>', ''],
  ['Object.<anonymous>', '(anonymous)', 'Object'],
])('formats %s without chopping receiver tokens', (raw, name, receiver) => {
  expect(formatFrameName(raw)).toEqual({ name, receiver })
})
