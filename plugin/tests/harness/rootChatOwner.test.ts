import { expect, it } from 'vitest'
import { rootChatOwnerVisible, type RootChatOwnerState } from '../e2e/contracts/rootChatOwner'

const visible: RootChatOwnerState = {
  intendedOwner: 'sample-root',
  owner: 'sample-root',
  root: 'root',
  activeLeaf: 'sample-root',
  activeTab: 'sample-session',
  session: 'sample-session',
  connectedPaneIds: ['sample-root', 'sample-retained'],
  secondPane: 'sample-retained',
  rect: { left: 0, top: 53, right: 393, bottom: 270, width: 393, height: 217 },
  viewport: { left: 0, top: 0, right: 393, bottom: 517 },
  hitInside: [true, true],
}

it('rejects an active, mounted root hidden behind an expanded drawer', () => {
  expect(
    rootChatOwnerVisible({
      ...visible,
      rect: { ...visible.rect, left: -330, right: 63 },
      hitInside: [false, false],
    })
  ).toBe(false)
})
it('requires the same root/session, retained pane, viewport and both topmost hits', () => {
  expect(rootChatOwnerVisible(visible)).toBe(true)
  for (const change of [
    { owner: 'sample-visible-mirror' },
    { root: 'right' },
    { activeLeaf: 'sample-retained' },
    { activeTab: 'sample-other-session' },
    { connectedPaneIds: ['sample-root'] },
    { hitInside: [true, false] },
    { rect: { ...visible.rect, bottom: 518 } },
  ])
    expect(rootChatOwnerVisible({ ...visible, ...change })).toBe(false)
})
