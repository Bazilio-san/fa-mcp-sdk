import { TNtlm } from './TNtlm.js';

declare global {
  namespace Express {
    export interface Request {
      ntlm: TNtlm,
      requestSource?: string,
    }
  }
}
