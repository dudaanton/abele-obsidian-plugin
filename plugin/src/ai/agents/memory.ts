import { nanoid } from 'nanoid'
import dayjs from 'dayjs'
import type { AgentDefinition, AgentMemoryItem } from './types'

/** The tool an agent calls to remember something. On for every agent unless switched off. */
export const REMEMBER_TOOL = 'remember'

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
  'Things the person asked you to remember. They hold in every conversation until the person says otherwise.',
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
  const text = normalizeMemoryText(raw ?? '')
  if (!text) throw new Error('Nothing to remember: the text is empty.')

  if (text.length > MEMORY_ITEM_MAX_LENGTH) {
    throw new Error(
      `Too long to remember (${text.length} characters, the limit is ${MEMORY_ITEM_MAX_LENGTH}). ` +
        'Shorten it to one brief fact or preference, in as few words as keep the meaning, and call remember again.'
    )
  }

  if (!agent.memory) agent.memory = []

  const needle = text.toLowerCase()
  const existing = agent.memory.find((item) => item.text.toLowerCase() === needle)
  if (existing) return existing

  if (agent.memory.length >= MEMORY_MAX_ITEMS) {
    throw new Error(
      `Memory is full (${MEMORY_MAX_ITEMS} items). Tell the person, so they can remove what is no ` +
        "longer needed in this agent's settings, under Memory."
    )
  }

  agent.memory.push(createMemoryItem(text))
  // The stored item, not the local one: on a reactive agent they are different objects, and a
  // caller comparing ids or editing it afterwards should reach the one in the settings.
  return agent.memory[agent.memory.length - 1]
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
