import { vi } from 'vitest'
import { Menu, type MenuItem } from 'obsidian'
import type { DOMWrapper } from '@vue/test-utils'

type Root = { find(selector: string): DOMWrapper<Element> }

/**
 * The answers an approval card keeps out of its buttons — always allow, edit first — sit in
 * its ⋯ menu. Opens the first card's menu and returns what it offers.
 */
export async function approvalMenu(root: Root): Promise<MenuItem[]> {
  const more = root.find('.abele-tool-approval__more')
  if (!more.exists()) return []
  const spy = vi.spyOn(Menu.prototype, 'showAtPosition')
  await more.trigger('click')
  const shown = spy.mock.contexts[0] as unknown as { items: MenuItem[] } | undefined
  spy.mockRestore()
  return shown?.items ?? []
}

/** Stop asking about this one tool: the item names the tool it covers. */
export const ALWAYS_TOOL = /^Always allow (?!writes in scope$)/
/** Stop asking about writes inside the scope. */
export const ALWAYS_WRITES = 'Always allow writes in scope'

/** The menu answer with this title, or undefined when the card does not offer it. */
export async function approvalChoice(
  root: Root,
  title: string | RegExp
): Promise<MenuItem | undefined> {
  return (await approvalMenu(root)).find((i) =>
    typeof title === 'string' ? i.title === title : title.test(i.title)
  )
}

/** Takes the menu answer with this title; fails when the card does not offer it. */
export async function chooseApproval(root: Root, title: string | RegExp): Promise<void> {
  const item = await approvalChoice(root, title)
  if (!item) throw new Error(`the approval card offers no "${title}"`)
  item.handler?.()
}
