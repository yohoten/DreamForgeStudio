import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ProjectRow {
  id: string;
  title: string;
  created_at: string;
  is_active: number;
}

export interface JobRow {
  id: string;
  agent_id: string;
  task: string;
  priority: number;
  status: string;
  provider_id: string;
  project_id: string;
  workgroup_id: string;
  source: string | null;
  producer_chain_id: string | null;
  producer_chain_step: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  failure_reason: string | null;
}

export interface ProviderRow {
  id: string;
  label: string;
  kind: string;
  base_url: string;
  model: string;
  api_key: string;
  capabilities_json: string;
  pricing_json: string;
  is_enabled: number;
}

export function createDb(repoRoot: string) {
  const prodDir = join(repoRoot, "production");
  if (!existsSync(prodDir)) mkdirSync(prodDir, { recursive: true });
  const dbPath = join(prodDir, "studio.db");
  const jsonBackupDir = join(prodDir, "backup");
  if (!existsSync(jsonBackupDir)) mkdirSync(jsonBackupDir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // --- Schema ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      status TEXT CHECK(status IN ('queued','running','done','failed','cancelled')) DEFAULT 'queued',
      provider_id TEXT,
      project_id TEXT,
      workgroup_id TEXT,
      source TEXT,
      producer_chain_id TEXT,
      producer_chain_step INTEGER,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error_message TEXT,
      failure_reason TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      label TEXT,
      kind TEXT,
      base_url TEXT,
      model TEXT,
      api_key TEXT,
      capabilities_json TEXT DEFAULT '["text"]',
      pricing_json TEXT DEFAULT '{}',
      is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS hired_agents (
      agent_id TEXT PRIMARY KEY,
      bound_provider_id TEXT,
      hired_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS policy (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS charters (
      project_id TEXT PRIMARY KEY,
      draft_json TEXT,
      archived_json TEXT,
      history_json TEXT DEFAULT '[]',
      pending_changes_json TEXT DEFAULT '{}',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS model_routing (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      tier TEXT DEFAULT 'balance',
      execution_provider_id TEXT,
      meeting_provider_id TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finance_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      job_id TEXT,
      agent_id TEXT,
      provider_id TEXT,
      event_type TEXT,
      detail TEXT
    );
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      studio_name TEXT DEFAULT '我的工作室',
      created_at TEXT NOT NULL,
      last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // --- Prepared statements ---
  const stmt = {
    // Projects
    projectAll: db.prepare("SELECT * FROM projects WHERE is_active = 1"),
    projectById: db.prepare("SELECT * FROM projects WHERE id = ? AND is_active = 1"),
    projectInsert: db.prepare("INSERT INTO projects (id, title, created_at, is_active) VALUES (?, ?, ?, 1)"),
    projectDelete: db.prepare("UPDATE projects SET is_active = 0 WHERE id = ?"),

    // Jobs
    jobAll: db.prepare("SELECT * FROM jobs ORDER BY priority DESC, created_at ASC"),
    jobByStatus: db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY priority DESC, created_at ASC"),
    jobById: db.prepare("SELECT * FROM jobs WHERE id = ?"),
    jobInsert: db.prepare("INSERT INTO jobs (id, agent_id, task, priority, status, provider_id, project_id, workgroup_id, source, producer_chain_id, producer_chain_step, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    jobUpdateStatus: db.prepare("UPDATE jobs SET status = ?, finished_at = ? WHERE id = ?"),
    jobCancel: db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('queued', 'running')"),
    jobDelete: db.prepare("DELETE FROM jobs WHERE id = ? AND status IN ('done', 'failed', 'cancelled')"),
    jobRunningByProject: db.prepare("SELECT * FROM jobs WHERE project_id = ? AND status IN ('queued', 'running')"),

    // Providers
    providerAll: db.prepare("SELECT * FROM providers WHERE is_enabled = 1"),
    providerById: db.prepare("SELECT * FROM providers WHERE id = ?"),
    providerUpsert: db.prepare("INSERT OR REPLACE INTO providers (id, label, kind, base_url, model, api_key, capabilities_json, pricing_json, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)"),
    providerDisable: db.prepare("UPDATE providers SET is_enabled = 0 WHERE id = ?"),

    // Hired agents
    hiredAll: db.prepare("SELECT * FROM hired_agents"),
    hiredUpsert: db.prepare("INSERT OR REPLACE INTO hired_agents (agent_id, bound_provider_id, hired_at) VALUES (?, ?, ?)"),
    hiredDelete: db.prepare("DELETE FROM hired_agents WHERE agent_id = ?"),
    hiredClear: db.prepare("DELETE FROM hired_agents"),

    // Policy
    policyGet: db.prepare("SELECT data FROM policy WHERE id = 1"),
    policySet: db.prepare("INSERT OR REPLACE INTO policy (id, data) VALUES (1, ?)"),

    // Charters
    charterGet: db.prepare("SELECT * FROM charters WHERE project_id = ?"),
    charterUpsertDraft: db.prepare("INSERT INTO charters (project_id, draft_json, archived_json, history_json, pending_changes_json) VALUES (?, ?, '{}', '[]', '{}') ON CONFLICT(project_id) DO UPDATE SET draft_json = excluded.draft_json"),
    charterArchive: db.prepare("UPDATE charters SET archived_json = ?, history_json = ? WHERE project_id = ?"),
    charterSetPending: db.prepare("UPDATE charters SET pending_changes_json = ? WHERE project_id = ?"),
    charterClearPending: db.prepare("UPDATE charters SET pending_changes_json = '{}' WHERE project_id = ?"),

    // Model routing
    routingGet: db.prepare("SELECT * FROM model_routing WHERE id = 1"),
    routingSet: db.prepare("INSERT OR REPLACE INTO model_routing (id, tier, execution_provider_id, meeting_provider_id) VALUES (1, ?, ?, ?)"),

    // Settings
    settingGet: db.prepare("SELECT value FROM settings WHERE key = ?"),
    settingSet: db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"),

    // Finance
    financeInsert: db.prepare("INSERT INTO finance_ledger (ts, job_id, agent_id, provider_id, event_type, detail) VALUES (?, ?, ?, ?, ?, ?)"),
    financeToday: db.prepare("SELECT * FROM finance_ledger WHERE ts >= ? ORDER BY ts DESC"),
    financeTodayCounts: db.prepare("SELECT event_type, COUNT(*) as cnt FROM finance_ledger WHERE ts >= ? GROUP BY event_type"),

    // Workflow
    workflowUpsert: db.prepare("INSERT OR REPLACE INTO workflow_templates (id, name, steps_json, created_at) VALUES (?, ?, ?, ?)"),
    workflowById: db.prepare("SELECT * FROM workflow_templates WHERE id = ?"),
    workflowAll: db.prepare("SELECT * FROM workflow_templates ORDER BY created_at DESC"),

    // Auth
    userByUsername: db.prepare("SELECT * FROM users WHERE username = ?"),
    userInsert: db.prepare("INSERT INTO users (username, password_hash, studio_name, created_at) VALUES (?, ?, ?, ?)"),
    userUpdateLogin: db.prepare("UPDATE users SET last_login = ? WHERE id = ?"),
    sessionInsert: db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)"),
    sessionByToken: db.prepare("SELECT s.*, u.username, u.studio_name FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?"),
    sessionDelete: db.prepare("DELETE FROM sessions WHERE token = ?"),
  };

  // --- JSON Migration ---
  const migrated = stmt.settingGet.get("db_migrated_v1");
  if (!migrated) {
    migrateFromJson(repoRoot, db, stmt, jsonBackupDir);
    stmt.settingSet.run("db_migrated_v1", "1");
  }

  return { db, stmt };
}

function migrateFromJson(repoRoot: string, db: Database, stmt: any, backupDir: string) {
  const migrate = db.transaction(() => {
    // Projects
    stmt.projectInsert.run("project_1", "默认项目", new Date().toISOString());

    // Settings defaults
    stmt.settingSet.run("computeSlots", "1");
    stmt.settingSet.run("autoOutsource", "false");

    // Policy defaults
    const defaultPolicy = JSON.stringify({
      v: 1,
      producer: { mode: "rules", autoSplit: true, autoDispatch: true, maxSubtasks: 5 },
      technicalDirector: { mode: "rules", autoOutsource: false, firstChunkMsThreshold: 1800, pauseOnErrors: false },
      creativeDirector: { mode: "rules", gateOnNoPreview: true, requireAcceptanceCriteria: false }
    });
    stmt.policySet.run(defaultPolicy);

    // Model routing defaults
    stmt.routingSet.run("balance", "local", "cloud");

    // --- Import from JSON files ---
    const prodDir = join(repoRoot, "production");

    try {
      const policyPath = join(prodDir, "policy.json");
      if (existsSync(policyPath)) {
        const data = readFileSync(policyPath, "utf-8");
        stmt.policySet.run(data);
        writeFileSync(join(backupDir, "policy.json"), data);
      }
    } catch { /* ignore */ }

    try {
      const hiredPath = join(prodDir, "studio-hired.json");
      if (existsSync(hiredPath)) {
        const list = JSON.parse(readFileSync(hiredPath, "utf-8")) as string[];
        for (const id of list) stmt.hiredUpsert.run(id, null, new Date().toISOString());
        writeFileSync(join(backupDir, "studio-hired.json"), JSON.stringify(list));
      }
    } catch { /* ignore */ }

    try {
      const providersPath = join(prodDir, "studio-providers.json");
      if (existsSync(providersPath)) {
        const cfg = JSON.parse(readFileSync(providersPath, "utf-8"));
        for (const [id, p] of Object.entries(cfg)) {
          const prov = p as any;
          stmt.providerUpsert.run(id, prov.label ?? id, prov.kind ?? "local", prov.baseUrl ?? "", prov.model ?? "",
            prov.apiKey ?? "", JSON.stringify(prov.capabilities ?? ["text"]), JSON.stringify(prov.pricing ?? {}));
        }
        writeFileSync(join(backupDir, "studio-providers.json"), readFileSync(providersPath));
      }
    } catch { /* ignore */ }

    try {
      const charterPath = join(prodDir, "charter", "state.json");
      if (existsSync(charterPath)) {
        const state = JSON.parse(readFileSync(charterPath, "utf-8"));
        for (const [pid, pc] of Object.entries(state?.projects ?? {})) {
          const c = pc as any;
          stmt.charterUpsertDraft.run(pid, JSON.stringify(c?.draft ?? {}));
          if (c?.archived) stmt.charterArchive.run(JSON.stringify(c.archived), JSON.stringify(c?.history ?? []), pid);
        }
        writeFileSync(join(backupDir, "charter-state.json"), readFileSync(charterPath));
      }
    } catch { /* ignore */ }

    try {
      const routingPath = join(prodDir, "model-routing.json");
      if (existsSync(routingPath)) {
        const mr = JSON.parse(readFileSync(routingPath, "utf-8"));
        stmt.routingSet.run(mr?.tier ?? "balance", mr?.executionProviderId ?? "local", mr?.meetingProviderId ?? "cloud");
        writeFileSync(join(backupDir, "model-routing.json"), readFileSync(routingPath));
      }
    } catch { /* ignore */ }

    try {
      const settingsPath = join(prodDir, "settings.json");
      if (existsSync(settingsPath)) {
        const s = JSON.parse(readFileSync(settingsPath, "utf-8"));
        stmt.settingSet.run("computeSlots", String(s?.computeSlots ?? 1));
        stmt.settingSet.run("autoOutsource", String(s?.autoOutsource ?? false));
        writeFileSync(join(backupDir, "settings.json"), readFileSync(settingsPath));
      }
    } catch { /* ignore */ }
  });

  migrate();
}
