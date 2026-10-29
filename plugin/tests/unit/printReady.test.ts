import { beforeEach, expect, it } from 'vitest'
import { printReady, trackPrintTask } from '@/markdown/printReady'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
})

it('waits for mount-microtask work and nested asynchronous render work before decoding images', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  let finish: () => void = () => {}
  let decoded = false
  const delayed = new Promise<void>((resolve) => {
    finish = resolve
  })
  queueMicrotask(() =>
    trackPrintTask(
      root,
      delayed.then(() => {
        trackPrintTask(
          root,
          Promise.resolve().then(() => {
            const image = root.appendChild(document.createElement('img'))
            image.decode = async () => {
              decoded = true
            }
          })
        )
      })
    )
  )
  let ready = false
  const task = printReady(root).then(() => {
    ready = true
  })
  await Promise.resolve()
  expect(ready).toBe(false)
  finish()
  await task
  expect(decoded).toBe(true)
  expect(root.querySelector('img')?.loading).toBe('eager')
  root.remove()
})

it('prints an explicit image fallback when decoding fails', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  const image = root.appendChild(document.createElement('img'))
  image.alt = 'Sample missing picture'
  image.decode = async () => {
    throw new Error('Unavailable')
  }
  await printReady(root)
  expect(root.querySelector('img')).toBeNull()
  expect(root.textContent).toContain('Sample missing picture')
  root.remove()
})
