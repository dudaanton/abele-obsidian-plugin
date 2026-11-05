// @vitest-environment node
import { expect, it } from 'vitest'
import { desktopFsPort } from '../helpers/desktopRequire'

it('models cached native modules while retaining the injected filesystem port', () => {
  const port = { sample: 1 }
  desktopFsPort(port)
  const first = window.require('original-fs')
  for (let i = 0; i < 1000; i++) expect(window.require('original-fs')).toBe(first)
  expect(window.require('fs')).toBe(first)
  port.sample = 2
  expect(first.promises).toBe(port)
  expect(first.promises.sample).toBe(2)
})

it('permits a native fixture to assign its window timers', () => {
  const timer = globalThis.setTimeout.bind(globalThis)
  Object.assign(window, { setTimeout: timer })
  expect(window.setTimeout).toBe(timer)
})
