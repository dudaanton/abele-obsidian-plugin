import { afterEach, it, vi } from 'vitest'
import { checkMobileUploadResume } from '../helpers/mobileUploadResume'
afterEach(() => vi.unstubAllGlobals())
// Separate module isolation keeps legacy whole-read lifetime peaks out of this budget.
it(
  'resumes a streamed 200 MiB upload without resending parts or retaining the whole file',
  () => checkMobileUploadResume(true),
  30000
)
