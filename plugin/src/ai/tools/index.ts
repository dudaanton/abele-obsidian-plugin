import type { AgentTool } from '../client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { createReadFileTool } from './ReadFileTool'
import { createLsTool } from './LsTool'
import { createFindTool } from './FindTool'
import { createEditFileTool } from './EditFileTool'
import { createCreateFileTool } from './CreateFileTool'
import { createDeleteFileTool } from './DeleteFileTool'
import { createMoveFileTool } from './MoveFileTool'
import { createCopyFileTool } from './CopyFileTool'
import { createListWorkspaceTool } from './ListWorkspaceTool'
import { createWebSearchTool } from './WebSearchTool'
import { createReadImageTool } from './ReadImageTool'
import { createFetchTool } from './FetchTool'
import { createSkillTool } from './SkillTool'
import { createWiseModelTool } from './WiseModelTool'
import { createGenerateImageTool } from './GenerateImageTool'
import { createEditImageTool } from './EditImageTool'
import { createEvalJsTool } from './EvalJsTool'

export function createAgentTools(): AgentTool[] {
  const tools = [
    createReadFileTool(),
    createLsTool(),
    createFindTool(),
    createEditFileTool(),
    createCreateFileTool(),
    createDeleteFileTool(),
    createMoveFileTool(),
    createCopyFileTool(),
    createListWorkspaceTool(),
    createWebSearchTool(),
    createReadImageTool(),
    createFetchTool(),
    createSkillTool(),
    createWiseModelTool(),
    createGenerateImageTool(),
    createEditImageTool(),
    createEvalJsTool(),
  ]

  const customDescriptions = AbeleConfig.getInstance().ai.prompts?.toolDescriptions
  if (customDescriptions) {
    for (const tool of tools) {
      if (customDescriptions[tool.name]) {
        tool.description = customDescriptions[tool.name]
      }
    }
  }

  return tools
}
