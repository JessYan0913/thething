// ============================================================
// SQLite Project Store Implementation
// ============================================================

import type { SqliteDatabase } from '../../../primitives/datastore/types';
import type { ProjectStore, Project, ProjectRow } from '../../../primitives/datastore/types';

/**
 * SQLite-based ProjectStore implementation
 */
export class SQLiteProjectStore implements ProjectStore {
  constructor(private db: SqliteDatabase) {}

  createProject(id: string, name: string, path: string): Project {
    const stmt = this.db.prepare(
      'INSERT INTO projects (id, name, path) VALUES (?, ?, ?)'
    );
    stmt.run(id, name, path);
    return this.getProject(id)!;
  }

  getProject(id: string): Project | null {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');
    const row = stmt.get(id) as ProjectRow | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  listProjects(): Project[] {
    const stmt = this.db.prepare(
      'SELECT * FROM projects ORDER BY updated_at DESC'
    );
    const rows = stmt.all() as unknown as ProjectRow[];
    return rows.map((row) => this.mapRow(row));
  }

  updateProject(id: string, updates: { name?: string; path?: string }): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.path !== undefined) {
      fields.push('path = ?');
      values.push(updates.path);
    }
    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    const stmt = this.db.prepare(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`
    );
    stmt.run(...values);
  }

  deleteProject(id: string): void {
    // First delete all conversations belonging to this project
    const convStmt = this.db.prepare('DELETE FROM conversations WHERE project_id = ?');
    convStmt.run(id);
    // Then delete the project
    const stmt = this.db.prepare('DELETE FROM projects WHERE id = ?');
    stmt.run(id);
  }

  private mapRow(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
