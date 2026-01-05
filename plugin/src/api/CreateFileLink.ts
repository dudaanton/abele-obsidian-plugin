import { Notice } from 'obsidian'
import { ApiClient } from './Base'

interface UploadResponse {
  slug: string
}

export class CreateFileLinkApi extends ApiClient {
  async createFileLink(file: File): Promise<UploadResponse> {
    const formData = new FormData()
    formData.append('file', file, file.name)

    // Use the internal request method which now uses fetch
    // No need to set Content-Type, fetch handles it for FormData
    try {
      const result = await this.request({
        url: `/api/file-link`, // Relative URL, request method prepends baseUrl
        method: 'POST',
        body: formData,
        // contentType is omitted, fetch sets it correctly for FormData
      })
      return result as UploadResponse // Strapi returns an array
    } catch (error) {
      // Error handling (logging, notice) is done within the `request` method
      // Re-throw or handle specific upload errors if needed
      console.error('File Upload specific error context:', error)
      // Optionally add a more specific notice for upload failure
      new Notice('File upload failed. Please check the details in the console.')
      throw error // Ensure error propagates
    }
  }
}
