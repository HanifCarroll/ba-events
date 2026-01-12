/**
 * HTTP Error class for distinguishing HTTP-specific errors.
 * Allows enrichment logic to detect 404s and mark events as cancelled.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string
  ) {
    super(`HTTP ${status} ${statusText} for ${url}`)
    this.name = 'HttpError'
  }

  /** Returns true for 404 and 410 (event no longer exists) */
  get isNotFound(): boolean {
    return this.status === 404 || this.status === 410
  }

  /** Returns true for server errors (potentially retryable) */
  get isServerError(): boolean {
    return this.status >= 500 && this.status < 600
  }
}
