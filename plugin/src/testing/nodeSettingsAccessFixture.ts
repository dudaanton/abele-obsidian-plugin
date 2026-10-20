import { defineComponent, h, onMounted, onUnmounted } from 'vue'
import { NodeService } from '@/node/NodeService'
import NodesSettings from '@/components/settings/NodesSettings.vue'

/** Render the real settings rows without registering or connecting a node. */
export const NodeSettingsAccessFixture = defineComponent({
  setup() {
    const original = NodeService.getInstance
    const service = {
      nodes: {
        value: [{ id: 'sample-node', label: 'Sample node', url: 'https://node.example.invalid' }],
      },
      connection: () => ({ state: { value: 'connected' }, error: { value: '' } }),
    }
    NodeService.getInstance = () => service as unknown as NodeService
    const restore = () => {
      NodeService.getInstance = original
    }
    onMounted(restore)
    onUnmounted(restore)
    return () => h(NodesSettings)
  },
})
