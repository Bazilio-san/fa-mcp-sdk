import { IUserData } from 'ya-express-ntlm';

export type TNtlm = Partial<IUserData> & {
  uri?: string, // For debug
}

declare global {
  namespace Express {
    export interface Request {
      ntlm: TNtlm,
      requestSource?: string,
    }
  }
}
