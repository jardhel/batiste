/**
 * LSP Client - Spawns tsserver and communicates over stdio using JSON-RPC 2.0
 *
 * Provides TypeScript language server integration for accurate symbol resolution,
 * definition lookup, reference finding, and hover information.
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { readFile } from 'fs/promises';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

interface LSPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown;
}

interface LSPNotification {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
}

interface LSPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface LSPNotificationMessage {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface Position {
  line: number;
  character: number;
}

interface Range {
  start: Position;
  end: Position;
}

interface Location {
  uri: string;
  range: Range;
}

interface HoverContentsMarkup {
  kind: string;
  value: string;
}

interface HoverResult {
  contents: HoverContentsMarkup | string;
  range?: Range;
}

export interface DefinitionLocation {
  file: string;
  line: number;
  column: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class LSPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, PendingRequest> = new Map();
  private log = logger.child('lsp-client');
  private _initialized = false;
  private buffer = '';

  /**
   * Initialize the LSP client by spawning the TypeScript language server
   * and performing the LSP initialize handshake.
   */
  async initialize(projectRoot: string): Promise<void> {
    if (this._initialized) {
      return;
    }

    this.process = spawn('npx', ['typescript-language-server', '--stdio'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to create stdio pipes for language server');
    }

    this.process.stdout.on('data', (chunk: Buffer) => {
      this.handleData(chunk.toString('utf-8'));
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.log.debug('LSP stderr:', data.toString('utf-8'));
    });

    this.process.on('error', (err: Error) => {
      this.log.error('Language server process error:', err);
      this.emit('error', err);
      this.process = null;
      this._initialized = false;
    });

    this.process.on('exit', (code: number | null) => {
      this.log.info(`Language server exited with code ${String(code)}`);
      this.emit('exit', code);
      this.process = null;
      this._initialized = false;
      this.rejectAllPending(new Error('Language server exited'));
    });

    // Send initialize request
    await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: `file://${projectRoot}`,
      capabilities: {
        textDocument: {
          hover: { dynamicRegistration: false },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          documentSymbol: { dynamicRegistration: false },
        },
        workspace: {
          symbol: { dynamicRegistration: false },
        },
      },
    });

    // Send initialized notification
    this.sendNotification('initialized', {});

    this._initialized = true;
    this.log.info('LSP client initialized for project:', projectRoot);
  }

  /**
   * Find the definition of a symbol at the given location.
   * Returns an array of definition locations.
   */
  async findDefinition(
    filePath: string,
    line: number,
    column: number
  ): Promise<DefinitionLocation[]> {
    if (!this._initialized) {
      return [];
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      await this.openDocument(filePath, content);

      const result = await this.sendRequest('textDocument/definition', {
        textDocument: { uri: `file://${filePath}` },
        position: { line, character: column },
      });

      await this.closeDocument(filePath);

      if (!result) {
        return [];
      }

      const locations: Location[] = Array.isArray(result)
        ? (result as Location[])
        : [result as Location];

      return locations.map((loc) => ({
        file: loc.uri.replace('file://', ''),
        line: loc.range.start.line,
        column: loc.range.start.character,
      }));
    } catch (err) {
      this.log.warn('findDefinition failed:', err);
      return [];
    }
  }

  /**
   * Find all references to a symbol at the given location.
   * Returns an array of reference locations.
   */
  async findReferences(
    filePath: string,
    line: number,
    column: number
  ): Promise<DefinitionLocation[]> {
    if (!this._initialized) {
      return [];
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      await this.openDocument(filePath, content);

      const result = await this.sendRequest('textDocument/references', {
        textDocument: { uri: `file://${filePath}` },
        position: { line, character: column },
        context: { includeDeclaration: true },
      });

      await this.closeDocument(filePath);

      if (!result) {
        return [];
      }

      const locations = result as Location[];
      return locations.map((loc) => ({
        file: loc.uri.replace('file://', ''),
        line: loc.range.start.line,
        column: loc.range.start.character,
      }));
    } catch (err) {
      this.log.warn('findReferences failed:', err);
      return [];
    }
  }

  /**
   * Get hover information at the given location.
   * Returns the hover text or null if unavailable.
   */
  async getHover(
    filePath: string,
    line: number,
    column: number
  ): Promise<string | null> {
    if (!this._initialized) {
      return null;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      await this.openDocument(filePath, content);

      const result = await this.sendRequest('textDocument/hover', {
        textDocument: { uri: `file://${filePath}` },
        position: { line, character: column },
      });

      await this.closeDocument(filePath);

      if (!result) {
        return null;
      }

      const hover = result as HoverResult;
      if (!hover.contents) {
        return null;
      }

      if (typeof hover.contents === 'string') {
        return hover.contents;
      }

      return hover.contents.value;
    } catch (err) {
      this.log.warn('getHover failed:', err);
      return null;
    }
  }

  /**
   * Shut down the language server gracefully.
   */
  async shutdown(): Promise<void> {
    if (!this.process) {
      return;
    }

    try {
      await this.sendRequest('shutdown', null);
      this.sendNotification('exit', null);
    } catch {
      // Ignore errors during shutdown
    }

    this.process.kill();
    this.process = null;
    this._initialized = false;
    this.rejectAllPending(new Error('LSP client shut down'));
    this.log.info('LSP client shut down');
  }

  /**
   * Check whether the client has been successfully initialized.
   */
  isInitialized(): boolean {
    return this._initialized && this.process !== null;
  }

  // -- Private helpers --

  private async openDocument(filePath: string, content: string): Promise<void> {
    const languageId = this.detectLanguageId(filePath);
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: `file://${filePath}`,
        languageId,
        version: 1,
        text: content,
      },
    });
  }

  private async closeDocument(filePath: string): Promise<void> {
    this.sendNotification('textDocument/didClose', {
      textDocument: { uri: `file://${filePath}` },
    });
  }

  private detectLanguageId(filePath: string): string {
    const ext = filePath.split('.').pop() ?? '';
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      default:
        return 'typescript';
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Language server not running'));
        return;
      }

      const id = ++this.requestId;
      const message: LSPRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

      const content = JSON.stringify(message);
      const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

      this.process.stdin.write(header + content);

      // Timeout after 15 seconds
      setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          pending.reject(new Error(`LSP request '${method}' timed out after 15s`));
        }
      }, 15000);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin) {
      return;
    }

    const message: LSPNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

    this.process.stdin.write(header + content);
  }

  /**
   * Handle incoming data from the language server stdout.
   * Parses Content-Length framed JSON-RPC messages.
   */
  private handleData(data: string): void {
    this.buffer += data;

    while (this.buffer.length > 0) {
      // Look for Content-Length header
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        break;
      }

      const headerPart = this.buffer.substring(0, headerEnd);
      const contentLengthMatch = headerPart.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch?.[1]) {
        // Malformed header, skip past the double CRLF
        this.buffer = this.buffer.substring(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = headerEnd + 4;

      if (this.buffer.length < bodyStart + contentLength) {
        // Not enough data yet, wait for more
        break;
      }

      const body = this.buffer.substring(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.substring(bodyStart + contentLength);

      this.handleMessage(body);
    }
  }

  /**
   * Handle a single parsed JSON-RPC message.
   */
  private handleMessage(body: string): void {
    try {
      const message = JSON.parse(body) as LSPResponse | LSPNotificationMessage;

      // Check if this is a response (has an id field)
      if ('id' in message && typeof message.id === 'number') {
        const response = message as LSPResponse;
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);

          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } else {
        // It is a notification from the server
        const notification = message as LSPNotificationMessage;
        this.emit('notification', notification.method, notification.params);
      }
    } catch {
      this.log.debug('Failed to parse LSP message:', body.substring(0, 200));
    }
  }

  /**
   * Reject all pending requests (used during shutdown or unexpected exit).
   */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }
}
