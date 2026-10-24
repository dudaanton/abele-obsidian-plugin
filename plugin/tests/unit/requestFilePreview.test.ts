import { expect, it, vi } from 'vitest'
import { RequestsModel } from '@/requests/RequestsModel'
import { fakeNode, doc, ports } from '../helpers/requestsFakeNode'
const context = vi.hoisted(() => ({ model: undefined as unknown }))
vi.mock('@/requests/RequestsService', () => ({
  RequestsService: {
    instance: () => ({
      context: { value: { registrationId: 'sample-node', projectId: 'sample-project' } },
      model: () => context.model,
    }),
  },
}))
import { sendPreview } from '@/requests/agentContext'

it.each([false, true])(
  'previews a file environment without exposing its secret, selected=%s',
  async (selected) => {
    const node = fakeNode()
    const id = 'Samples/Authorized.http'
    node.files.set(
      id,
      doc({
        url: '{{base}}/samples',
        headers: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
      })
    )
    const model = new RequestsModel(
      node.rpc,
      'sample-project',
      ports({
        files: {
          list: async () => ['sample.http', 'http-client.env.json'],
          read: async (path) => ({
            text: path.endsWith('.json')
              ? '{"dev":{"base":"https://example.test","token":"sample-private-value"}}'
              : 'GET https://example.test',
            contentId: path,
          }),
          write: async () => {},
          watch: async () => () => {},
        },
      })
    )
    context.model = model
    await model.load()
    const name = model.files!.environments[0].id
    if (selected) await model.selectEnvironment(name)
    const preview = await sendPreview(id, name)
    expect(preview?.text).toContain('https://example.test/samples')
    expect(preview?.text).not.toContain('sample-private-value')
  }
)
