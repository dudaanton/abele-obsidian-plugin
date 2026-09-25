import { nanoid } from 'nanoid'
import dayjs from 'dayjs'
import type { AgentDefinition, AgentMemoryItem } from './types'

/** The tool an agent calls to remember something. On for every agent unless switched off. */
export const REMEMBER_TOOL = 'remember'

/** The tool an agent calls to drop something it remembered. Follows `remember`'s mode. */
export const FORGET_TOOL = 'forget'

/**
 * One item is one thing the person asked to be remembered, not a note.
 *
 * The cap is what keeps it that way: memory is sent with every request the agent makes, so a
 * paragraph stored here is a paragraph paid for on every turn of every chat.
 */
export const MEMORY_ITEM_MAX_LENGTH = 200

/** Enough for a real working set; past it, the person tidies up in the agent's settings. */
export const MEMORY_MAX_ITEMS = 50

/** Where the list goes in the template. */
export const MEMORY_PLACEHOLDER = '{{memory}}'

export const DEFAULT_MEMORY_TEMPLATE = [
  '## Memory',
  '',
  'Things the person asked you to remember. They hold in every conversation until the person asks you to change or forget one.',
  '',
  MEMORY_PLACEHOLDER,
].join('\n')

/** One line, single spaces — what the model wrote, minus the layout it does not need. */
export function normalizeMemoryText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** A new item dated today. No cap: the settings screen uses it, and the person decides there. */
export function createMemoryItem(text: string): AgentMemoryItem {
  return { id: nanoid(), text: normalizeMemoryText(text), created: dayjs().format('YYYY-MM-DD') }
}

/**
 * Adds one item to this agent's memory and returns it.
 *
 * Throws with a message meant for the model: it is what the model reads back when a call is
 * refused, so it says what to do next rather than what went wrong. The same thing asked twice
 * returns the item already there instead of storing a copy.
 */
export function addMemory(agent: AgentDefinition, raw: string): AgentMemoryItem {
  const text = validMemoryText(raw)

  if (!agent.memory) agent.memory = []

  const needle = text.toLowerCase()
  const existing = agent.memory.find((item) => item.text.toLowerCase() === needle)
  if (existing) return existing

  if (agent.memory.length >= MEMORY_MAX_ITEMS) {
    throw new Error(
      `Memory is full (${MEMORY_MAX_ITEMS} items). Tell the person, so they can say what to forget ` +
        "or remove it themselves in this agent's settings, under Memory."
    )
  }

  agent.memory.push(createMemoryItem(text))
  // The stored item, not the local one: on a reactive agent they are different objects, and a
  // caller comparing ids or editing it afterwards should reach the one in the settings.
  return agent.memory[agent.memory.length - 1]
}

/** A line fit to be stored, or an error the model can act on. */
function validMemoryText(raw: string): string {
  const text = normalizeMemoryText(raw ?? '')
  if (!text) throw new Error('Nothing to remember: the text is empty.')

  if (text.length > MEMORY_ITEM_MAX_LENGTH) {
    throw new Error(
      `Too long to remember (${text.length} characters, the limit is ${MEMORY_ITEM_MAX_LENGTH}). ` +
        'Shorten it to one brief fact or preference, in as few words as keep the meaning, and call remember again.'
    )
  }

  return text
}

/**
 * The index of the item a line names.
 *
 * The model addresses an item by what it reads in its prompt, which is the lines and nothing
 * else — so the whole line matches first, and a part of one is enough when only one item has
 * it. Anything else throws with the memory as it stands now, which is also how a model whose
 * prompt was built before a change finds out what is really there.
 */
function findMemoryIndex(agent: AgentDefinition, raw: string): number {
  const items = agent.memory ?? []
  const needle = normalizeMemoryText(raw ?? '').toLowerCase()
  if (!needle) throw new Error('Say which remembered line you mean: the text is empty.')
  if (!items.length) throw new Error('Nothing is remembered, so there is nothing to change or forget.')

  const exact = items.findIndex((item) => item.text.toLowerCase() === needle)
  if (exact !== -1) return exact

  const partial = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.text.toLowerCase().includes(needle))
  if (partial.length === 1) return partial[0].index

  const list = (found: AgentMemoryItem[]) => found.map((item) => `- ${item.text}`).join('\n')
  if (partial.length > 1) {
    throw new Error(
      `"${raw}" is in ${partial.length} remembered lines. Call again with the whole line you mean:\n` +
        list(partial.map(({ item }) => item))
    )
  }
  throw new Error(
    `Nothing remembered matches "${raw}". Name the line as it is written. What is remembered now:\n` +
      list(items)
  )
}

/** Removes the item a line names and returns it. See `findMemoryIndex` for how it is found. */
export function forgetMemory(agent: AgentDefinition, raw: string): AgentMemoryItem {
  const index = findMemoryIndex(agent, raw)
  return agent.memory!.splice(index, 1)[0]
}

/**
 * Rewrites the item a line names, keeping its id and its place, and returns it.
 *
 * The new line is held to the same rules as a new item. If another item already says it, the
 * old one is dropped and that one returned, so a change never leaves the same line twice.
 */
export function replaceMemory(agent: AgentDefinition, old: string, raw: string): AgentMemoryItem {
  const text = validMemoryText(raw)
  const index = findMemoryIndex(agent, old)
  const items = agent.memory!

  const twin = items.find((item, i) => i !== index && item.text.toLowerCase() === text.toLowerCase())
  if (twin) {
    items.splice(index, 1)
    return twin
  }

  const item = items[index]
  item.text = text
  item.created = createMemoryItem(text).created
  return item
}

/**
 * The memory as the model sees it, or nothing at all when there is none.
 *
 * A blank template means the default, the same way the other prompt settings behave. A
 * template that lost its placeholder still gets the list, after it: the person asked for these
 * to be remembered, and a typo in a setting should not quietly make the agent forget.
 */
export function renderMemory(items: AgentMemoryItem[] | undefined, template: string): string {
  const lines = (items ?? []).map((item) => item.text.trim()).filter(Boolean)
  if (!lines.length) return ''

  const list = lines.map((line) => `- ${line}`).join('\n')
  const chosen = template?.trim() ? template : DEFAULT_MEMORY_TEMPLATE

  if (!chosen.includes(MEMORY_PLACEHOLDER)) return `${chosen.trim()}\n\n${list}`
  return chosen.split(MEMORY_PLACEHOLDER).join(list).trim()
}
