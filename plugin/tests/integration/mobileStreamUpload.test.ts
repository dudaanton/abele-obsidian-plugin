import { afterEach, it, vi } from 'vitest'
import { checkMobileUploadResume } from '../helpers/mobileUploadResume'
afterEach(() => vi.unstubAllGlobals())
it(
  'resumes a single whole-read 200 MiB mobile upload without resending received parts',
  () => checkMobileUploadResume(false),
  30000
)
