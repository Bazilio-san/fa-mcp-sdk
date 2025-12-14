import { AuthResult } from './types.js';
import { appConfig } from '../bootstrap/init-config.js';

/**
 * Basic Authentication validation
 */
export function checkBasicAuth (credentials: string): AuthResult {
  const basic = appConfig.webServer?.auth?.basic;
  if (!basic?.username || !basic?.password) {
    return { success: false, error: 'Basic auth not configured' };
  }
  try {
    // Expecting base64 encoded "username:password"
    const decoded = Buffer.from(credentials, 'base64').toString('utf8');
    const [username, password] = decoded.split(':');

    if (!username || !password) {
      return { success: false, error: 'Invalid basic auth format - missing username or password' };
    }

    if (username === basic.username && password === basic.password) {
      return { success: true, username };
    }
    return { success: false, error: 'Invalid credentials' };
  } catch {
    return { success: false, error: 'Invalid basic auth format - not valid base64' };
  }
}
