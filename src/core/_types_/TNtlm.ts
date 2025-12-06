import { IUserData } from 'ya-express-ntlm';

export type TNtlm = Partial<IUserData> & {
  uri?: string, // For debug
}
