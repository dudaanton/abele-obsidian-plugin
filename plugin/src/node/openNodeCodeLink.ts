import { UiError, uiMessage, uiFieldMessage } from '@/i18n/streamBErrors'
import { nodeCodeLinkTarget } from './codeLinks'
import { NodeService } from './NodeService'
import { NodePathService } from './NodePathService'
import { openNodeChatResource } from './nodeChatPlace'

/** Owner navigation uses this device's node access, never the agent's chat scope. */
export async function openNodeCodeLink(resource: string): Promise<void> {
  const saved = nodeCodeLinkTarget(resource)
  if (!saved) throw new UiError(uiMessage('streamB.invalidNodeCodeLink'))
  const service = NodeService.getInstance()
  const nodes = service.nodes.value.filter((node) => node.expectedNodeId === saved.nodeId)
  if (nodes.length !== 1) throw new UiError(uiMessage('streamBError.29f8c77828'))
  const registrationId = nodes[0].id
  await service.connection(registrationId).connect()
  const paths = NodePathService.getInstance()
  await paths.ready(registrationId)
  const model = paths.model(registrationId)
  const target = model.targets.value.find(
    (target) =>
      target.nodeId === saved.nodeId &&
      target.projectId === saved.projectId &&
      target.kind === saved.kind &&
      target.id === saved.id
  )
  if (!target)
    throw new UiError(
      model.error.value
        ? uiFieldMessage(model.error, 'value')
        : uiMessage('node.error.folderUnavailable')
    )
  await openNodeChatResource(resource, target)
}
