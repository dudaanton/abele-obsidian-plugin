import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { TFile } from 'obsidian'

export interface SkillInfo {
  path: string
  name: string
  description: string
}

export function discoverSkills(): SkillInfo[] {
  const { app } = GlobalStore.getInstance()
  const results: SkillInfo[] = []
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file)
    if (cache?.frontmatter?.type === 'abele-skill') {
      const name = cache.frontmatter.name
      if (!name) continue
      results.push({
        path: file.path,
        name: String(name),
        description: String(cache.frontmatter.description || ''),
      })
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadSkillContent(skillName: string): Promise<string | null> {
  const { app } = GlobalStore.getInstance()
  const skills = discoverSkills()
  const skill = skills.find((s) => s.name === skillName)
  if (!skill) return null

  const file = app.vault.getAbstractFileByPath(skill.path)
  if (!(file instanceof TFile)) return null

  const content = await app.vault.read(file)
  return content.replace(/^---[\s\S]*?---\n?/, '').trim() || null
}

function buildDescription(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return 'Load a skill by name to get detailed instructions for a specific task. No skills are currently available.'
  }

  const list = skills
    .map((s) => `- ${s.name}${s.description ? ': ' + s.description : ''}`)
    .join('\n')

  return `Load a skill by name to get detailed instructions for a specific task. When a user's request matches a skill, invoke it to get full instructions before proceeding.

Available skills:
${list}`
}

export function createSkillTool(): AgentTool {
  const skills = discoverSkills()

  return {
    name: 'skill',
    label: 'Skill',
    description: buildDescription(skills),
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill name to load' },
      },
      required: ['name'],
    },
    execute: async (_id, params) => {
      const skillName = params.name as string
      if (!skillName) throw new Error('Missing required parameter: name')

      const content = await loadSkillContent(skillName)
      if (content === null) {
        const available = discoverSkills()
          .map((s) => s.name)
          .join(', ')
        throw new Error(`Skill "${skillName}" not found. Available: ${available || 'none'}`)
      }

      return { content: [{ type: 'text', text: content }] }
    },
  }
}
