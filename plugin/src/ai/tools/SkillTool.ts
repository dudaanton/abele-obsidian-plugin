import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { TFile } from 'obsidian'
import { describedLazily } from './lazyDescription'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentRegistry } from '../agents/AgentRegistry'
import type { AgentDefinition } from '../agents/types'
import type { ScopeResolver } from '../ScopeResolver'

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
      if (cache.frontmatter.enabled === false) continue
      results.push({
        path: file.path,
        name: String(name),
        description: String(cache.frontmatter.description || ''),
      })
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name))
}

/** Instructions are offered only from the chosen folder or the caller's scope. */
export function offeredSkills(agent: AgentDefinition | null, scope?: ScopeResolver): SkillInfo[] {
  const folder = (AbeleConfig.getInstance().ai?.skillsFolder ?? '').trim().replace(/^\/+|\/+$/g, '')
  const reachable = discoverSkills().filter(
    (skill) => (folder && skill.path.startsWith(`${folder}/`)) || scope?.isInScope(skill.path)
  )
  return agent ? AgentRegistry.getInstance().visibleSkills(agent, reachable) : reachable
}

export function skillNeedsApproval(
  name: unknown,
  agent: AgentDefinition | null,
  scope: ScopeResolver,
  ceiling?: ReadonlySet<string>
): boolean {
  return (
    typeof name === 'string' &&
    (!offeredSkills(agent, scope).some((skill) => skill.name === name) ||
      (!!ceiling && !ceiling.has(name)))
  )
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

export function createSkillTool(
  options: { agentId?: string; scope?: ScopeResolver; skillCeiling?: ReadonlySet<string> } = {}
): AgentTool {
  const agentOf = (id = options.agentId) => (id ? AgentRegistry.getInstance().get(id) : null)
  const tool: Omit<AgentTool, 'description'> = {
    name: 'skill',
    label: 'Skill',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill name to load' },
      },
      required: ['name'],
    },
    execute: async (_id, params, _signal, ctx) => {
      const skillName = params.name as string
      if (!skillName) throw new Error('Missing required parameter: name')

      const agent = agentOf(ctx?.agentId)
      if (
        ctx &&
        !ctx.approved &&
        skillNeedsApproval(skillName, agent, ctx.scope, ctx.skillCeiling)
      ) {
        throw new Error(
          `Skill "${skillName}" requires approval: it is not offered by this agent's skills folder, scope and selection.`
        )
      }
      const content = await loadSkillContent(skillName)
      if (content === null) {
        const available = offeredSkills(agent, ctx?.scope ?? options.scope)
          .map((s) => s.name)
          .join(', ')
        throw new Error(`Skill "${skillName}" not found. Available: ${available || 'none'}`)
      }

      return { content: [{ type: 'text', text: content }] }
    },
  }
  return describedLazily(tool, () =>
    buildDescription(
      GlobalStore.getInstance().app
        ? offeredSkills(agentOf(), options.scope).filter(
            (skill) => !options.skillCeiling || options.skillCeiling.has(skill.name)
          )
        : []
    )
  )
}
