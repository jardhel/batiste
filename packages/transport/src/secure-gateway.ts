/**
 * Secure Gateway
 *
 * HTTPS server that wraps MCP Server instances with:
 * - TLS (custom certs for prod)
 * - Rate limiting per IP/session
 * - Request validation (size, content-type, IP allowlist)
 * - Session management (concurrent limits, timeouts)
 *
 * Uses native node:http/node:https — zero HTTP framework deps.
 *
 * Because the MCP SDK Server only supports one transport at a time,
 * the gateway accepts a factory function that creates a new Server
 * instance for each session.
 */

import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { RateLimiter } from './rate-limiter.js';
import { RequestValidator, getClientIp } from './request-validator.js';
import { SessionManager } from './session-manager.js';
import { TlsManager } from './tls-manager.js';
import { GatewayConfigSchema, type GatewayConfig } from './types.js';
import { PerformanceTracker } from './performance-tracker.js';

export interface GatewayHandle {
  /** Stop the gateway server */
  close(): Promise<void>;
  /** Get the actual port (useful if port 0 was used) */
  port: number;
  /** Get the session manager for inspection */
  sessions: SessionManager;
  /** Live performance metrics (latency histogram + reliability) */
  metrics: PerformanceTracker;
}

/** Context passed to the server factory when a new session is created */
export interface SessionContext {
  /** Bearer token extracted from the Authorization header */
  authToken?: string;
  /** Client IP address */
  clientIp: string;
  /** Unique session ID */
  sessionId: string;
}

/** Factory that creates a fresh MCP Server for each session */
export type McpServerFactory = (ctx?: SessionContext) => Server;

export async function startGateway(
  serverFactory: McpServerFactory,
  rawConfig: Partial<GatewayConfig> = {},
): Promise<GatewayHandle> {
  const config = GatewayConfigSchema.parse(rawConfig);
  const security = config.security;

  const rateLimiter = new RateLimiter(security.rateLimit);
  const requestValidator = new RequestValidator(security);
  const sessionManager = new SessionManager({
    maxConcurrentSessions: config.maxConcurrentSessions,
    sessionTimeoutMs: config.sessionTimeoutMs,
  });

  // Map of MCP session ID -> { transport, server }
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();

  const tracker = new PerformanceTracker();

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? '/';
    const startMs = Date.now();

    // Wrap res.writeHead to capture final status for reliability tracking
    const origWriteHead = res.writeHead.bind(res) as typeof res.writeHead;
    let statusCode = 200;
    res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
      statusCode = typeof args[0] === 'number' ? args[0] : statusCode;
      return origWriteHead(...args);
    }) as typeof res.writeHead;

    res.on('finish', () => {
      // Skip metrics/health endpoints from tracking
      if (url !== '/metrics' && url !== '/health') {
        tracker.record(Date.now() - startMs, statusCode < 500);
      }
    });

    // CORS preflight
    if (req.method === 'OPTIONS') {
      handleCors(res, security.cors?.origins ?? []);
      return;
    }

    // Health check endpoint
    if (url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        sessions: sessionManager.size,
        uptime: process.uptime(),
      }));
      return;
    }

    // Metrics endpoint
    if (url === '/metrics' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tracker.summary()));
      return;
    }

    // Only handle /mcp
    if (url !== '/mcp') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // Validate request
    const validation = requestValidator.validateRequest(req);
    if (!validation.valid) {
      res.writeHead(validation.statusCode ?? 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: validation.error },
        id: null,
      }));
      return;
    }

    // Rate limiting
    const clientIp = getClientIp(req);
    if (!rateLimiter.consume(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Rate limit exceeded' },
        id: null,
      }));
      return;
    }

    // Add CORS headers
    if (security.cors) {
      setCorsHeaders(res, security.cors.origins);
    }

    if (req.method === 'POST') {
      const body = await readBody(req, requestValidator.maxBytes);
      if (body === null) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Request body too large' },
          id: null,
        }));
        return;
      }

      const bodyValidation = requestValidator.validateBody(body);
      if (!bodyValidation.valid) {
        res.writeHead(bodyValidation.statusCode ?? 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: bodyValidation.error },
          id: null,
        }));
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && sessions.has(sessionId)) {
        // Existing session
        const entry = sessions.get(sessionId)!;
        sessionManager.touch(sessionId);
        await entry.transport.handleRequest(req, res, body);
      } else if (!sessionId) {
        // Check concurrent session limit
        const sessionInfo = sessionManager.create(clientIp);
        if (!sessionInfo) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Max concurrent sessions reached' },
            id: null,
          }));
          return;
        }

        // Extract Bearer token from Authorization header
        const authHeader = req.headers.authorization;
        const authToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
        const newSessionId = randomUUID();

        // New session — create a fresh Server + Transport pair
        const mcpServer = serverFactory({
          authToken,
          clientIp,
          sessionId: newSessionId,
        });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server: mcpServer });
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
            sessionManager.remove(transport.sessionId);
          }
        };

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
      } else {
        // Invalid session
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Invalid session ID' },
          id: null,
        }));
      }
      return;
    }

    if (req.method === 'GET') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && sessions.has(sessionId)) {
        const entry = sessions.get(sessionId)!;
        sessionManager.touch(sessionId);
        await entry.transport.handleRequest(req, res);
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Session ID required for GET' },
        id: null,
      }));
      return;
    }

    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && sessions.has(sessionId)) {
        const entry = sessions.get(sessionId)!;
        await entry.transport.handleRequest(req, res);
        sessions.delete(sessionId);
        sessionManager.remove(sessionId);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Session not found' },
        id: null,
      }));
      return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
  };

  // Choose HTTP or HTTPS
  let httpServer: HttpServer;
  if (security.tls.enabled && (security.tls.certPath || security.tls.keyPath)) {
    const tlsOptions = await TlsManager.loadCerts(security.tls);
    httpServer = createHttpsServer(tlsOptions, handler);
  } else {
    httpServer = createHttpServer(handler);
  }

  const port = config.port;
  const host = config.host;

  return new Promise<GatewayHandle>((resolve) => {
    httpServer.listen(port, host, () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;

      if (config.label) {
        console.error(`${config.label} gateway started on ${host}:${actualPort}`);
      }

      resolve({
        port: actualPort,
        sessions: sessionManager,
        metrics: tracker,
        close: async () => {
          // Close all transports and servers
          for (const entry of sessions.values()) {
            await entry.transport.close();
            await entry.server.close();
          }
          sessions.clear();
          sessionManager.close();

          return new Promise<void>((resolveClose, rejectClose) => {
            httpServer.close((err) => {
              if (err) rejectClose(err);
              else resolveClose();
            });
          });
        },
      });
    });
  });
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<unknown | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function handleCors(
  res: ServerResponse,
  origins: string[],
): void {
  setCorsHeaders(res, origins);
  res.writeHead(204);
  res.end();
}

function setCorsHeaders(res: ServerResponse, origins: string[]): void {
  const origin = origins.length > 0 ? origins.join(', ') : '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Session-Id, Authorization');
}
