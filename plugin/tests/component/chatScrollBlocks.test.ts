import { afterEach, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { useChatScrollAnchors } from '@/composables/useChatScrollAnchors'
import { useVault } from '../helpers/testEnv'

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  document.body.replaceChildren()
})

function open(text: string) {
  useVault([])
  const box = document.createElement('div')
  box.innerHTML =
    '<div class="abele-chat-msg" data-message-id="sample-tool"><div class="abele-markdown"></div></div>'
  document.body.append(box)
  Object.defineProperties(box, {
    clientHeight: { get: () => 800 },
    scrollHeight: { get: () => 3000 },
  })
  box.scrollTop = 1000
  box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
  const message = box.firstElementChild as HTMLElement
  message.getBoundingClientRect = () => ({ top: -100, bottom: 900 }) as DOMRect
  const root = message.firstElementChild as HTMLElement
  const block = (value: string, at: number) => {
    const el = document.createElement('p')
    el.textContent = value
    el.getBoundingClientRect = () =>
      ({ top: at - box.scrollTop, bottom: at + 30 - box.scrollTop }) as DOMRect
    el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList
    return el
  }
  root.append(block(text, 1040))
  let following = false
  let anchors!: ReturnType<typeof useChatScrollAnchors>
  wrapper = mount(
    defineComponent({
      setup() {
        anchors = useChatScrollAnchors({
          messagesContainer: ref(box),
          scrollContainerTo: (el, top) => {
            el.scrollTop = top
          },
          shouldAutoScroll: () => following,
          isStreaming: () => true,
        })
        return () => h('div')
      },
    })
  )
  anchors.steadyReader()
  return {
    box,
    root,
    message,
    block,
    anchors,
    follow: () => {
      following = true
    },
  }
}

it.each(['', 'A'])('does not resolve the replaced %j block to an unrelated prefix', (text) => {
  const { box, root, block, anchors } = open(text)
  root.replaceChildren(block('Another tool output', 100))
  anchors.holdSteady()
  expect(box.scrollTop).toBe(1000)
})

it('resolves a short exact block ahead of a different block with the same prefix', () => {
  const { box, root, block, anchors } = open('A')
  root.replaceChildren(block('Another tool output', 100), block('A', 1040))
  anchors.holdSteady()
  expect(box.scrollTop).toBe(1000)
})

it('retains the paragraph offset when rendering replaces its node', () => {
  const { box, root, block, anchors } = open('Sample paragraph retained across rendering')
  root.replaceChildren(block('Sample paragraph retained across rendering', 1140))
  anchors.holdSteady()
  expect(box.scrollTop).toBe(1100)
  expect(anchors.keepingReader).toBe(true)
})

it('does not resolve into a different markdown root of the same tool row', () => {
  const { box, root, message, block, anchors } = open('Sample shared paragraph')
  const other = document.createElement('div')
  other.className = 'abele-markdown'
  other.append(block('Sample shared paragraph', 100))
  message.prepend(other)
  root.replaceChildren(block('Sample shared paragraph', 1040))
  anchors.holdSteady()
  expect(box.scrollTop).toBe(1000)
})

it('does not use the block index of another root while its own root is empty', () => {
  const { box, root, message, block, anchors } = open('Sample shared paragraph')
  const other = document.createElement('div')
  other.className = 'abele-markdown'
  other.append(block('Sample shared paragraph', 100))
  message.prepend(other)
  root.replaceChildren()
  anchors.holdSteady()
  expect(box.scrollTop).toBe(1000)
})

it('releases a reading hold before it can move a reader now following the bottom', () => {
  const { box, root, block, anchors, follow } = open('Sample paragraph')
  root.replaceChildren(block('Sample paragraph', 100))
  follow()
  anchors.holdSteady()
  expect(box.scrollTop).toBe(1000)
  expect(anchors.keepingReader).toBe(false)
})
