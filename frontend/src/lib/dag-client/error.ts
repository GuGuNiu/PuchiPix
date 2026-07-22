/**
 * DAG clientErrortype
 */

export class DagClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'DagClientError';
  }

  
  isNetworkError(): boolean {
    return this.statusCode === undefined;
  }

  
  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  /**
   * CheckisnotoserverError（5xx）
   */
  isServerError(): boolean {
    return this.statusCode !== undefined && this.statusCode >= 500;
  }
}
