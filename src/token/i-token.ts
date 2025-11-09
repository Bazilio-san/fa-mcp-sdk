export type TTokenType = 'permanent' | 'JWT';

export interface ITokenPayload {
  user: string,
  expire: number,
  [key: string]: any,
}

export interface ICheckTokenResult {
  inTokenType?: TTokenType
  payload?: ITokenPayload,
  // errorReason is returned only if there is an error. If it is empty, the check is OK
  errorReason?: string,
  isTokenDecrypted?: boolean,
}
