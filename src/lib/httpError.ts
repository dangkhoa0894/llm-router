export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (resource: string) => new HttpError(404, `${resource} not found`);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const conflict = (message: string) => new HttpError(409, message);
