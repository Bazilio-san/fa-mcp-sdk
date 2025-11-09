import { BaseMcpError } from './BaseMcpError.js';

export class ValidationError extends BaseMcpError {
  constructor (message: string, printed?: boolean) {
    super('VALIDATION_ERROR', message, undefined, 400, printed);
  }
}
