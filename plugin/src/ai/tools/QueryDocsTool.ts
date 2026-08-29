import type { AgentTool } from '../client'
import { DOCS, tableOfContents, readSection, readTopic, searchDocs } from '@/docs'

/**
 * The plugin's own reference, read a piece at a time.
 *
 * Handing over the whole thing on every question would cost more than the answers are worth, so
 * the tool is a way down rather than a document: no arguments gives the sections, a section
 * gives its topics, a topic gives the prose. `query` is the shortcut for when the right topic
 * is not obvious from its name.
 */
export function createQueryDocsTool(): AgentTool {
  return {
    name: 'query_docs',
    label: 'Query docs',
    description:
      'Read the Abele plugin reference: how this vault stores tasks, transactions, time ' +
      'entries and logs, what the agent tools do, and how scripts and templates work. Call ' +
      'with no arguments for the list of sections, then with `section`, then with `section` ' +
      'and `topic`. Use `query` to find which topic covers something.',
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: `Section id. One of: ${DOCS.map((s) => s.id).join(', ')}`,
        },
        topic: {
          type: 'string',
          description: 'Topic id within the section, as listed by asking for the section',
        },
        query: {
          type: 'string',
          description: 'Words to look for, when the right section is not obvious',
        },
      },
    },
    execute: async (_id, params) => {
      const section = typeof params.section === 'string' ? params.section : ''
      const topic = typeof params.topic === 'string' ? params.topic : ''
      const query = typeof params.query === 'string' ? params.query : ''

      const text = answer(section, topic, query)
      return { content: [{ type: 'text', text }] }
    },
  }
}

function answer(section: string, topic: string, query: string): string {
  if (query) return searchDocs(query)
  if (!section) return tableOfContents()

  if (topic) {
    const found = readTopic(section, topic)
    if (found) return found
    // Naming a topic that is not there is worth answering with the section rather than with a
    // refusal: the list of topics is exactly what was being looked for.
    const fallback = readSection(section)
    return fallback
      ? `No topic "${topic}" in "${section}".\n\n${fallback}`
      : unknownSection(section)
  }

  return readSection(section) ?? unknownSection(section)
}

function unknownSection(section: string): string {
  return `No section "${section}".\n\n${tableOfContents()}`
}
