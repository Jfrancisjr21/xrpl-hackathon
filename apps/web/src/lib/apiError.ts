/** A non-2xx answer from the API (or status 0 when it can't be reached), with the contract's ErrorResponse fields. */
export class ApiError extends Error {
  status: number;
  opensAt: string | null;
  constructor(message: string, status: number, opensAt: string | null = null) {
    super(message);
    this.status = status;
    this.opensAt = opensAt;
  }
}
