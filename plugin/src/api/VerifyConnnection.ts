import { ApiClient } from './Base'

export class VerifyConnectionApi extends ApiClient {
  async verifyConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // Request method now uses fetch
      const result = await this.request({
        url: '/api/auth/verify', // Custom endpoint assumed
        method: 'GET',
      })
      // Adjust based on actual response structure of /api/auth/verify
      return result && result.success === true // Example check
        ? { success: true }
        : {
            success: false,
            error: result?.message || 'Verification failed (unexpected response)',
          }
    } catch (error: any) {
      // Error handling is mostly within `request`, return formatted error
      return {
        success: false,
        error: error.message || 'Verification request failed',
      }
    }
  }
}
