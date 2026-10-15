import { shallowRef } from 'vue'
import type { NodeAccessWant } from '@/ai/tools/node/accessRefusal'

/** Set by a refusal's button; the access section takes it when it opens and puts it in place. */
export const pendingNodeAccess = shallowRef<NodeAccessWant | null>(null)
