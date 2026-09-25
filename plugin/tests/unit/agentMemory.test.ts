/**
 * What an agent was asked to remember: a few short lines, its own and nobody else's.
 *
 * The rules live in one module so the tool, the settings screen and the prompt agree on them —
 * how long a line may be, how many there may be, and what the model is shown.
 */
import { describe, it, expect } from 'vitest'
import { createAgent } from '@/ai/agents/types'
import {
  addMemory,
  forgetMemory,
  replaceMemory,
  renderMemory,
  DEFAULT_MEMORY_TEMPLATE,
  MEMORY_ITEM_MAX_LENGTH,
  MEMORY_MAX_ITEMS,
} from '@/ai/agents/memory'

describe('adding to an agent memory', () => {
  it('appends one item to the agent it was given', () => {
    const agent = createAgent()

    const item = addMemory(agent, 'Answer in Russian')

    expect(agent.memory).toEqual([item])
    expect(item.text).toBe('Answer in Russian')
    expect(item.id).toMatch(/\S/)
    expect(item.created).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('starts a memory on an agent saved before memory existed', () => {
    const agent = createAgent()
    delete agent.memory

    addMemory(agent, 'Call me Anton')

    expect(agent.memory?.map((m) => m.text)).toEqual(['Call me Anton'])
  })

  it('folds whitespace and line breaks into one line', () => {
    const agent = createAgent()

    const item = addMemory(agent, '  Prefer\n\n short   answers  ')

    expect(item.text).toBe('Prefer short answers')
  })

  it('refuses a line longer than the cap, and says to shorten it', () => {
    const agent = createAgent()

    expect(() => addMemory(agent, 'x'.repeat(MEMORY_ITEM_MAX_LENGTH + 1))).toThrow(/shorten/i)
    expect(agent.memory).toEqual([])
  })

  it('takes a line exactly at the cap', () => {
    const agent = createAgent()

    addMemory(agent, 'x'.repeat(MEMORY_ITEM_MAX_LENGTH))

    expect(agent.memory).toHaveLength(1)
  })

  it('refuses an empty line', () => {
    expect(() => addMemory(createAgent(), '   ')).toThrow()
  })

  it('does not store the same thing twice', () => {
    const agent = createAgent()
    addMemory(agent, 'Answer in Russian')

    const again = addMemory(agent, 'answer in russian')

    expect(agent.memory).toHaveLength(1)
    expect(again.id).toBe(agent.memory![0].id)
  })

  it('refuses once the memory is full, rather than growing the prompt forever', () => {
    const agent = createAgent()
    for (let i = 0; i < MEMORY_MAX_ITEMS; i++) addMemory(agent, `fact ${i}`)

    expect(() => addMemory(agent, 'one more')).toThrow(/full/i)
    expect(agent.memory).toHaveLength(MEMORY_MAX_ITEMS)
  })
})

describe('rendering memory into the prompt', () => {
  const items = [
    { id: '1', text: 'Answer in Russian', created: '2026-09-23' },
    { id: '2', text: 'The cat is called Bruno', created: '2026-09-23' },
  ]

  it('gives nothing at all for an empty memory', () => {
    expect(renderMemory([], DEFAULT_MEMORY_TEMPLATE)).toBe('')
    expect(renderMemory(undefined, DEFAULT_MEMORY_TEMPLATE)).toBe('')
  })

  it('puts the items as a bullet list where the template says', () => {
    const text = renderMemory(items, 'Remembered:\n{{memory}}\nEnd.')

    expect(text).toBe('Remembered:\n- Answer in Russian\n- The cat is called Bruno\nEnd.')
  })

  it('has a default that shows every item', () => {
    const text = renderMemory(items, DEFAULT_MEMORY_TEMPLATE)

    expect(text).toContain('- Answer in Russian')
    expect(text).toContain('- The cat is called Bruno')
  })

  it('tells the model by default that the person can have an item changed or forgotten', () => {
    expect(DEFAULT_MEMORY_TEMPLATE).toMatch(/forget/i)
    expect(DEFAULT_MEMORY_TEMPLATE).toMatch(/change/i)
  })

  it('falls back to the default when the template is blank', () => {
    expect(renderMemory(items, '  ')).toBe(renderMemory(items, DEFAULT_MEMORY_TEMPLATE))
  })

  it('still shows the items when the template forgot the placeholder', () => {
    const text = renderMemory(items, 'What you know about the person:')

    expect(text).toBe(
      'What you know about the person:\n\n- Answer in Russian\n- The cat is called Bruno'
    )
  })
})

describe('forgetting an item', () => {
  function withMemory(...texts: string[]) {
    const agent = createAgent()
    for (const text of texts) addMemory(agent, text)
    return agent
  }

  it('removes the item whose line is given, and returns it', () => {
    const agent = withMemory('Answer in Russian', 'The cat is called Bruno')

    const gone = forgetMemory(agent, 'the cat is called  bruno')

    expect(gone.text).toBe('The cat is called Bruno')
    expect(agent.memory?.map((m) => m.text)).toEqual(['Answer in Russian'])
  })

  it('finds the item by a part of its line when only one item has it', () => {
    const agent = withMemory('Answer in Russian', 'The cat is called Bruno')

    forgetMemory(agent, 'cat')

    expect(agent.memory?.map((m) => m.text)).toEqual(['Answer in Russian'])
  })

  it('takes the exact line over the ones that merely contain it', () => {
    const agent = withMemory('Use tabs', 'Use tabs in Makefiles only')

    forgetMemory(agent, 'Use tabs')

    expect(agent.memory?.map((m) => m.text)).toEqual(['Use tabs in Makefiles only'])
  })

  it('removes nothing when a part matches several items, and names them', () => {
    const agent = withMemory('The cat is called Bruno', 'The cat eats fish')

    expect(() => forgetMemory(agent, 'cat')).toThrow(/The cat is called Bruno[\s\S]*The cat eats fish/)
    expect(agent.memory).toHaveLength(2)
  })

  it('says what is remembered when nothing matches', () => {
    const agent = withMemory('Answer in Russian')

    expect(() => forgetMemory(agent, 'dog')).toThrow(/Answer in Russian/)
    expect(agent.memory).toHaveLength(1)
  })

  it('says so when there is nothing remembered at all', () => {
    const agent = createAgent()
    delete agent.memory

    expect(() => forgetMemory(agent, 'anything')).toThrow(/nothing/i)
  })

  it('refuses an empty line rather than pick an item', () => {
    const agent = withMemory('Answer in Russian')

    expect(() => forgetMemory(agent, '  ')).toThrow()
    expect(agent.memory).toHaveLength(1)
  })
})

describe('changing an item', () => {
  it('rewrites the item in place, keeping its id and its place in the list', () => {
    const agent = createAgent()
    addMemory(agent, 'Answer in Russian')
    const cat = addMemory(agent, 'The cat is called Bruno')
    addMemory(agent, 'Use tabs')

    const changed = replaceMemory(agent, 'cat', 'The cat is called Felix')

    expect(changed.id).toBe(cat.id)
    expect(agent.memory?.map((m) => m.text)).toEqual([
      'Answer in Russian',
      'The cat is called Felix',
      'Use tabs',
    ])
  })

  it('holds the new line to the same rules as a new item', () => {
    const agent = createAgent()
    addMemory(agent, 'Answer in Russian')

    expect(() => replaceMemory(agent, 'Russian', 'x'.repeat(MEMORY_ITEM_MAX_LENGTH + 1))).toThrow(
      /shorten/i
    )
    expect(() => replaceMemory(agent, 'Russian', '  ')).toThrow()
    expect(agent.memory?.map((m) => m.text)).toEqual(['Answer in Russian'])
  })

  it('works on a full memory, since it adds nothing', () => {
    const agent = createAgent()
    for (let i = 0; i < MEMORY_MAX_ITEMS; i++) addMemory(agent, `fact ${i}`)

    replaceMemory(agent, 'fact 7', 'fact seven')

    expect(agent.memory).toHaveLength(MEMORY_MAX_ITEMS)
    expect(agent.memory?.[7].text).toBe('fact seven')
  })

  it('folds into the item already saying the new line instead of keeping two', () => {
    const agent = createAgent()
    addMemory(agent, 'Answer in Russian')
    const english = addMemory(agent, 'Answer in English')

    const kept = replaceMemory(agent, 'Russian', 'answer in english')

    expect(kept.id).toBe(english.id)
    expect(agent.memory?.map((m) => m.text)).toEqual(['Answer in English'])
  })

  it('changes nothing when the old line is not found', () => {
    const agent = createAgent()
    addMemory(agent, 'Answer in Russian')

    expect(() => replaceMemory(agent, 'dog', 'The dog is called Rex')).toThrow(/Answer in Russian/)
    expect(agent.memory?.map((m) => m.text)).toEqual(['Answer in Russian'])
  })
})
