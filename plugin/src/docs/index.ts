import overview from './overview.md?raw'
import vault from './vault.md?raw'
import agent from './agent.md?raw'
import tools from './tools.md?raw'
import scripts from './scripts.md?raw'
import templates from './templates.md?raw'
import commands from './commands.md?raw'

/**
 * The plugin's reference, written for agents rather than for people.
 *
 * Markdown files rather than strings in a source file: they are edited and reviewed as prose,
 * which is what they are. Each file is one section — a `# ` title, a paragraph saying what is
 * in it, then `## ` topics. Nothing else is parsed, so a section is written by writing it.
 *
 * The shape exists to keep the reading cheap: an agent that needs one answer should not be
 * paying for the whole reference, so the table of contents is small, a section is a summary
 * plus its topic names, and only a named topic returns prose.
 */

export interface DocTopic {
  id: string
  title: string
  text: string
}

export interface DocSection {
  id: string
  title: string
  /** The paragraph between the title and the first topic. */
  summary: string
  topics: DocTopic[]
}

const FILES: [id: string, source: string][] = [
  ['overview', overview],
  ['vault', vault],
  ['agent', agent],
  ['tools', tools],
  ['scripts', scripts],
  ['templates', templates],
  ['commands', commands],
]

export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function parse(id: string, source: string): DocSection {
  const lines = source.split('\n')
  const title = lines[0].replace(/^#\s*/, '').trim()

  const topics: DocTopic[] = []
  const summaryLines: string[] = []
  let current: DocTopic | null = null

  for (const line of lines.slice(1)) {
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading) {
      current = { id: slug(heading[1]), title: heading[1].trim(), text: '' }
      topics.push(current)
      continue
    }
    if (current) current.text += line + '\n'
    else summaryLines.push(line)
  }

  for (const topic of topics) topic.text = topic.text.trim()

  return { id, title, summary: summaryLines.join('\n').trim(), topics }
}

export const DOCS: DocSection[] = FILES.map(([id, source]) => parse(id, source))

/** Every section, with what is in it — the cheapest thing to read and the way in. */
export function tableOfContents(): string {
  const lines = ['# Abele reference', '', 'Sections, to be asked for by id:', '']
  for (const section of DOCS) {
    lines.push(`- **${section.id}** — ${section.title}: ${firstLine(section.summary)}`)
  }
  lines.push('', 'Ask for a section to see its topics, then for a topic to read it.')
  return lines.join('\n')
}

export function readSection(id: string): string | null {
  const section = DOCS.find((s) => s.id === id)
  if (!section) return null

  const lines = [`# ${section.title}`, '', section.summary, '', '## Topics in this section', '']
  for (const topic of section.topics) {
    lines.push(`- **${topic.id}** — ${topic.title}`)
  }
  return lines.join('\n')
}

export function readTopic(sectionId: string, topicId: string): string | null {
  const section = DOCS.find((s) => s.id === sectionId)
  const topic = section?.topics.find((t) => t.id === topicId)
  if (!section || !topic) return null

  return `# ${section.title} — ${topic.title}\n\n${topic.text}`
}

/**
 * Where a word appears, as a list of topics to open next rather than as prose.
 *
 * Matching is on whole words, case-insensitively, over the title and the text: a search for
 * "due" should find the task property and not every sentence containing "produced".
 */
export function searchDocs(query: string): string {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .filter((term) => term.length > 1)
  if (!terms.length) return 'Nothing to search for.'

  const hits: { section: DocSection; topic: DocTopic; score: number }[] = []
  for (const section of DOCS) {
    for (const topic of section.topics) {
      const haystack = `${topic.title}\n${topic.text}`.toLowerCase()
      let score = 0
      for (const term of terms) {
        const matches = haystack.match(new RegExp(`\\b${escape(term)}\\b`, 'g'))
        if (matches) score += matches.length
        if (topic.title.toLowerCase().includes(term)) score += 5
      }
      if (score) hits.push({ section, topic, score })
    }
  }

  if (!hits.length) return `Nothing in the reference mentions "${query}".`

  hits.sort((a, b) => b.score - a.score)
  const lines = [`Topics mentioning "${query}", best first:`, '']
  for (const hit of hits.slice(0, 8)) {
    lines.push(`- **${hit.section.id} / ${hit.topic.id}** — ${hit.topic.title}`)
  }
  return lines.join('\n')
}

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function firstLine(summary: string): string {
  const sentence = summary.replace(/\s+/g, ' ').trim()
  const stop = sentence.indexOf('. ')
  return stop === -1 ? sentence : sentence.slice(0, stop + 1)
}
