import { Request, Response, NextFunction } from 'express';
import { IUserData } from 'ya-express-ntlm';

// In-memory session storage (resets on server restart as required)
const sessionStorage = new Map<string, IUserData>();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

interface SessionData extends IUserData {
  lastAccess: number;
}

// Generate session ID from request
const getSessionId = (req: Request): string => {
  const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
  const userAgent = req.get('User-Agent') || 'unknown';
  // Simple hash for session ID
  return Buffer.from(`${ip}-${userAgent}`).toString('base64').substring(0, 32);
};

// Clean expired sessions
const cleanExpiredSessions = () => {
  const now = Date.now();
  for (const [sessionId, session] of sessionStorage.entries()) {
    if (now - (session as SessionData).lastAccess > SESSION_TIMEOUT) {
      sessionStorage.delete(sessionId);
    }
  }
};

// Get session data
export const getTokenGenSessionData = (req: Request): Partial<IUserData> => {
  cleanExpiredSessions();
  const sessionId = getSessionId(req);
  const session = sessionStorage.get(sessionId) as SessionData;

  if (session && session.isAuthenticated) {
    session.lastAccess = Date.now();
    sessionStorage.set(sessionId, session);
    return session;
  }

  return {};
};

// Set session data
export const setTokenGenSessionData = (req: Request, userData: IUserData): void => {
  const sessionId = getSessionId(req);
  const sessionData: SessionData = {
    ...userData,
    lastAccess: Date.now(),
    isAuthenticated: true,
  };
  sessionStorage.set(sessionId, sessionData);
  console.log(`[TOKEN-GEN] Session created for user: ${userData.username} from domain: ${userData.domain}`);
};

// Remove session
export const removeTokenGenSession = (req: Request): void => {
  const sessionId = getSessionId(req);
  sessionStorage.delete(sessionId);
  console.log(`[TOKEN-GEN] Session removed for ID: ${sessionId}`);
};

// Session middleware for checking authentication
export const checkTokenGenSession = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const sessionData = getTokenGenSessionData(req);

    if (sessionData.isAuthenticated) {
      req.ntlm = sessionData;
      return next();
    }

    // No valid session, proceed with NTLM authentication
    next();
  };
};

// Get session statistics (for debugging)
export const getSessionStats = () => {
  cleanExpiredSessions();
  return {
    activeSessions: sessionStorage.size,
    sessions: Array.from(sessionStorage.entries()).map(([id, data]) => ({
      id: id.substring(0, 8) + '...',
      username: (data as SessionData).username,
      domain: (data as SessionData).domain,
      lastAccess: new Date((data as SessionData).lastAccess).toISOString(),
    })),
  };
};
