/**
 * Key Store
 *
 * SQLite-backed store for issued API tokens.
 * Supports revocation lookups and listing active tokens.
 */

import Database from 'better-sqlite3';

export interface StoredToken {
  id: string;
  agentId: string;
  projectId: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
  scopeJson: string;
}

export class KeyStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        scope_json TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tokens_agent ON tokens(agent_id)
    `);
  }

  /**
   * Store a newly issued token.
   */
  store(token: StoredToken): void {
    this.db.prepare(`
      INSERT INTO tokens (id, agent_id, project_id, issued_at, expires_at, revoked, scope_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      token.id,
      token.agentId,
      token.projectId,
      token.issuedAt,
      token.expiresAt,
      token.revoked ? 1 : 0,
      token.scopeJson,
    );
  }

  /**
   * Check if a token has been revoked.
   */
  isRevoked(id: string): boolean {
    const row = this.db.prepare('SELECT revoked FROM tokens WHERE id = ?').get(id) as
      | { revoked: number }
      | undefined;
    if (!row) return false; // Unknown token = not revoked (verifier handles expiry)
    return row.revoked === 1;
  }

  /**
   * Revoke a token by ID.
   */
  revoke(id: string): boolean {
    const result = this.db.prepare('UPDATE tokens SET revoked = 1 WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * List all active (non-revoked, non-expired) tokens.
   */
  listActive(): StoredToken[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(
      'SELECT * FROM tokens WHERE revoked = 0 AND expires_at > ?',
    ).all(now) as Array<{
      id: string;
      agent_id: string;
      project_id: string;
      issued_at: string;
      expires_at: string;
      revoked: number;
      scope_json: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      projectId: row.project_id,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      revoked: row.revoked === 1,
      scopeJson: row.scope_json,
    }));
  }

  /**
   * Count active tokens.
   */
  countActive(): number {
    const now = new Date().toISOString();
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM tokens WHERE revoked = 0 AND expires_at > ?',
    ).get(now) as { count: number };
    return row.count;
  }

  /**
   * Close the database.
   */
  close(): void {
    this.db.close();
  }
}
