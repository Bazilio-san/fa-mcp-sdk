import { authNTLM } from 'ya-express-ntlm';
import { Request, Response, NextFunction } from 'express';
import { tokenGenNtlmOptions } from './ntlm-auth-options.js';
import { checkTokenGenSession, getSessionStats } from './ntlm-session-storage.js';
import { getLoginPageHTML } from './ntlm-templates.js';
import { isNTLMEnabled } from './ntlm-domain-config.js';

// Create NTLM middleware instance (only if NTLM is enabled)
const ntlmMiddleware = isNTLMEnabled ? authNTLM(tokenGenNtlmOptions) : null;

// Main NTLM authentication setup function
export const setupNTLMAuthentication = () => {
  if (!isNTLMEnabled) {
    console.log('[TOKEN-GEN] NTLM authentication is DISABLED - skipping middleware setup');
    // Return middleware that just passes through
    return [(req: Request, res: Response, next: NextFunction) => {
      // Set dummy NTLM info for compatibility
      req.ntlm = {
        isAuthenticated: false,
        username: 'Anonymous',
        domain: 'NoAuth',
      };
      next();
    }];
  }

  return [
    // First check for existing session
    checkTokenGenSession(),

    // Then run NTLM authentication if needed
    (req: Request, res: Response, next: NextFunction) => {
      // Handle login page request
      if (req.path === '/login') {
        return res.send(getLoginPageHTML(req.ntlm?.username || ''));
      }

      // Handle logout request
      if (req.path === '/logout') {
        console.log(`[TOKEN-GEN] Logout requested by: ${req.ntlm?.domain || 'Unknown'}\\${req.ntlm?.username || 'Unknown'}`);
        // Clear session and send 401 to trigger browser auth prompt
        res.setHeader('WWW-Authenticate', 'NTLM');
        res.setHeader('Clear-Site-Data', '"cookies", "storage"');
        console.log('[TOKEN-GEN] Sending 401 response to trigger browser authentication prompt');
        return res.status(401).send('Authentication required - please login again');
      }

      // Add session debug endpoint (only in development)
      if (req.path === '/debug/sessions' && process.env.NODE_ENV !== 'production') {
        const stats = getSessionStats();
        return res.json({
          message: 'Token Generation Server Session Statistics',
          timestamp: new Date().toISOString(),
          ...stats,
        });
      }

      // Skip authentication for health checks if needed
      if (req.path === '/health') {
        return res.json({
          status: 'ok',
          service: 'token-generation-server',
          timestamp: new Date().toISOString(),
        });
      }

      // If user is already authenticated (from session), continue
      if (req.ntlm?.isAuthenticated) {
        console.log(`[TOKEN-GEN] Request from authenticated user: ${req.ntlm.domain}\\${req.ntlm.username} -> ${req.method} ${req.path}`);
        return next();
      }

      // Clear non-NTLM Authorization header (e.g., Basic auth cached by browser for same origin)
      // This forces NTLM middleware to send 401 with WWW-Authenticate: NTLM
      const authHeader = req.headers.authorization;
      if (authHeader && !authHeader.startsWith('NTLM ')) {
        console.log('[TOKEN-GEN] Clearing non-NTLM Authorization header to trigger NTLM auth');
        delete req.headers.authorization;
      }

      // Run NTLM authentication
      console.log(`[TOKEN-GEN] Starting NTLM authentication for: ${req.method} ${req.path}`);
      ntlmMiddleware!(req, res, next);
    },
  ];
};
