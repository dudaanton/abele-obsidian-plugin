import { shallowRef } from 'vue'
import { openNodeFolderPicker } from '@/node/NodePathDialogs'
import type { NodeConnection } from '@/node/NodeService'
import type { NodePathModel } from '@/node/NodePathModel'

const HOME = '/home/username'
const NAMES = [
  'archive',
  'design-notes',
  'garden-planner',
  'invoice-tools',
  'kitchen-recipes',
  'map-tiles',
  'photo-sorter',
  'reading-list',
  'sample-service',
  'sample-site',
  'travel-log',
  'weather-station',
]

/**
 * The node's "Open folder on node" dialog, through the opener the plugin uses, over a made-up
 * home folder with more folders than the list shows at once.
 */
export function nodeFolderPickerFixture(): Promise<void> {
  const model = {
    capabilities: shallowRef(['node_path_v2']),
    folders: shallowRef([]),
    targets: shallowRef([]),
  } as unknown as NodePathModel
  const listing = (path: string) => ({
    path,
    directory_id: `dir-${path}`,
    entries:
      path === HOME
        ? NAMES.map((name) => ({ name, path: `${HOME}/${name}`, inspected: false }))
        : [],
    cursor: null as string | null,
    incomplete: false,
    omissions: [] as string[],
  })
  const connection = {
    state: shallowRef('connected'),
    client: {
      nodePath: {
        directories: (args: { path?: string }) => Promise.resolve(listing(args.path ?? HOME)),
      },
    },
  } as unknown as NodeConnection
  return openNodeFolderPicker(model, connection)
}
