import { createServer } from "node:http";
import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";

import chokidar from "chokidar";
import matter from "gray-matter";
import { WebSocketServer } from "ws";

import type { StudioEventEnvelope } from "@aigongfang/shared/studio-events";
import { newId, nowIso } from "@aigongfang/shared/studio-events";

import { studioGenerateImages, studioPackSpritesheet, studioTranscodeVideo } from "./asset-pipeline.js";
import { createDb } from "./db.js";
import type { JobRow, ProjectRow } from "./db.js";

type Env = {
  port: number;
  host: string;
  repoRoot: string;
  logPath: string;
  upstreamBaseUrl: string;
};

function getEnv(): Env {
  const port = Number(process.env.STUDIO_PORT ?? "8787");
  const host = process.env.STUDIO_HOST ?? "127.0.0.1";
  const repoRoot = resolve(process.env.STUDIO_REPO_ROOT ?? process.cwd());
  const logPath = resolve(process.env.STUDIO_LOG_PATH ?? join(repoRoot, "studio_events.jsonl"));
  const upstreamBaseUrl = process.env.STUDIO_UPSTREAM_BASE_URL ?? "http://127.0.0.1:11434/v1";
  return { port, host, repoRoot, logPath, upstreamBaseUrl };
}

/** 供非 JSON 路由（如 GET /preview）与 Vite 异源页面上的 fetch 共用 */
function applyCorsHeaders(res: { setHeader: (k: string, v: string) => void }) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type,x-studio-agent,x-studio-task,authorization");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
}

function json(res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (s: string) => void }, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  applyCorsHeaders(res);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

async function appendJsonl(path: string, line: string) {
  await import("node:fs/promises").then((fs) => fs.appendFile(path, `${line}\n`, "utf8"));
}

function normalizePath(p: string) {
  return p.replace(/\\/g, "/");
}

/** 比较两条 OpenAI BaseURL 是否视为同一端点（忽略末尾 / 与大小写）。 */
function sameProviderBaseUrl(a: string, b: string): boolean {
  const n = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b) && n(a).length > 0;
}

function pickAgentId(req: import("node:http").IncomingMessage): string | undefined {
  const v = req.headers["x-studio-agent"];
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks).toString("utf8");
}

function forwardHeaders(req: import("node:http").IncomingMessage) {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    if (k === "host") continue;
    if (k.startsWith("x-studio-")) continue;
    if (Array.isArray(v)) h[k] = v.join(", ");
    else h[k] = v;
  }
  return h;
}

/** 仅用于调试日志，避免把 Authorization 原文写入控制台 */
function redactHeadersForDebug(headers: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    o[k] = k.toLowerCase() === "authorization" ? redactAuthorizationHeaderValue(v) : v;
  }
  return o;
}

function redactAuthorizationHeaderValue(v: string): string {
  const s = String(v ?? "");
  return /^Bearer\s+/i.test(s) ? "Bearer ***" : s.length > 32 ? `${s.slice(0, 6)}…(redacted)` : "***";
}

/** 从大段文字中抠出最外层 `{ ... }` 再解析（小模型常在 JSON 前后加废话）。 */
function sliceOutermostJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return s.slice(start, end + 1);
}

/** 解析立项会 LLM 返回的 JSON：`{ "lines": [ { "speaker", "text" } ] }`。 */
function parseMeetingTranscriptJson(rawAssistant: string): Array<{ speaker: string; text: string }> | null {
  const extract = (s: string): Array<{ speaker: string; text: string }> | null => {
    try {
      const o = JSON.parse(s) as { lines?: unknown };
      if (!Array.isArray(o.lines)) return null;
      const out: Array<{ speaker: string; text: string }> = [];
      for (const row of o.lines) {
        if (!row || typeof row !== "object") continue;
        const r = row as { speaker?: unknown; text?: unknown };
        const speaker = String(r.speaker ?? "").trim();
        const text = String(r.text ?? "").trim();
        if (speaker && text) out.push({ speaker, text });
      }
      return out.length >= 3 ? out : null;
    } catch {
      return null;
    }
  };
  const trimmed = rawAssistant.trim();
  let lines = extract(trimmed);
  if (lines) return lines;
  const m = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) lines = extract(m[1].trim());
  if (lines) return lines;
  const sliced = sliceOutermostJsonObject(trimmed);
  if (sliced && sliced !== trimmed) lines = extract(sliced);
  return lines;
}

/** 解析「秘书：……」逐行格式（本地小模型更稳定）。 */
function parseMeetingTranscriptLoose(rawAssistant: string): Array<{ speaker: string; text: string }> | null {
  const allowed = /^(秘书|制作人|技术总监|创意总监)\s*[:：]\s*(.+)$/;
  const out: Array<{ speaker: string; text: string }> = [];
  for (const line of rawAssistant.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(allowed);
    if (!m) continue;
    const text = m[2].trim();
    if (text) out.push({ speaker: m[1], text });
  }
  return out.length >= 3 ? out : null;
}

function parseMeetingTranscriptAny(rawAssistant: string): Array<{ speaker: string; text: string }> | null {
  return parseMeetingTranscriptJson(rawAssistant) ?? parseMeetingTranscriptLoose(rawAssistant);
}

/** 从上游错误 JSON 中取可读说明（OpenAI / Ollama 常见：`{ "error": { "message": "..." } }`）。 */
function extractUpstreamErrorMessage(raw: string): string | null {
  try {
    const obj = JSON.parse(raw) as { error?: { message?: string } };
    const m = obj?.error?.message;
    if (typeof m === "string" && m.length > 0) return m;
    const top = (obj as { message?: string }).message;
    if (typeof top === "string" && top.length > 0) return top;
  } catch {
    // ignore
  }
  return null;
}

/** OpenAI 兼容的非流式 chat/completions 响应中取 assistant 文本（部分上游在 stream:true 时仍返回 JSON）。 */
function assistantTextFromChatCompletionJson(raw: string): string | null {
  try {
    const obj = JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown }; text?: string }> };
    const c0 = obj?.choices?.[0];
    if (!c0) return null;
    if (typeof c0.text === "string" && c0.text.length > 0) return c0.text;
    const msg = c0.message;
    if (msg && typeof msg.content === "string" && msg.content.length > 0) return msg.content;
    if (Array.isArray(msg?.content)) {
      const parts = (msg!.content as Array<{ text?: string }>).map((x) => (typeof x?.text === "string" ? x.text : "")).filter(Boolean);
      if (parts.length) return parts.join("");
    }
    return null;
  } catch {
    return null;
  }
}

/** OpenAI 流式 chunk 里 delta / message 的 content 可能是 string 或 parts 数组（多模态）。 */
function openAiContentPartToString(c: unknown): string {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((x) => {
        if (x == null) return "";
        if (typeof x === "string") return x;
        if (typeof x === "object" && x !== null && "text" in x) return String((x as { text?: string }).text ?? "");
        return "";
      })
      .join("");
  }
  return "";
}

/** 从单条 SSE JSON 中取出本轮应拼接到 assistant 的文本（delta 优先，否则部分上游只在末包带 message）。 */
function streamChoiceChunkToAssistantText(obj: unknown): string {
  try {
    const o = obj as {
      choices?: Array<{
        delta?: { content?: unknown; reasoning_content?: unknown };
        message?: { content?: unknown };
      }>;
    };
    const c0 = o?.choices?.[0];
    if (!c0) return "";
    const d = c0.delta;
    if (d) {
      const a = openAiContentPartToString(d.content);
      const b = openAiContentPartToString((d as { reasoning_content?: unknown }).reasoning_content);
      const both = a + b;
      if (both.length > 0) return both;
    }
    if (c0.message?.content != null) return openAiContentPartToString(c0.message.content);
    return "";
  } catch {
    return "";
  }
}

async function listAgents(repoRoot: string) {
  const agentsDir = join(repoRoot, ".claude", "agents");
  if (!existsSync(agentsDir)) return [];

  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(agentsDir)).filter((f) => f.endsWith(".md"));
  const out: Array<{ id: string; description?: string }> = [];

  for (const f of files) {
    const full = join(agentsDir, f);
    const raw = await readFile(full, "utf8");
    const parsed = matter(raw);
    const id = String(parsed.data?.name ?? f.replace(/\.md$/, ""));
    const description = parsed.data?.description ? String(parsed.data.description) : undefined;
    out.push({ id, description });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function startFsWatcher(env: Env, emit: (e: StudioEventEnvelope) => void) {
  const ignored = [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    normalizePath(env.logPath),
    "**/production/session-logs/**",
    "**/production/session-state/**"
  ];

  const watcher = chokidar.watch(env.repoRoot, {
    ignoreInitial: true,
    ignored,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  });

  const sessionId = newId("sess");

  watcher.on("all", (eventName, path) => {
    const kind = String(eventName);
    const rel = normalizePath(path).replace(normalizePath(env.repoRoot) + "/", "");
    const ev: StudioEventEnvelope<"fs.change"> = {
      v: 1,
      ts: nowIso(),
      type: "fs.change",
      sessionId,
      correlationId: newId("fs"),
      payload: { kind, path: rel }
    };
    emit(ev);
  });

  return watcher;
}

function execFileText(file: string, args: string[], timeoutMs = 3500): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      const out = String(stdout ?? "").trim();
      const errOut = String(stderr ?? "").trim();
      resolve(out || errOut);
    });
  });
}

async function getWinGpuInfo(): Promise<{ gpuName?: string; vramGB?: number } | null> {
  if (process.platform !== "win32") return null;
  // Use CIM; AdapterRAM can be null on some drivers, so tolerate missing.
  const ps = [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress"
  ];
  try {
    const txt = await execFileText("powershell", ps, 4500);
    const obj = JSON.parse(txt) as any;
    const name = typeof obj?.Name === "string" ? obj.Name : undefined;
    const ram = typeof obj?.AdapterRAM === "number" ? obj.AdapterRAM : typeof obj?.AdapterRAM === "string" ? Number(obj.AdapterRAM) : undefined;
    const vramGB = typeof ram === "number" && Number.isFinite(ram) ? Math.max(0, Math.round((ram / (1024 ** 3)) * 10) / 10) : undefined;
    return { gpuName: name, vramGB };
  } catch {
    return null;
  }
}

function gb(n: number) {
  return Math.round((n / (1024 ** 3)) * 10) / 10;
}

function recommendLocalModels(vramGB?: number, memGB?: number): string[] {
  const out: string[] = [];
  const v = vramGB ?? 0;
  const m = memGB ?? 0;
  if (v >= 24) out.push("32B 量化（Q4）", "14B 全精度/量化", "7B 全精度");
  else if (v >= 16) out.push("14B 量化（Q4/Q5）", "7B 全精度/量化");
  else if (v >= 8) out.push("7B 量化（Q4/Q5）", "3B/4B 量化");
  else if (m >= 16) out.push("3B/4B 量化（CPU 跑）", "7B 量化（慢）");
  else out.push("3B 量化（CPU 跑）");
  return out;
}

export async function main() {
  const env = getEnv();
  const previewDir = join(env.repoRoot, "production", "preview");
  const previewIndexPath = join(previewDir, "index.html");
  const policyPath = join(env.repoRoot, "production", "policy.json");
  const charterDir = join(env.repoRoot, "production", "charter");
  const charterStatePath = join(charterDir, "state.json");
  const modelRoutingPath = join(env.repoRoot, "production", "model-routing.json");
  const studioProvidersPath = join(env.repoRoot, "production", "studio-providers.json");
  const studioHiredPath = join(env.repoRoot, "production", "studio-hired.json");

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<import("ws").WebSocket>();
  const serverSessionId = newId("sess");

  wss.on("connection", (ws: import("ws").WebSocket) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });

  const broadcast = (ev: StudioEventEnvelope) => {
    const line = JSON.stringify(ev);
    void appendJsonl(env.logPath, line);
    for (const c of clients) {
      if (c.readyState === c.OPEN) c.send(line);
    }
  };

  startFsWatcher(env, broadcast);

  // --- DB 持久化 ---
  const { db, stmt } = createDb(env.repoRoot);
  const dbNow = () => new Date().toISOString();

  // --- Hiring + queue (memory cache, DB-backed) ---
  type Project = {
    id: string;
    title: string;
    createdAt: string;
  };

  // 从 DB 加载项目列表
  const dbProjects = stmt.projectAll.all() as ProjectRow[];
  const projects: Project[] = dbProjects.length > 0
    ? dbProjects.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at }))
    : [{ id: "project_1", title: "默认项目", createdAt: nowIso() }];
  if (projects.length === 0 || !projects.some((p) => p.id === "project_1")) {
    projects.unshift({ id: "project_1", title: "默认项目", createdAt: nowIso() });
    stmt.projectInsert.run("project_1", "默认项目", nowIso());
  }
  let currentProjectId = projects[0]!.id;

  type Job = {
    id: string;
    agentId: string;
    task: string;
    priority: number;
    createdAt: string;
    providerId: string;
    projectId: string;
    workgroupId: string;
    status: "queued" | "running" | "done" | "failed" | "cancelled";
    /** meeting_kickoff | producer_chain 等，用于任务结束后的衔接逻辑 */
    source?: string;
    /** 立项衔接串行链：首包结束后只入队第一步，后续由 maybeAdvanceProducerChain 逐步入队 */
    producerChainId?: string;
    producerChainStepIndex?: number;
  };

  type ProducerChainState = {
    steps: Array<{ agentId: string; task: string; priority: number }>;
    /** 下一步要入队的下标（首步已在链创建时入队） */
    cursor: number;
  };
  const producerChainById = new Map<string, ProducerChainState>();

  type Provider = {
    id: string;
    label: string;
    kind: "local" | "lan" | "cloud";
    baseUrl: string; // OpenAI-compatible /v1
    model: string;
    capabilities: Array<"text" | "image" | "music">;
    pricing: { inputPer1k: number; outputPer1k: number; currency: string };
  };

  const settings = {
    computeSlots: 1,
    autoOutsource: true,
    autoOutsourceFirstChunkMsThreshold: 1800
  };

  // Load settings from DB (override defaults)
  try {
    const cs = stmt.settingGet.get("computeSlots") as { value: string } | undefined;
    if (cs) settings.computeSlots = Math.max(1, Math.min(8, parseInt(cs.value, 10) || 1));
    const ao = stmt.settingGet.get("autoOutsource") as { value: string } | undefined;
    if (ao) settings.autoOutsource = ao.value === "true";
    const aoct = stmt.settingGet.get("autoOutsourceFirstChunkMsThreshold") as { value: string } | undefined;
    if (aoct) settings.autoOutsourceFirstChunkMsThreshold = parseInt(aoct.value, 10) || 1800;
  } catch { /* ignore */ }

  type StudioPolicy = {
    v: 1;
    producer: {
      mode: "rules" | "llm";
      autoSplit: boolean;
      autoDispatch: boolean;
      maxSubtasks: number;
    };
    technicalDirector: {
      mode: "rules" | "llm";
      autoOutsource: boolean;
      firstChunkMsThreshold: number;
      pauseOnErrors: boolean;
    };
    creativeDirector: {
      mode: "rules" | "llm";
      gateOnNoPreview: boolean;
      requireAcceptanceCriteria: boolean;
    };
  };

  const defaultPolicy = (): StudioPolicy => ({
    v: 1,
    producer: { mode: "rules", autoSplit: true, autoDispatch: true, maxSubtasks: 5 },
    technicalDirector: { mode: "rules", autoOutsource: true, firstChunkMsThreshold: 1800, pauseOnErrors: false },
    creativeDirector: { mode: "rules", gateOnNoPreview: false, requireAcceptanceCriteria: true }
  });

  let policy: StudioPolicy = defaultPolicy();
  try {
    const row = stmt.policyGet.get() as { data: string } | undefined;
    if (row?.data) {
      const parsed = JSON.parse(row.data);
      if (parsed && typeof parsed === "object") {
        policy = parsed;
        settings.autoOutsource = Boolean(policy.technicalDirector?.autoOutsource);
        settings.autoOutsourceFirstChunkMsThreshold = Number(policy.technicalDirector?.firstChunkMsThreshold ?? settings.autoOutsourceFirstChunkMsThreshold);
      }
    }
  } catch { /* ignore */ }

  const hired = new Set<string>();
  const agentProvider = new Map<string, string>(); // agentId -> providerId

  async function persistHiredToDisk() {
    // DB sync
    for (const id of hired) stmt.hiredUpsert.run(id, agentProvider.get(id) ?? null, dbNow());
  }

  async function loadHiredInitial() {
    const rows = stmt.hiredAll.all() as Array<{ agent_id: string; bound_provider_id: string | null }>;
    if (rows.length > 0) {
      hired.clear();
      agentProvider.clear();
      for (const r of rows) {
        hired.add(r.agent_id);
        if (r.bound_provider_id) agentProvider.set(r.agent_id, r.bound_provider_id);
      }
    } else {
      const agents = await listAgents(env.repoRoot);
      hired.clear();
      for (const a of agents) hired.add(a.id);
      await persistHiredToDisk();
    }
  }

  await loadHiredInitial();

  // ======== OA 审批流引擎 ========
  type WorkflowStep = { id: string; agentId: string; task: string; dept: string; priority: number; approvalNeeded: boolean; timeoutMinutes: number };
  type WorkflowTemplate = { id: string; name: string; steps: WorkflowStep[]; type: "serial" | "parallel"; createdAt: string };
  type WorkflowRun = { id: string; templateId: string; projectId: string; steps: Array<WorkflowStep & { status: "pending" | "running" | "approved" | "rejected" | "skipped"; jobId?: string; assignedAt?: string; completedAt?: string }>; currentStep: number; status: "active" | "completed" | "cancelled"; startedAt: string; completedAt: string | null };
  const workflowRuns = new Map<string, WorkflowRun>();

  // 内置模板
  const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
    { id: "wf_game_dev", name: "游戏开发标准流水线", type: "serial", createdAt: "2025-01-01T00:00:00Z", steps: [
      { id: "s1", agentId: "game-designer", task: "编写游戏设计文档（GDD）", dept: "design", priority: 1, approvalNeeded: false, timeoutMinutes: 30 },
      { id: "s2", agentId: "lead-programmer", task: "实现核心玩法原型", dept: "programming", priority: 0, approvalNeeded: false, timeoutMinutes: 45 },
      { id: "s3", agentId: "artist", task: "制作游戏美术素材", dept: "art_audio", priority: 1, approvalNeeded: false, timeoutMinutes: 30 },
      { id: "s4", agentId: "qa-lead", task: "测试并编写验收报告", dept: "qa_release", priority: 0, approvalNeeded: true, timeoutMinutes: 20 }
    ]},
    { id: "wf_hotfix", name: "热修复快速通道", type: "serial", createdAt: "2025-01-01T00:00:00Z", steps: [
      { id: "h1", agentId: "qa-lead", task: "确认缺陷并记录复现步骤", dept: "qa_release", priority: 0, approvalNeeded: false, timeoutMinutes: 10 },
      { id: "h2", agentId: "lead-programmer", task: "修复缺陷代码", dept: "programming", priority: 0, approvalNeeded: false, timeoutMinutes: 30 },
      { id: "h3", agentId: "qa-lead", task: "验证修复并回归测试", dept: "qa_release", priority: 0, approvalNeeded: true, timeoutMinutes: 15 }
    ]},
    { id: "wf_asset", name: "资产生产流水线", type: "parallel", createdAt: "2025-01-01T00:00:00Z", steps: [
      { id: "a1", agentId: "artist", task: "概念设计与草图", dept: "art_audio", priority: 0, approvalNeeded: true, timeoutMinutes: 20 },
      { id: "a2", agentId: "sound-designer", task: "音效与背景音乐制作", dept: "art_audio", priority: 1, approvalNeeded: false, timeoutMinutes: 25 },
      { id: "a3", agentId: "technical-artist", task: "技术美术集成与性能调优", dept: "art_audio", priority: 1, approvalNeeded: false, timeoutMinutes: 30 }
    ]}
  ];

  function launchWorkflow(templateId: string, projectId: string): WorkflowRun | null {
    const tpl = BUILTIN_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return null;
    const run: WorkflowRun = {
      id: newId("wf"),
      templateId, projectId,
      steps: tpl.steps.map((s) => ({ ...s, status: "pending" as const })),
      currentStep: 0, status: "active",
      startedAt: nowIso(), completedAt: null
    };
    workflowRuns.set(run.id, run);
    broadcast({ type: "workflow.launched" as any, agentId: "", payload: { runId: run.id, templateId, projectId, steps: run.steps.length }, ts: nowIso() });
    void advanceWorkflow(run);
    return run;
  }

  async function advanceWorkflow(run: WorkflowRun) {
    if (run.status !== "active") return;
    if (run.type === "serial") {
      const step = run.steps[run.currentStep];
      if (!step || step.status === "running") return;
      if (step.status === "rejected") { run.status = "cancelled"; run.completedAt = nowIso(); return; }
      // 入队当前步骤
      const jobId = newId("job");
      const job: Job = { id: jobId, agentId: step.agentId, task: step.task, priority: step.priority, createdAt: nowIso(), providerId: "", projectId: run.projectId, workgroupId: "", status: "queued", source: "workflow" };
      queue.push(job);
      step.status = "running"; step.jobId = jobId; step.assignedAt = nowIso();
      broadcast({ type: "workflow.step_started" as any, agentId: step.agentId, payload: { runId: run.id, stepId: step.id, jobId, task: step.task }, ts: nowIso() });
      void pumpQueue();
    } else {
      // 并行：所有未开始的一起入队
      for (const step of run.steps) {
        if (step.status !== "pending") continue;
        const jobId = newId("job");
        const job: Job = { id: jobId, agentId: step.agentId, task: step.task, priority: step.priority, createdAt: nowIso(), providerId: "", projectId: run.projectId, workgroupId: "", status: "queued", source: "workflow" };
        queue.push(job);
        step.status = "running"; step.jobId = jobId; step.assignedAt = nowIso();
        broadcast({ type: "workflow.step_started" as any, agentId: step.agentId, payload: { runId: run.id, stepId: step.id, jobId, task: step.task }, ts: nowIso() });
      }
      void pumpQueue();
    }
  }

  function completeWorkflowStep(run: WorkflowRun, jobId: string, success: boolean) {
    const step = run.steps.find((s) => s.jobId === jobId);
    if (!step) return;
    step.status = success ? "approved" : "rejected"; step.completedAt = nowIso();
    broadcast({ type: "workflow.step_completed" as any, agentId: step.agentId, payload: { runId: run.id, stepId: step.id, success, jobId }, ts: nowIso() });
    if (run.type === "serial") {
      run.currentStep += 1;
      if (run.currentStep >= run.steps.length) {
        run.status = "completed"; run.completedAt = nowIso();
        broadcast({ type: "workflow.completed" as any, agentId: "", payload: { runId: run.id, status: "completed" }, ts: nowIso() });
      } else {
        void advanceWorkflow(run);
      }
    } else {
      const allDone = run.steps.every((s) => s.status === "approved" || s.status === "rejected" || s.status === "skipped");
      if (allDone) {
        run.status = "completed"; run.completedAt = nowIso();
        broadcast({ type: "workflow.completed" as any, agentId: "", payload: { runId: run.id, status: "completed" }, ts: nowIso() });
      }
    }
  }

  const queue: Job[] = [];
  const running = new Map<string, Job>(); // slotId -> job

  const LEADERSHIP_MEETING_AGENTS = new Set(["producer", "technical-director", "creative-director"]);

  type CharterBody = { goal: string; milestones: string[]; nodes: string[] };
  type CharterArchived = CharterBody & { version: number; archivedAt: string };
  type PerProjectCharter = { draft: CharterBody; archived: CharterArchived | null; history: CharterArchived[] };
  type PendingChange = { kinds: string[]; count: number; updatedAt: string; lastNotifyTs?: string };
  type CharterRootState = { projects: Record<string, PerProjectCharter>; pendingChanges: Record<string, PendingChange> };

  const defaultDraft = (): CharterBody => ({ goal: "", milestones: [], nodes: [] });
  let charterState: CharterRootState = { projects: {}, pendingChanges: {} };

  type ModelRouting = { tier: "save" | "balance" | "quality"; executionProviderId: string; meetingProviderId: string };
  let modelRouting: ModelRouting = { tier: "balance", executionProviderId: "local", meetingProviderId: "cloud" };

  function applyTier(t: ModelRouting["tier"]): Pick<ModelRouting, "executionProviderId" | "meetingProviderId"> {
    if (t === "save") return { executionProviderId: "local", meetingProviderId: "local" };
    if (t === "balance") return { executionProviderId: "local", meetingProviderId: "cloud" };
    return { executionProviderId: "cloud", meetingProviderId: "cloud" };
  }

  async function persistCharterState() {
    for (const [pid, pc] of Object.entries(charterState.projects)) {
      stmt.charterUpsertDraft.run(pid, JSON.stringify(pc.draft));
      if (pc.archived) stmt.charterArchive.run(JSON.stringify(pc.archived), JSON.stringify(pc.history ?? []), pid);
    }
    for (const [pid, pending] of Object.entries(charterState.pendingChanges)) {
      stmt.charterSetPending.run(pid, JSON.stringify(pending));
    }
  }

  async function persistModelRouting() {
    stmt.routingSet.run(modelRouting.tier, modelRouting.executionProviderId, modelRouting.meetingProviderId);
  }

  function ensureCharterProject(projectId: string): PerProjectCharter {
    const pid = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!charterState.projects[pid]) charterState.projects[pid] = { draft: defaultDraft(), archived: null, history: [] };
    return charterState.projects[pid];
  }

  function normArr(a: string[]) {
    return JSON.stringify(a.map((s) => String(s).trim()).filter((s) => s.length > 0));
  }

  function driftKinds(draft: CharterBody, archived: CharterArchived | null): string[] {
    if (!archived) return [];
    const kinds: string[] = [];
    if (draft.goal.trim() !== archived.goal.trim()) kinds.push("goal_changed");
    if (normArr(draft.milestones) !== normArr(archived.milestones)) kinds.push("milestones_changed");
    if (normArr(draft.nodes) !== normArr(archived.nodes)) kinds.push("nodes_changed");
    return kinds;
  }

  async function maybeEmitDrift(projectId: string, kinds: string[], summary: string) {
    if (kinds.length === 0) return;
    const pid = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
    const prev = charterState.pendingChanges[pid] ?? { kinds: [], count: 0, updatedAt: nowIso() };
    const set = new Set([...prev.kinds, ...kinds]);
    charterState.pendingChanges[pid] = {
      kinds: Array.from(set),
      count: prev.count + 1,
      updatedAt: nowIso(),
      lastNotifyTs: prev.lastNotifyTs
    };
    const pend = charterState.pendingChanges[pid];
    const nowMs = Date.now();
    const last = pend.lastNotifyTs ? Date.parse(pend.lastNotifyTs) : 0;
    if (nowMs - last < 30_000) {
      await persistCharterState();
      return;
    }
    pend.lastNotifyTs = nowIso();
    await persistCharterState();
    emit({
      v: 1,
      ts: nowIso(),
      type: "change.detected",
      sessionId: serverSessionId,
      correlationId: newId("chg"),
      payload: { projectId: pid, kinds: pend.kinds, count: pend.count, summary }
    });
  }

  async function loadCharterAndRouting() {
    try {
      const charterRows = stmt.projectAll.all() as ProjectRow[];
      for (const pr of charterRows) {
        const row = stmt.charterGet.get(pr.id) as { draft_json: string; archived_json: string; history_json: string; pending_changes_json: string } | undefined;
        if (row) {
          charterState.projects[pr.id] = {
            draft: row.draft_json ? JSON.parse(row.draft_json) : defaultDraft(),
            archived: row.archived_json && row.archived_json !== "{}" ? JSON.parse(row.archived_json) : null,
            history: row.history_json ? JSON.parse(row.history_json) : []
          };
          if (row.pending_changes_json && row.pending_changes_json !== "{}") {
            charterState.pendingChanges[pr.id] = JSON.parse(row.pending_changes_json);
          }
        }
      }
    } catch { /* ignore */ }
    for (const pr of projects) ensureCharterProject(pr.id);
    try {
      const mr = stmt.routingGet.get() as { tier: string; execution_provider_id: string; meeting_provider_id: string } | undefined;
      if (mr && ["save", "balance", "quality"].includes(mr.tier)) {
        modelRouting.tier = mr.tier as ModelRouting["tier"];
        const d = applyTier(mr.tier as ModelRouting["tier"]);
        modelRouting.executionProviderId = mr.execution_provider_id || d.executionProviderId;
        modelRouting.meetingProviderId = mr.meeting_provider_id || d.meetingProviderId;
      }
    } catch { /* ignore */ }
  }

  await loadCharterAndRouting();

  async function pickQueueProviderId(agentId: string, parsed: any): Promise<{ providerId: string; providerReason?: string }> {
    if (typeof parsed?.providerId === "string") return { providerId: parsed.providerId };
    const usage = parsed?.usage === "meeting" ? "meeting" : "execution";
    if (usage === "meeting") return { providerId: modelRouting.meetingProviderId, providerReason: "model_routing_meeting" };
    if (LEADERSHIP_MEETING_AGENTS.has(agentId)) return { providerId: modelRouting.meetingProviderId, providerReason: "model_routing_leadership" };
    // 立项衔接四条与制作人首包同一路由，避免「领导走云端成功、衔接全走本地 Ollama 却 fetch failed」
    if (parsed?.producerCascade === true) {
      return { providerId: modelRouting.meetingProviderId, providerReason: "model_routing_producer_cascade" };
    }
    if (modelRouting.tier !== "save" && settings.autoOutsource) {
      const snap = await getAdviceSnapshot();
      return { providerId: snap.recommendedProviderId, providerReason: "auto_outsource_advice" };
    }
    return { providerId: modelRouting.executionProviderId, providerReason: "model_routing_execution" };
  }

  type ProviderConfig = {
    baseUrl: string;
    model: string;
    apiKey?: string;
    pricing?: { inputPer1k?: number; outputPer1k?: number; currency?: string };
  };

  const providerConfig: Record<string, ProviderConfig> = {
    local: {
      baseUrl: env.upstreamBaseUrl,
      model: process.env.STUDIO_MODEL ?? "llama3.2",
      pricing: { inputPer1k: 0, outputPer1k: 0, currency: "CNY" }
    },
    cloud: {
      baseUrl: process.env.STUDIO_CLOUD_BASE_URL ?? env.upstreamBaseUrl,
      model: process.env.STUDIO_CLOUD_MODEL ?? (process.env.STUDIO_MODEL ?? "llama3.2"),
      pricing: {
        inputPer1k: Number(process.env.STUDIO_CLOUD_IN_1K ?? "0.01"),
        outputPer1k: Number(process.env.STUDIO_CLOUD_OUT_1K ?? "0.03"),
        currency: "CNY"
      }
    }
  };

  async function loadStudioProvidersFromDisk() {
    try {
      if (!existsSync(studioProvidersPath)) return;
      const raw = await readFile(studioProvidersPath, "utf8");
      const p = JSON.parse(raw) as { local?: Partial<ProviderConfig>; cloud?: Partial<ProviderConfig> };
      if (typeof p?.local?.baseUrl === "string" && p.local.baseUrl.trim()) providerConfig.local.baseUrl = p.local.baseUrl.trim();
      if (typeof p?.local?.model === "string" && p.local.model.trim()) providerConfig.local.model = p.local.model.trim();
      if (typeof p?.local?.apiKey === "string") {
        const k = p.local.apiKey.trim();
        if (k) providerConfig.local.apiKey = k;
      }
      if (p?.local?.pricing && typeof p.local.pricing === "object")
        providerConfig.local.pricing = { ...providerConfig.local.pricing, ...p.local.pricing };
      if (typeof p?.cloud?.baseUrl === "string" && p.cloud.baseUrl.trim()) providerConfig.cloud.baseUrl = p.cloud.baseUrl.trim();
      if (typeof p?.cloud?.model === "string" && p.cloud.model.trim()) providerConfig.cloud.model = p.cloud.model.trim();
      if (typeof p?.cloud?.apiKey === "string") {
        const k = p.cloud.apiKey.trim();
        if (k) providerConfig.cloud.apiKey = k;
      }
      if (p?.cloud?.pricing && typeof p.cloud.pricing === "object")
        providerConfig.cloud.pricing = { ...providerConfig.cloud.pricing, ...p.cloud.pricing };
    } catch {
      /* ignore */
    }
  }

  async function saveStudioProvidersToDisk() {
    await mkdir(join(env.repoRoot, "production"), { recursive: true });
    const payload = {
      local: {
        baseUrl: providerConfig.local.baseUrl,
        model: providerConfig.local.model,
        apiKey: providerConfig.local.apiKey,
        pricing: providerConfig.local.pricing
      },
      cloud: {
        baseUrl: providerConfig.cloud.baseUrl,
        model: providerConfig.cloud.model,
        apiKey: providerConfig.cloud.apiKey,
        pricing: providerConfig.cloud.pricing
      }
    };
    await writeFile(studioProvidersPath, JSON.stringify(payload, null, 2), "utf8");
  }

  /** 本地与云端填了同一 Ollama 时，均衡档「会议」走 cloud，模型名须与本地一致。 */
  function syncCloudModelIfSameBaseAsLocal(): boolean {
    if (!sameProviderBaseUrl(providerConfig.local.baseUrl, providerConfig.cloud.baseUrl)) return false;
    const lm = String(providerConfig.local.model ?? "").trim();
    if (!lm) return false;
    if (providerConfig.cloud.model === lm) return false;
    providerConfig.cloud.model = lm;
    return true;
  }

  await loadStudioProvidersFromDisk();
  if (syncCloudModelIfSameBaseAsLocal()) {
    try {
      await saveStudioProvidersToDisk();
    } catch {
      /* ignore */
    }
  }

  const staticProviders: Provider[] = [
    {
      id: "doubao_image",
      label: "豆包绘图（建议接入）",
      kind: "cloud",
      baseUrl: "",
      model: "",
      capabilities: ["image"],
      pricing: { inputPer1k: 0, outputPer1k: 0, currency: "CNY" }
    },
    {
      id: "music_cloud",
      label: "AI音乐（建议接入）",
      kind: "cloud",
      baseUrl: "",
      model: "",
      capabilities: ["music"],
      pricing: { inputPer1k: 0, outputPer1k: 0, currency: "CNY" }
    }
  ];

  function getProviders(): Provider[] {
    const localCfg = providerConfig.local;
    const cloudCfg = providerConfig.cloud;
    const dynamic: Provider[] = [
      {
        id: "local",
        label: "本地文本模型",
        kind: "local",
        baseUrl: localCfg.baseUrl,
        model: localCfg.model,
        capabilities: ["text"],
        pricing: {
          inputPer1k: Number(localCfg.pricing?.inputPer1k ?? 0),
          outputPer1k: Number(localCfg.pricing?.outputPer1k ?? 0),
          currency: String(localCfg.pricing?.currency ?? "CNY")
        }
      },
      {
        id: "cloud",
        label: "互联网文本 API",
        kind: "cloud",
        baseUrl: cloudCfg.baseUrl,
        model: cloudCfg.model,
        capabilities: ["text"],
        pricing: {
          inputPer1k: Number(cloudCfg.pricing?.inputPer1k ?? 0.01),
          outputPer1k: Number(cloudCfg.pricing?.outputPer1k ?? 0.03),
          currency: String(cloudCfg.pricing?.currency ?? "CNY")
        }
      }
    ];
    return [...dynamic, ...staticProviders];
  }

  type AdviceSnapshot = {
    recommendedProviderId: string;
    recommendedComputeSlots: number;
    grade: "S" | "A" | "B" | "C";
    localAgentCap: number;
    notes: string[];
  };

  let cachedAdvice: AdviceSnapshot | null = null;
  let cachedAdviceAt = 0;

  async function computeAdviceSnapshot(): Promise<AdviceSnapshot> {
    const memGB = gb(os.totalmem());
    const gpu = await getWinGpuInfo();
    const vramGB = gpu?.vramGB;
    const providers = getProviders();
    const localP = providers.find((p) => p.id === "local") ?? providers[0];
    const cloudP = providers.find((p) => p.id === "cloud") ?? providers[0];

    const localCheck = await checkProvider(localP);
    const cloudCheck = await checkProvider(cloudP);
    let localBench: any = null;
    try {
      localBench = await benchOnce(localP);
    } catch {
      localBench = { ok: false };
    }

    const notes: string[] = [];
    notes.push(localCheck.ok ? "本地 Provider 可用。" : "本地 Provider 不可用：请先部署/启动本地 OpenAI 兼容服务（如 Ollama/LM Studio/vLLM）。");
    if (localBench?.ok && typeof localBench.firstChunkMs === "number") notes.push(`本地首包延迟：${localBench.firstChunkMs}ms（粗测）。`);

    let recommendedProviderId: string = "local";
    if (!localCheck.ok) recommendedProviderId = cloudCheck.ok ? "cloud" : "local";
    else if (localBench?.ok && typeof localBench.firstChunkMs === "number" && localBench.firstChunkMs > settings.autoOutsourceFirstChunkMsThreshold)
      recommendedProviderId = cloudCheck.ok ? "cloud" : "local";

    let recommendedComputeSlots = 1;
    if (recommendedProviderId === "local") {
      if ((vramGB ?? 0) >= 16) recommendedComputeSlots = 2;
      if ((vramGB ?? 0) >= 24) recommendedComputeSlots = 3;
      if (localBench?.ok && typeof localBench.firstChunkMs === "number" && localBench.firstChunkMs > 2500) recommendedComputeSlots = 1;
    } else {
      recommendedComputeSlots = 2;
    }

    // Grade + local agent cap: extremely rough (starter heuristic)
    let grade: AdviceSnapshot["grade"] = "C";
    if ((vramGB ?? 0) >= 24) grade = "S";
    else if ((vramGB ?? 0) >= 16) grade = "A";
    else if ((vramGB ?? 0) >= 8 || memGB >= 32) grade = "B";
    else grade = "C";

    const localAgentCap = grade === "S" ? 8 : grade === "A" ? 6 : grade === "B" ? 4 : 2;

    notes.push(recommendedProviderId === "local" ? "建议优先用本地：成本更低、延迟可控。" : "建议优先用外部 API：更稳定/更快（可能更贵）。");
    notes.push(`建议 ComputeSlots=${recommendedComputeSlots}（越大越并行，但单任务可能更慢）。`);

    return { recommendedProviderId, recommendedComputeSlots, grade, localAgentCap, notes };
  }

  async function getAdviceSnapshot(): Promise<AdviceSnapshot> {
    const now = Date.now();
    if (cachedAdvice && now - cachedAdviceAt < 15_000) return cachedAdvice;
    cachedAdvice = await computeAdviceSnapshot();
    cachedAdviceAt = now;
    return cachedAdvice;
  }

  async function checkProvider(p: Provider) {
    try {
      const u = new URL("models", p.baseUrl.endsWith("/") ? p.baseUrl : p.baseUrl + "/");
      const r = await fetch(u, { method: "GET" });
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function benchOnce(p: Provider) {
    const startedAt = Date.now();
    const timeoutMs = Math.min(
      Math.max(Number(process.env.STUDIO_PROVIDER_TEST_MS ?? "45000"), 8000),
      120000
    );
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
    const upstreamUrl = new URL("chat/completions", p.baseUrl.endsWith("/") ? p.baseUrl : p.baseUrl + "/");
    const body = {
      model: p.model,
      stream: true,
      messages: [{ role: "user", content: "输出 10 个数字，用逗号分隔。" }]
    };
    const apiKey = providerConfig[p.id as "local" | "cloud"]?.apiKey;
    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const ct = upstreamRes.headers.get("content-type") ?? "";
      const isSse = ct.includes("text/event-stream");
      // 仅在走 SSE 分支时再 getReader()，否则会锁定 body，导致后续 text() 无法读完整响应。
      // 首包前 reader.read() 可能一直挂起，故必须用 fetch signal 做整段超时。
      if (upstreamRes.ok && isSse && upstreamRes.body) {
        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();
        let firstChunkMs: number | null = null;
        let totalChars = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (firstChunkMs == null) firstChunkMs = Date.now() - startedAt;
          totalChars += decoder.decode(value, { stream: true }).length;
          if (Date.now() - startedAt > 2500) break;
        }
        return { ok: true, firstChunkMs, sampleChars: totalChars };
      }
      const raw = await upstreamRes.text();
      if (upstreamRes.ok) {
        const text = assistantTextFromChatCompletionJson(raw);
        if (text != null)
          return { ok: true, firstChunkMs: Date.now() - startedAt, sampleChars: text.length, note: "upstream_json_completion" as const };
        const snippet = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
        return {
          ok: false,
          note: "upstream_not_streaming",
          upstreamStatus: upstreamRes.status,
          upstreamDetail: snippet || undefined
        };
      }
      const errMsg = extractUpstreamErrorMessage(raw);
      const fallbackSnippet = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
      const upstreamDetail = errMsg ?? (fallbackSnippet.length > 0 ? fallbackSnippet : undefined);
      return {
        ok: false,
        note: "upstream_http_error",
        upstreamStatus: upstreamRes.status,
        upstreamDetail
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = controller.signal.aborted || /abort/i.test(msg);
      return {
        ok: false,
        note: aborted ? "upstream_timeout" : "upstream_fetch_error",
        upstreamDetail: aborted ? `超过 ${Math.round(timeoutMs / 1000)}s 无有效响应（SSE 首包或整段请求过慢）` : msg
      };
    } finally {
      clearTimeout(abortTimer);
    }
  }

  /** 设置页「测试」专用：非流式整包 JSON，避免部分上游 SSE 在 Node 下长时间不结束导致界面卡死。 */
  async function benchProviderConnectivity(p: Provider) {
    const startedAt = Date.now();
    const timeoutMs = Math.min(
      Math.max(Number(process.env.STUDIO_PROVIDER_TEST_MS ?? "45000"), 8000),
      120000
    );
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
    const upstreamUrl = new URL("chat/completions", p.baseUrl.endsWith("/") ? p.baseUrl : p.baseUrl + "/");
    const apiKey = providerConfig[p.id as "local" | "cloud"]?.apiKey;
    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          model: p.model,
          stream: false,
          max_tokens: 96,
          temperature: 0.2,
          messages: [{ role: "user", content: "只回复一个词：OK" }]
        }),
        signal: controller.signal
      });
      const raw = await upstreamRes.text();
      if (upstreamRes.ok) {
        const text = assistantTextFromChatCompletionJson(raw);
        if (text != null) {
          return {
            ok: true,
            firstChunkMs: Date.now() - startedAt,
            sampleChars: text.length,
            note: "upstream_json_completion" as const
          };
        }
        const snippet = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
        return {
          ok: false,
          note: "upstream_bad_completion_json",
          upstreamStatus: upstreamRes.status,
          upstreamDetail: snippet || undefined
        };
      }
      const errMsg = extractUpstreamErrorMessage(raw);
      const fallbackSnippet = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
      return {
        ok: false,
        note: "upstream_http_error",
        upstreamStatus: upstreamRes.status,
        upstreamDetail: errMsg ?? (fallbackSnippet.length > 0 ? fallbackSnippet : undefined)
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = controller.signal.aborted || /abort/i.test(msg);
      return {
        ok: false,
        note: aborted ? "upstream_timeout" : "upstream_fetch_error",
        upstreamDetail: aborted ? `超过 ${Math.round(timeoutMs / 1000)}s 无完整 JSON 响应` : msg
      };
    } finally {
      clearTimeout(abortTimer);
    }
  }

  async function chatCompletionNonStreaming(
    providerId: string,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    deadlineMs?: number
  ): Promise<{ ok: true; text: string } | { ok: false; error: string; status?: number }> {
    const providers = getProviders();
    const p = providers.find((x) => x.id === providerId);
    if (!p?.baseUrl || !p.model) return { ok: false, error: "provider_not_found" };
    const upstreamUrl = new URL("chat/completions", p.baseUrl.endsWith("/") ? p.baseUrl : p.baseUrl + "/");
    const apiKey = providerConfig[p.id as "local" | "cloud"]?.apiKey;
    const controller = new AbortController();
    const timeoutMs =
      typeof deadlineMs === "number" && deadlineMs > 0 ? deadlineMs : Number(process.env.STUDIO_MEETING_LLM_MS ?? "60000");
    const to = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model: p.model, stream: false, temperature: 0.35, messages }),
        signal: controller.signal
      });
      const raw = await upstreamRes.text();
      if (!upstreamRes.ok) {
        const em = extractUpstreamErrorMessage(raw);
        return { ok: false, error: em ?? raw.slice(0, 400), status: upstreamRes.status };
      }
      const text = assistantTextFromChatCompletionJson(raw);
      if (text == null) return { ok: false, error: "empty_assistant" };
      return { ok: true, text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg.includes("abort") ? "timeout" : msg };
    } finally {
      clearTimeout(to);
    }
  }

  const emit = (ev: StudioEventEnvelope) => broadcast(ev);

  function normalizePreviewHtmlString(raw: string): string {
    const t = String(raw ?? "").trim();
    if (!t) return "";
    const fence = t.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
    if (fence?.[1]) return String(fence[1]).trim();
    const docStart = t.search(/<!doctype\s+html|<html[\s>]/i);
    if (docStart > 0) return t.slice(docStart).trim();
    return t;
  }

  function isLikelyFullHtmlDocument(html: string): boolean {
    const n = normalizePreviewHtmlString(html);
    if (n.length < 120) return false;
    const hasDoc = /<!doctype\s+html/i.test(n) || /<html[\s>]/i.test(n);
    const hasClose = /<\/html>/i.test(n);
    return hasDoc && hasClose;
  }

  type PersistPreviewResult =
    | { saved: true; bytes: number; historyFile: string }
    | { saved: false; reason: "empty" | "too_short" | "invalid_html" | "disk_error" | "bad_project_id" };

  /** 程序类任务流式输出在服务端拼齐后落盘，避免前端 summary 截断导致无法自动保存预览 */
  async function persistPreviewHtmlIfValid(projectId: string, rawAccum: string, meta: { agentId?: string }): Promise<PersistPreviewResult> {
    const rawLen = String(rawAccum ?? "").trim().length;
    if (rawLen === 0) {
      if (process.env.STUDIO_LOG_PREVIEW === "1") console.warn(`[studio] preview persist skipped: empty accum projectId=${String(projectId)}`);
      return { saved: false, reason: "empty" };
    }
    const html = normalizePreviewHtmlString(rawAccum);
    const safePid = String(projectId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safePid) return { saved: false, reason: "bad_project_id" };
    if (html.length < 120) {
      if (process.env.STUDIO_LOG_PREVIEW === "1") {
        console.warn(`[studio] preview persist skipped projectId=${safePid} normLen=${html.length} rawAccumLen=${rawLen}`);
      }
      return { saved: false, reason: "too_short" };
    }
    if (!isLikelyFullHtmlDocument(html)) {
      if (process.env.STUDIO_LOG_PREVIEW === "1") {
        console.warn(
          `[studio] preview persist skipped projectId=${safePid} normLen=${html.length} hasOpen=${/<html[\s>]/i.test(html)} hasClose=${/<\/html>/i.test(html)}`
        );
      }
      return { saved: false, reason: "invalid_html" };
    }
    try {
      const dir = join(previewDir, safePid);
      const indexPath = join(dir, "index.html");
      const histDir = join(dir, "history");
      await mkdir(dir, { recursive: true });
      await mkdir(histDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const histName = `preview_${ts}.html`;
      await writeFile(indexPath, html, "utf8");
      await writeFile(join(histDir, histName), html, "utf8");
      emit({
        v: 1,
        ts: nowIso(),
        type: "policy.decision",
        sessionId: serverSessionId,
        correlationId: newId("policy"),
        agentId: meta.agentId,
        payload: {
          action: "preview_saved_from_job",
          projectId: safePid,
          bytes: html.length,
          historyFile: histName
        }
      });
      return { saved: true, bytes: html.length, historyFile: histName };
    } catch {
      return { saved: false, reason: "disk_error" };
    }
  }

  const sortQueue = () => {
    queue.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
  };

  type FailureReason =
    | "rate_limited" // 429
    | "timeout" // our deadline reached
    | "aborted" // aborted but not clearly a timeout
    | "upstream_http_error"
    | "upstream_not_streaming"
    | "bad_response"
    | "unknown";

  function classifyFailure(opts: { upstreamStatus?: number | null; error?: unknown; note?: string; aborted?: boolean; durationMs?: number; timeoutMs?: number }): FailureReason {
    const st = typeof opts.upstreamStatus === "number" ? opts.upstreamStatus : null;
    if (st === 429) return "rate_limited";
    if (st != null && st >= 400) return "upstream_http_error";
    const msg = (opts.error instanceof Error ? opts.error.message : typeof opts.error === "string" ? opts.error : "") || "";
    const aborted = Boolean(opts.aborted) || /abort/i.test(msg);
    if (/timeout/i.test(msg)) return "timeout";
    if (aborted) {
      const d = typeof opts.durationMs === "number" ? opts.durationMs : null;
      const t = typeof opts.timeoutMs === "number" ? opts.timeoutMs : null;
      if (d != null && t != null && d >= Math.max(0, t - 350)) return "timeout";
      return "aborted";
    }
    if (opts.note === "upstream_not_streaming") return "upstream_not_streaming";
    if (/bad_json|non json|not json|parse|unexpected token/i.test(msg)) return "bad_response";
    if (/rate limit|too many requests|exceeded.*rate/i.test(msg)) return "rate_limited";
    return "unknown";
  }

  function sanitizeFailureMessage(raw: string): string {
    let s = String(raw ?? "").slice(0, 600);
    s = s.replace(/\bBearer\s+\S+/gi, "Bearer ***");
    s = s.replace(/\bsk-[a-zA-Z0-9]{8,}\b/g, "sk-***");
    s = s.trim();
    return s.length > 0 ? s : "unknown_error";
  }

  function emitJobFailed(opts: {
    job: Job;
    stage: "upstream_http" | "upstream_failed";
    message: string;
    failureReason?: FailureReason;
  }) {
    const message = sanitizeFailureMessage(opts.message);
    emit({
      v: 1,
      ts: nowIso(),
      type: "job.failed",
      sessionId: serverSessionId,
      correlationId: opts.job.id,
      agentId: opts.job.agentId,
      payload: {
        jobId: opts.job.id,
        stage: opts.stage,
        message,
        failureReason: opts.failureReason,
        projectId: opts.job.projectId,
        workgroupId: opts.job.workgroupId
      }
    });
  }

  const HTML_OUTPUT_AGENTS = new Set([
    "lead-programmer",
    "web-h5-specialist",
    "gameplay-programmer",
    "ui-programmer",
    "prototyper"
  ]);

  function jobWantsFullHtmlOutput(agentId: string, task: string): boolean {
    if (!HTML_OUTPUT_AGENTS.has(agentId)) return false;
    const t = String(task ?? "").replace(/\s+/g, " ");
    return (
      /【立项衔接·程序】/.test(t) ||
      /单文件|完整\s*HTML|<!doctype|可玩.*HTML|保存到项目预览|Canvas|试玩|index\.html|单页|吃豆|迷宫/i.test(t)
    );
  }

  const JOB_SYSTEM_DEFAULT =
    "你是工作室中的一个岗位Agent。请用简短中文输出你将如何执行任务，并给出下一步清单。";
  const JOB_SYSTEM_HTML_FULL = [
    "你是浏览器端 H5 小游戏工程师。本任务必须产出「可直接运行」的单文件 HTML。",
    "回复中必须包含完整文档：从第一行 <!doctype html> 开始，到最后一行 </html> 结束，内联 <style> 与 <script>（可用 Canvas 做极简玩法：移动、得分、敌人或障碍、重开）。",
    "禁止只输出计划/提纲/待办；禁止说稍后给代码；禁止用外链占位代替实现；只输出这一个 HTML 文件的内容。",
    "若用户提到吃豆人/迷宫等，按题意实现可玩最小闭环。"
  ].join("");

  async function runJob(job: Job, slotId: string) {
    const startedAt = Date.now();
    job.status = "running";
    running.set(slotId, job);

    emit({
      v: 1,
      ts: nowIso(),
      type: "job.started",
      sessionId: serverSessionId,
      correlationId: job.id,
      agentId: job.agentId,
      payload: { jobId: job.id, task: job.task, slotId, providerId: job.providerId, projectId: job.projectId, workgroupId: job.workgroupId }
    });

    const providers = getProviders();
    const provider = providers.find((p) => p.id === job.providerId) ?? providers[0];
    // Best-effort: call provider chat.completions via OpenAI-compatible API.
    const upstreamUrl = new URL("chat/completions", provider.baseUrl.endsWith("/") ? provider.baseUrl : provider.baseUrl + "/");
    const wantsFullHtml = jobWantsFullHtmlOutput(job.agentId, job.task);
    const systemPrompt = wantsFullHtml ? JOB_SYSTEM_HTML_FULL : JOB_SYSTEM_DEFAULT;
    const qaHeavy = /【立项衔接·QA】/.test(String(job.task).replace(/\s+/g, " "));
    const timeoutMs = wantsFullHtml
      ? Number(process.env.STUDIO_HTML_JOB_TIMEOUT_MS ?? "180000")
      : qaHeavy
        ? Number(process.env.STUDIO_QA_JOB_TIMEOUT_MS ?? "120000")
        : Number(process.env.STUDIO_JOB_TIMEOUT_MS ?? "45000");
    /** 程序整页 HTML / 衔接 QA：默认走非流式，避免部分云端 SSE 与 Node fetch 组合下拼不出正文或长时间不结束，导致预览不落盘、QA 卡在生成中 */
    const useStream =
      wantsFullHtml
        ? process.env.STUDIO_HTML_FORCE_STREAM === "1"
        : qaHeavy
          ? process.env.STUDIO_QA_FORCE_STREAM === "1"
          : true;
    const body: Record<string, unknown> = {
      model: provider.model,
      stream: useStream,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: job.task }
      ]
    };
    if (wantsFullHtml) {
      // 云端（如 deepseek-chat）常见上限 8192；过大直接 400 导致预览永远不落盘
      const reqMax = Number(process.env.STUDIO_HTML_MAX_TOKENS ?? "8192");
      body.max_tokens = Math.max(1, Math.min(8192, Math.floor(Number.isFinite(reqMax) ? reqMax : 8192)));
    } else if (qaHeavy) {
      body.max_tokens = Number(process.env.STUDIO_QA_MAX_TOKENS ?? "8192");
    }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let assistantAccum = "";
      const apiKey = providerConfig[provider.id as "local" | "cloud"]?.apiKey;
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const ct = upstreamRes.headers.get("content-type") ?? "";
      const isSse = ct.includes("text/event-stream");

      const emitSimulated = async () => {
        emit({
          v: 1,
          ts: nowIso(),
          type: "llm.chunk",
          sessionId: serverSessionId,
          correlationId: job.id,
          agentId: job.agentId,
          payload: { text: "（上游模型不可用，使用本地模拟输出）\n- 已接收任务\n- 将拆分步骤并排队执行\n" }
        });
        await new Promise((r) => setTimeout(r, 800));
        emit({ v: 1, ts: nowIso(), type: "llm.message_done", sessionId: serverSessionId, correlationId: job.id, agentId: job.agentId, payload: {} });
      };

      if (upstreamRes.ok && isSse && upstreamRes.body) {
        const decoder = new TextDecoder();
        let buffered = "";
        let sawMessageDone = false;
        const reader = upstreamRes.body.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunkText = decoder.decode(value, { stream: true });
            buffered += chunkText;

            const parts = buffered.split("\n");
            buffered = parts.pop() ?? "";

            for (const line of parts) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const data = trimmed.slice("data:".length).trim();
              if (!data) continue;
              if (data === "[DONE]") {
                sawMessageDone = true;
                emit({ v: 1, ts: nowIso(), type: "llm.message_done", sessionId: serverSessionId, correlationId: job.id, agentId: job.agentId, payload: {} });
                continue;
              }
              try {
                const obj = JSON.parse(data) as any;
                const piece = streamChoiceChunkToAssistantText(obj);
                if (piece.length > 0) {
                  if (wantsFullHtml) assistantAccum += piece;
                  emit({ v: 1, ts: nowIso(), type: "llm.chunk", sessionId: serverSessionId, correlationId: job.id, agentId: job.agentId, payload: { text: piece } });
                }
              } catch {
                // ignore
              }
            }
          }
        } finally {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
        }
        const flushTail = (tail: string) => {
          for (const line of tail.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice("data:".length).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              sawMessageDone = true;
              emit({ v: 1, ts: nowIso(), type: "llm.message_done", sessionId: serverSessionId, correlationId: job.id, agentId: job.agentId, payload: {} });
            }
          }
        };
        flushTail(buffered);
        if (!sawMessageDone) {
          emit({ v: 1, ts: nowIso(), type: "llm.message_done", sessionId: serverSessionId, correlationId: job.id, agentId: job.agentId, payload: {} });
        }
      } else if (!upstreamRes.ok) {
        const raw = await upstreamRes.text();
        const errMsg = extractUpstreamErrorMessage(raw);
        await emitSimulated();
        const durationMs = Date.now() - startedAt;
        job.status = "done";
        const safePid = String(job.projectId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
        if (wantsFullHtml && safePid) {
          emit({
            v: 1,
            ts: nowIso(),
            type: "policy.decision",
            sessionId: serverSessionId,
            correlationId: newId("policy"),
            agentId: job.agentId,
            payload: {
              action: "preview_not_saved_from_job",
              projectId: safePid,
              reason: "upstream_http",
              jobId: job.id,
              upstreamStatus: upstreamRes.status
            }
          });
        }
        const frHttp = classifyFailure({ upstreamStatus: upstreamRes.status, error: errMsg ?? raw, durationMs, timeoutMs });
        emitJobFailed({
          job,
          stage: "upstream_http",
          message: errMsg ?? raw.slice(0, 400),
          failureReason: frHttp
        });
        emit({
          v: 1,
          ts: nowIso(),
          type: "job.finished",
          sessionId: serverSessionId,
          correlationId: job.id,
          agentId: job.agentId,
          payload: {
            jobId: job.id,
            ok: false,
            slotId,
            providerId: job.providerId,
            upstreamStatus: upstreamRes.status,
            failureReason: frHttp,
            error: sanitizeFailureMessage(errMsg ?? raw.slice(0, 200)),
            durationMs,
            projectId: job.projectId,
            workgroupId: job.workgroupId,
            ...(wantsFullHtml ? { previewHtml: { saved: false as const, reason: "upstream_http" as const } } : {})
          }
        });
        onJobTerminal(job);
        return;
      } else if (upstreamRes.ok) {
        const raw = await upstreamRes.text();
        const text = assistantTextFromChatCompletionJson(raw);
        if (typeof text === "string" && text.length > 0) {
          if (wantsFullHtml) assistantAccum = text;
          emit({ v: 1, ts: nowIso(), type: "llm.chunk", sessionId: serverSessionId, correlationId: job.id, agentId: job.agentId, payload: { text } });
          await new Promise((r) => setTimeout(r, 200));
          emit({ v: 1, ts: nowIso(), type: "llm.message_done", sessionId: serverSessionId, correlationId: job.id, agentId: job.agentId, payload: {} });
        } else {
          await emitSimulated();
        }
      } else {
        await emitSimulated();
      }

      job.status = "done";
      let previewPersist: PersistPreviewResult | undefined;
      if (wantsFullHtml) {
        previewPersist = await persistPreviewHtmlIfValid(job.projectId, assistantAccum, { agentId: job.agentId });
        const r0 = previewPersist.saved ? null : previewPersist.reason;
        const canRetry =
          process.env.STUDIO_HTML_NO_RETRY !== "1" &&
          (r0 === "empty" || r0 === "too_short" || r0 === "invalid_html");
        if (canRetry) {
          emit({
            v: 1,
            ts: nowIso(),
            type: "llm.chunk",
            sessionId: serverSessionId,
            correlationId: job.id,
            agentId: job.agentId,
            payload: {
              text: `（Studio：首次输出未通过预览保存校验「${r0}」，正自动非流式重试一次…）\n`
            }
          });
          const controller2 = new AbortController();
          const t2 = setTimeout(() => controller2.abort(), timeoutMs);
          try {
            const retryUser = `${job.task}\n\n【系统自动重试】上一段未形成可保存的完整单文件 HTML（校验：${r0}）。禁止 Markdown 围栏与开场白；只输出一个可直接运行的 HTML：第一行 <!doctype html>，最后一行 </html>，内联 <style> 与 <script>。`;
            const retryRes = await fetch(upstreamUrl, {
              method: "POST",
              headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
              body: JSON.stringify({
                model: provider.model,
                stream: false,
                max_tokens: Math.max(
                  1,
                  Math.min(8192, Math.floor(Number(process.env.STUDIO_HTML_MAX_TOKENS ?? "8192") || 8192))
                ),
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: retryUser }
                ]
              }),
              signal: controller2.signal
            });
            if (retryRes.ok) {
              const raw2 = await retryRes.text();
              const text2 = assistantTextFromChatCompletionJson(raw2);
              if (typeof text2 === "string" && text2.length > 0) {
                assistantAccum = text2;
                emit({
                  v: 1,
                  ts: nowIso(),
                  type: "llm.chunk",
                  sessionId: serverSessionId,
                  correlationId: job.id,
                  agentId: job.agentId,
                  payload: { text: `（重试收到 ${text2.length} 字符，正在写入预览）\n` }
                });
                emit({ v: 1, ts: nowIso(), type: "llm.message_done", sessionId: serverSessionId, correlationId: job.id, agentId: job.agentId, payload: {} });
                previewPersist = await persistPreviewHtmlIfValid(job.projectId, assistantAccum, { agentId: job.agentId });
              }
            }
          } catch {
            // 重试失败则保留首次 previewPersist
          } finally {
            clearTimeout(t2);
          }
        }
        if (previewPersist && !previewPersist.saved) {
          const sp = String(job.projectId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
          if (sp) {
            emit({
              v: 1,
              ts: nowIso(),
              type: "policy.decision",
              sessionId: serverSessionId,
              correlationId: newId("policy"),
              agentId: job.agentId,
              payload: {
                action: "preview_not_saved_from_job",
                projectId: sp,
                reason: previewPersist.reason,
                jobId: job.id,
                retried: Boolean(canRetry)
              }
            });
          }
        }
      }
      emit({
        v: 1,
        ts: nowIso(),
        type: "job.finished",
        sessionId: serverSessionId,
        correlationId: job.id,
        agentId: job.agentId,
        payload: {
          jobId: job.id,
          ok: true,
          slotId,
          providerId: job.providerId,
          durationMs: Date.now() - startedAt,
          projectId: job.projectId,
          workgroupId: job.workgroupId,
          ...(wantsFullHtml && previewPersist
            ? {
                previewHtml:
                  previewPersist.saved === true
                    ? { saved: true as const, bytes: previewPersist.bytes, historyFile: previewPersist.historyFile }
                    : { saved: false as const, reason: previewPersist.reason }
              }
            : {})
        }
      });
      onJobTerminal(job);
    } catch (e) {
      // Keep the studio playable even when upstream is missing.
      emit({
        v: 1,
        ts: nowIso(),
        type: "llm.chunk",
        sessionId: serverSessionId,
        correlationId: job.id,
        agentId: job.agentId,
        payload: { text: `（上游模型调用失败，已降级为模拟模式：${e instanceof Error ? e.message : String(e)}）\n- 已记录任务\n- 建议检查 STUDIO_UPSTREAM_BASE_URL / STUDIO_MODEL\n` }
      });
      emit({ v: 1, ts: nowIso(), type: "llm.message_done", sessionId: serverSessionId, correlationId: job.id, agentId: job.agentId, payload: {} });
      job.status = "done";
      const durationMs = Date.now() - startedAt;
      const reason = classifyFailure({ error: e, aborted: controller.signal.aborted, durationMs, timeoutMs });
      const safePid = String(job.projectId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
      if (wantsFullHtml && safePid) {
        emit({
          v: 1,
          ts: nowIso(),
          type: "policy.decision",
          sessionId: serverSessionId,
          correlationId: newId("policy"),
          agentId: job.agentId,
          payload: {
            action: "preview_not_saved_from_job",
            projectId: safePid,
            reason: "upstream_failed",
            jobId: job.id,
            detail: e instanceof Error ? e.message : String(e)
          }
        });
      }
      const errStr = e instanceof Error ? e.message : String(e);
      emitJobFailed({
        job,
        stage: "upstream_failed",
        message: errStr,
        failureReason: reason
      });
      emit({
        v: 1,
        ts: nowIso(),
        type: "job.finished",
        sessionId: serverSessionId,
        correlationId: job.id,
        agentId: job.agentId,
        payload: {
          jobId: job.id,
          ok: false,
          slotId,
          providerId: job.providerId,
          failureReason: reason,
          error: sanitizeFailureMessage(errStr),
          durationMs,
          projectId: job.projectId,
          workgroupId: job.workgroupId,
          ...(wantsFullHtml ? { previewHtml: { saved: false as const, reason: "upstream_failed" as const } } : {})
        }
      });
      onJobTerminal(job);
    } finally {
      clearTimeout(t);
      running.delete(slotId);
      void pumpQueue();
    }
  }

  async function pumpQueue() {
    while (true) {
      const freeSlots = Math.max(0, settings.computeSlots - running.size);
      if (freeSlots <= 0) return;
      sortQueue();
      const next = queue.find((j) => j.status === "queued");
      if (!next) return;

      const slotId = `slot_${running.size + 1}`;
      void runJob(next, slotId);
    }
  }

  /** 入队单条执行任务（与 /api/queue/enqueue 校验对齐的子集） */
  async function enqueueOneExecutionJob(opts: {
    agentId: string;
    task: string;
    priority: number;
    projectId: string;
    workgroupId: string;
    sourceTag?: string;
    producerChainId?: string;
    producerChainStepIndex?: number;
  }): Promise<boolean> {
    const { agentId, task, priority, projectId, workgroupId, sourceTag, producerChainId, producerChainStepIndex } = opts;
    const parsed: Record<string, unknown> = {
      usage: "execution",
      ...(sourceTag === "producer_chain" ? { producerCascade: true as const } : {})
    };
    let providerId: string;
    let providerReason: string | undefined;
    if (agentProvider.has(agentId)) {
      providerId = agentProvider.get(agentId)!;
      providerReason = "agent_provider_override";
    } else {
      const picked = await pickQueueProviderId(agentId, parsed);
      providerId = picked.providerId;
      providerReason = picked.providerReason;
    }
    const providers = getProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider || !provider.capabilities.includes("text")) return false;
    if (hired.size > 0 && !hired.has(agentId)) return false;

    const snap = await getAdviceSnapshot();
    const projectLimit = snap.grade === "S" ? 3 : snap.grade === "A" ? 2 : 1;
    const activeProjectIds = new Set<string>();
    for (const j of queue) if (j.status === "queued" || j.status === "running") activeProjectIds.add(j.projectId);
    for (const j of running.values()) activeProjectIds.add(j.projectId);
    const isNewActive = !activeProjectIds.has(projectId);
    if (isNewActive && activeProjectIds.size >= projectLimit) return false;

    if (providerReason) {
      emit({
        v: 1,
        ts: nowIso(),
        type: "policy.decision",
        sessionId: serverSessionId,
        correlationId: newId("policy"),
        agentId,
        payload: { action: "select_provider", reason: providerReason, providerId, from: sourceTag ?? "enqueue_one" }
      });
    }

    const job: Job = {
      id: newId("job"),
      agentId,
      task,
      priority,
      createdAt: nowIso(),
      providerId,
      projectId,
      workgroupId,
      status: "queued",
      source: sourceTag,
      ...(producerChainId ? { producerChainId, producerChainStepIndex } : {})
    };
    queue.push(job);
    emit({
      v: 1,
      ts: nowIso(),
      type: "job.enqueued",
      sessionId: serverSessionId,
      correlationId: job.id,
      agentId,
      payload: {
        jobId: job.id,
        task: job.task,
        priority: job.priority,
        projectId,
        workgroupId,
        source: sourceTag ?? "execution"
      }
    });
    void pumpQueue();
    return true;
  }

  /** 立项首包成功后：按策略自动入队策划→程序→美术→QA（串行随队列；并发槽>1 时可能重叠） */
  async function maybeEnqueueProducerCascade(finishedJob: Job) {
    if (finishedJob.source !== "meeting_kickoff") return;
    if (!policy.producer.autoDispatch) return;

    const pid = finishedJob.projectId;
    const wg = finishedJob.workgroupId;
    const c = ensureCharterProject(pid);
    const goal = (c.draft.goal || "").trim() || "（见章程）";
    const ms = c.draft.milestones.length ? c.draft.milestones.join("；") : "（未列）";

    const pick = (choices: string[]) => {
      if (hired.size === 0) return choices[0] ?? null;
      for (const id of choices) if (hired.has(id)) return id;
      return null;
    };

    const steps: Array<{ agentId: string; task: string; priority: number }> = [];
    const designId = pick(["game-designer", "systems-designer"]);
    if (designId) {
      steps.push({
        agentId: designId,
        priority: 2,
        task: `【立项衔接·策划】项目 ${pid} 已立项，制作人首包已完成。请输出：核心玩法摘要、P0/P1 功能表、程序与美术各自交付物与验收点（简洁中文）。\n\n章程目标：${goal}\n里程碑：${ms}\n\n产出应便于程序迭代「单文件可玩 HTML」试玩、美术定风格参考。`
      });
    }
    const progId = pick(["lead-programmer", "web-h5-specialist", "gameplay-programmer"]);
    if (progId) {
      steps.push({
        agentId: progId,
        priority: 2,
        task: `【立项衔接·程序】项目 ${pid}：请直接输出单文件可玩 HTML（与章程一致的极简 Canvas 原型，例如吃豆人/迷宫类则做吃豆、幽灵或障碍、得分、重开）。\n必须输出完整文档：从 <!doctype html> 到 </html>，保存到项目预览后即可运行。不要只写步骤清单。\n\n章程目标：${goal}\n里程碑：${ms}`
      });
    }
    const artId = pick(["art-director", "technical-artist"]);
    if (artId) {
      steps.push({
        agentId: artId,
        priority: 2,
        task: `【立项衔接·美术】根据章程输出风格关键词、主色与界面层级建议；列出程序可用的占位图/音效要求。\n\n项目：${pid}\n目标摘要：${goal.slice(0, 240)}`
      });
    }
    const qaId = pick(["qa-lead", "qa-tester"]);
    if (qaId) {
      steps.push({
        agentId: qaId,
        priority: 1,
        task: `【立项衔接·QA】针对章程与可玩原型列冒烟用例（操作→期望），标出风险与回归范围。\n\n项目：${pid}`
      });
    }

    if (steps.length === 0) return;

    const chainId = newId("pch");
    producerChainById.set(chainId, { steps, cursor: 1 });
    const first = steps[0]!;
    const ok = await enqueueOneExecutionJob({
      agentId: first.agentId,
      task: first.task,
      priority: first.priority,
      projectId: pid,
      workgroupId: wg,
      sourceTag: "producer_chain",
      producerChainId: chainId,
      producerChainStepIndex: 0
    });
    if (ok) {
      emit({
        v: 1,
        ts: nowIso(),
        type: "policy.decision",
        sessionId: serverSessionId,
        correlationId: newId("policy"),
        agentId: finishedJob.agentId,
        payload: {
          action: "producer_cascade",
          reason: "after_meeting_kickoff",
          enqueued: 1,
          totalSteps: steps.length,
          sequential: true,
          projectId: pid
        }
      });
    } else {
      producerChainById.delete(chainId);
    }
  }

  /** 衔接链上一步结束后入队下一步（严格串行：策划→程序→美术→QA） */
  function maybeAdvanceProducerChain(job: Job) {
    if (!job.producerChainId) return;
    const st = producerChainById.get(job.producerChainId);
    if (!st) return;
    if (st.cursor >= st.steps.length) {
      producerChainById.delete(job.producerChainId);
      return;
    }
    const s = st.steps[st.cursor]!;
    st.cursor++;
    void enqueueOneExecutionJob({
      agentId: s.agentId,
      task: s.task,
      priority: s.priority,
      projectId: job.projectId,
      workgroupId: job.workgroupId,
      sourceTag: "producer_chain",
      producerChainId: job.producerChainId,
      producerChainStepIndex: st.cursor - 1
    });
  }

  function onJobTerminal(job: Job) {
    maybeAdvanceProducerChain(job);
    void maybeEnqueueProducerCascade(job);
    // OA 工作流衔接
    if (job.source === "workflow") {
      for (const run of workflowRuns.values()) {
        const ok = job.status === "done";
        completeWorkflowStep(run, job.id, ok);
      }
    }
  }

  function pickKickoffAgentId(): string {
    if (hired.size === 0) return "producer";
    if (hired.has("producer")) return "producer";
    const prefer = ["creative-director", "technical-director", "game-designer", "lead-programmer"];
    for (const id of prefer) {
      if (hired.has(id)) return id;
    }
    return Array.from(hired).sort()[0]!;
  }

  async function enqueueMeetingKickoff(
    projectId: string
  ): Promise<
    { ok: true; job: Job; agentId: string; providerReason?: string } | { ok: false; error: string; details?: Record<string, unknown> }
  > {
    const pid = projectId.replace(/[^a-zA-Z0-9_-]/g, "") || currentProjectId.replace(/[^a-zA-Z0-9_-]/g, "");
    const c = ensureCharterProject(pid);
    const goal = (c.draft.goal || "").trim() || "（章程目标未填）";
    const ms = c.draft.milestones.length ? c.draft.milestones.join("；") : "（未列里程碑）";
    const agentId = pickKickoffAgentId();
    const task = `【立项后首包】项目已立项。请根据章程输出「本周可执行任务清单」：按岗位分组（策划/程序/美术/QA），每条一行，并标注建议优先级（P0/P1/P2）。若需澄清范围，先列出待确认问题。\n\n章程目标：${goal}\n里程碑：${ms}`;

    const parsed: Record<string, unknown> = { usage: "execution" };
    let providerId: string;
    let providerReason: string | undefined;
    if (agentProvider.has(agentId)) {
      providerId = agentProvider.get(agentId)!;
      providerReason = "agent_provider_override";
    } else {
      const picked = await pickQueueProviderId(agentId, parsed);
      providerId = picked.providerId;
      providerReason = picked.providerReason;
    }
    const providers = getProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider || !provider.capabilities.includes("text")) {
      return { ok: false, error: "provider_not_supported_for_text", details: { providerId } };
    }
    if (hired.size > 0 && !hired.has(agentId)) {
      return {
        ok: false,
        error: "agent_not_hired",
        details: { agentId, hint: "招聘中未包含制作人时：请雇佣 producer，或解雇全部以恢复默认派单" }
      };
    }

    const snap = await getAdviceSnapshot();
    const projectLimit = snap.grade === "S" ? 3 : snap.grade === "A" ? 2 : 1;
    const activeProjectIds = new Set<string>();
    for (const j of queue) if (j.status === "queued" || j.status === "running") activeProjectIds.add(j.projectId);
    for (const j of running.values()) activeProjectIds.add(j.projectId);
    const isNewActive = !activeProjectIds.has(pid);
    if (isNewActive && activeProjectIds.size >= projectLimit) {
      return { ok: false, error: "project_limit_reached", details: { projectLimit, active: Array.from(activeProjectIds.values()) } };
    }

    if (providerReason) {
      emit({
        v: 1,
        ts: nowIso(),
        type: "policy.decision",
        sessionId: serverSessionId,
        correlationId: newId("policy"),
        agentId,
        payload: { action: "select_provider", reason: providerReason, providerId, from: "meeting_kickoff" }
      });
    }

    const job: Job = {
      id: newId("job"),
      agentId,
      task,
      priority: 2,
      createdAt: nowIso(),
      providerId,
      projectId: pid,
      workgroupId: pid,
      status: "queued",
      source: "meeting_kickoff"
    };
    queue.push(job);
    emit({
      v: 1,
      ts: nowIso(),
      type: "job.enqueued",
      sessionId: serverSessionId,
      correlationId: job.id,
      agentId,
      payload: {
        jobId: job.id,
        task: job.task,
        priority: job.priority,
        projectId: pid,
        workgroupId: pid,
        source: "meeting_kickoff"
      }
    });
    void pumpQueue();
    return { ok: true, job, agentId, providerReason };
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? env.host}`);
      if (req.method === "OPTIONS") {
        json(res, 200, { ok: true });
        return;
      }

      // ======== Auth API ========
      const authUser = (() => {
        const token = (req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return null;
        const row = stmt.sessionByToken.get(token) as { user_id: number; username: string; studio_name: string } | undefined;
        return row ?? null;
      })();

      if (url.pathname === "/api/auth/register" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let p: any;
        try { p = JSON.parse(bodyRaw); } catch { json(res, 400, { ok: false, error: "bad_json" }); return; }
        const username = String(p?.username ?? "").trim();
        const password = String(p?.password ?? "").trim();
        const studioName = String(p?.studioName ?? "我的工作室").trim();
        if (!username || username.length < 2) { json(res, 400, { ok: false, error: "用户名至少2个字符" }); return; }
        if (!password || password.length < 4) { json(res, 400, { ok: false, error: "密码至少4个字符" }); return; }
        const existing = stmt.userByUsername.get(username);
        if (existing) { json(res, 409, { ok: false, error: "用户名已存在" }); return; }
        const { createHash } = await import("node:crypto");
        const hash = createHash("sha256").update(password + "studio_salt_2025").digest("hex");
        stmt.userInsert.run(username, hash, studioName, nowIso());
        json(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/api/auth/login" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let p: any;
        try { p = JSON.parse(bodyRaw); } catch { json(res, 400, { ok: false, error: "bad_json" }); return; }
        const username = String(p?.username ?? "").trim();
        const password = String(p?.password ?? "").trim();
        const user = stmt.userByUsername.get(username) as { id: number; username: string; password_hash: string; studio_name: string } | undefined;
        if (!user) { json(res, 401, { ok: false, error: "用户名或密码错误" }); return; }
        const { createHash } = await import("node:crypto");
        const hash = createHash("sha256").update(password + "studio_salt_2025").digest("hex");
        if (hash !== user.password_hash) { json(res, 401, { ok: false, error: "用户名或密码错误" }); return; }
        const token = newId("sess");
        stmt.sessionInsert.run(token, user.id, nowIso());
        stmt.userUpdateLogin.run(nowIso(), user.id);
        json(res, 200, { ok: true, token, studioName: user.studio_name, username: user.username });
        return;
      }

      if (url.pathname === "/api/auth/me" && req.method === "GET") {
        if (!authUser) { json(res, 401, { ok: false, error: "unauthorized" }); return; }
        json(res, 200, { ok: true, username: authUser.username, studioName: authUser.studio_name });
        return;
      }

      if (url.pathname === "/api/auth/logout" && req.method === "POST") {
        const token = (req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");
        if (token) stmt.sessionDelete.run(token);
        json(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/healthz") {
        json(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/api/projects" && req.method === "GET") {
        json(res, 200, { ok: true, currentProjectId, projects });
        return;
      }

      if (url.pathname === "/api/projects" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const title = String(parsed?.title ?? "").trim() || `项目${projects.length + 1}`;
        const id = `project_${projects.length + 1}`;
        const p: Project = { id, title, createdAt: nowIso() };
        projects.push(p);
        stmt.projectInsert.run(id, title, p.createdAt);
        ensureCharterProject(p.id);
        void persistCharterState();
        json(res, 200, { ok: true, project: p, projects, currentProjectId });
        return;
      }

      if (url.pathname === "/api/projects/select" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const pid = String(parsed?.projectId ?? "");
        if (!projects.some((p) => p.id === pid)) {
          json(res, 400, { ok: false, error: "unknown_project" });
          return;
        }
        currentProjectId = pid;
        json(res, 200, { ok: true, currentProjectId, projects });
        return;
      }

      // DELETE /api/projects/:id
      const projectDelMatch = /^\/api\/projects\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (projectDelMatch && req.method === "DELETE") {
        const projectId = projectDelMatch[1]!;
        if (projects.length <= 1) {
          json(res, 400, { ok: false, error: "cannot_delete_last_project" });
          return;
        }
        const idx = projects.findIndex((p) => p.id === projectId);
        if (idx === -1) { json(res, 404, { ok: false, error: "project_not_found" }); return; }
        for (const [slotId, job] of running) {
          if (job.projectId === projectId) {
            job.status = "cancelled"; stmt.jobCancel.run(dbNow(), job.id); running.delete(slotId);
            broadcast({ type: "job.cancelled", agentId: job.agentId, payload: { jobId: job.id, projectId }, ts: nowIso() });
          }
        }
        for (const job of queue) {
          if (job.projectId === projectId) {
            job.status = "cancelled"; stmt.jobCancel.run(dbNow(), job.id);
            broadcast({ type: "job.cancelled", agentId: job.agentId, payload: { jobId: job.id, projectId }, ts: nowIso() });
          }
        }
        queue.splice(0, queue.length, ...queue.filter((j) => j.projectId !== projectId));
        projects.splice(idx, 1); stmt.projectDelete.run(projectId);
        delete charterState.projects[projectId]; delete charterState.pendingChanges[projectId];
        void persistCharterState();
        if (currentProjectId === projectId) currentProjectId = projects[0]!.id;
        try { const { rm } = await import("node:fs/promises"); await rm(join(env.repoRoot, "production", "preview", projectId), { recursive: true, force: true }); } catch { /* ignore */ }
        json(res, 200, { ok: true, currentProjectId, projects });
        return;
      }

      // DELETE /api/jobs/:id (remove completed/failed/cancelled jobs from queue)
      const jobDelMatch = /^\/api\/jobs\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (jobDelMatch && req.method === "DELETE") {
        const jobId = jobDelMatch[1]!;
        const idx = queue.findIndex((j) => j.id === jobId && (j.status === "done" || j.status === "failed" || j.status === "cancelled"));
        if (idx === -1) { json(res, 404, { ok: false, error: "job_not_found_or_running" }); return; }
        const removed = queue.splice(idx, 1)[0]!;
        stmt.jobDelete.run(jobId);
        json(res, 200, { ok: true, jobId: removed.id, agentId: removed.agentId });
        return;
      }

      // POST /api/jobs/:id/cancel
      const jobCancelMatch = /^\/api\/jobs\/([a-zA-Z0-9_-]+)\/cancel$/.exec(url.pathname);
      if (jobCancelMatch && req.method === "POST") {
        const jobId = jobCancelMatch[1]!;
        let found: Job | undefined;
        for (const [slotId, j] of running) {
          if (j.id === jobId) { found = j; running.delete(slotId); break; }
        }
        if (!found) {
          const qi = queue.findIndex((j) => j.id === jobId && j.status === "queued");
          if (qi >= 0) { found = queue.splice(qi, 1)[0]; }
        }
        if (!found) { json(res, 404, { ok: false, error: "job_not_found" }); return; }
        found.status = "cancelled";
        stmt.jobCancel.run(dbNow(), jobId);
        if (found.producerChainId) {
          producerChainById.delete(found.producerChainId);
        }
        broadcast({ type: "job.cancelled", agentId: found.agentId, payload: { jobId, projectId: found.projectId }, ts: nowIso() });
        json(res, 200, { ok: true, jobId, agentId: found.agentId });
        return;
      }

      if (url.pathname === "/preview" && req.method === "GET") {
        // Serve the saved preview HTML (game output).
        const pid = String(url.searchParams.get("projectId") ?? "") || currentProjectId;
        const safePid = pid.replace(/[^a-zA-Z0-9_-]/g, "");
        const v = String(url.searchParams.get("v") ?? "").trim();
        const safeV = v.replace(/[^a-zA-Z0-9_.-]/g, "");
        const projIndexPath = safeV ? join(previewDir, safePid, "history", safeV) : join(previewDir, safePid, "index.html");
        res.statusCode = 200;
        applyCorsHeaders(res);
        res.setHeader("cache-control", "no-cache");
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.setHeader(
          "content-security-policy",
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' http: https: ws: wss:;"
        );
        if (!existsSync(projIndexPath)) {
          res.end(
            [
              "<!doctype html>",
              "<meta charset='utf-8'/>",
              "<title>Studio Preview</title>",
              "<body style='font-family:system-ui;background:#0b1020;color:#e7ecff;padding:18px'>",
              "<h3>还没有预览内容</h3>",
              "<p>去 Studio 的「显示器」面板粘贴 HTML 并保存即可。</p>",
              "</body>"
            ].join("")
          );
          return;
        }
        const html = await readFile(projIndexPath, "utf8");
        res.end(html);
        return;
      }

      if (url.pathname === "/api/preview/save" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const rawHtml = typeof parsed?.html === "string" ? parsed.html : "";
        const html = normalizePreviewHtmlString(rawHtml);
        const pid = String(parsed?.projectId ?? "") || currentProjectId;
        const safePid = pid.replace(/[^a-zA-Z0-9_-]/g, "");
        if (!html || html.length < 20) {
          json(res, 400, { ok: false, error: "html_too_short", details: { length: html.length } });
          return;
        }
        const dir = join(previewDir, safePid);
        const path = join(dir, "index.html");
        const histDir = join(dir, "history");
        await mkdir(dir, { recursive: true });
        await mkdir(histDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const histName = `preview_${ts}.html`;
        const histPath = join(histDir, histName);
        await writeFile(path, html, "utf8");
        await writeFile(histPath, html, "utf8");
        json(res, 200, {
          ok: true,
          path: `production/preview/${safePid}/index.html`,
          projectId: safePid,
          history: { file: histName, path: `production/preview/${safePid}/history/${histName}` }
        });
        return;
      }

      if (url.pathname === "/api/preview/history" && req.method === "GET") {
        const pid = String(url.searchParams.get("projectId") ?? "") || currentProjectId;
        const safePid = pid.replace(/[^a-zA-Z0-9_-]/g, "");
        const histDir = join(previewDir, safePid, "history");
        if (!existsSync(histDir)) {
          json(res, 200, { ok: true, projectId: safePid, files: [] });
          return;
        }
        try {
          const names = (await readdir(histDir, { withFileTypes: true }))
            .filter((d) => d.isFile())
            .map((d) => d.name)
            .filter((n) => /\.html$/i.test(n))
            .sort((a, b) => b.localeCompare(a));
          json(res, 200, { ok: true, projectId: safePid, files: names.slice(0, 60) });
        } catch (e) {
          json(res, 500, { ok: false, error: "history_read_failed", detail: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (url.pathname === "/api/preview/restore" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const pid = String(parsed?.projectId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
        const file = String(parsed?.file ?? "").trim();
        const safeFile = file.replace(/[^a-zA-Z0-9_.-]/g, "");
        if (!pid || !safeFile || !/^preview_.+\.html$/i.test(safeFile)) {
          json(res, 400, { ok: false, error: "bad_project_or_file" });
          return;
        }
        const histPath = join(previewDir, pid, "history", safeFile);
        const indexPath = join(previewDir, pid, "index.html");
        if (!existsSync(histPath)) {
          json(res, 404, { ok: false, error: "history_not_found" });
          return;
        }
        try {
          const html = await readFile(histPath, "utf8");
          await mkdir(join(previewDir, pid), { recursive: true });
          await writeFile(indexPath, html, "utf8");
          json(res, 200, { ok: true, projectId: pid, restoredFrom: safeFile });
        } catch (e) {
          json(res, 500, { ok: false, error: "restore_failed", detail: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (url.pathname === "/api/studio/failures" && req.method === "GET") {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? "30")));
        if (!existsSync(env.logPath)) {
          json(res, 200, { ok: true, failures: [] });
          return;
        }
        try {
          const raw = await readFile(env.logPath, "utf8");
          const lines = raw.trim().split("\n").filter(Boolean);
          const failures: Array<{
            ts: string;
            type: string;
            correlationId: string;
            agentId?: string;
            payload: Record<string, unknown>;
          }> = [];
          for (let i = lines.length - 1; i >= 0 && failures.length < limit; i--) {
            try {
              const ev = JSON.parse(lines[i]) as StudioEventEnvelope;
              if (ev.type === "job.failed") {
                failures.push({
                  ts: ev.ts,
                  type: ev.type,
                  correlationId: ev.correlationId,
                  agentId: ev.agentId,
                  payload: ev.payload as Record<string, unknown>
                });
              } else if (ev.type === "job.finished" && (ev.payload as { ok?: boolean }).ok === false) {
                failures.push({
                  ts: ev.ts,
                  type: ev.type,
                  correlationId: ev.correlationId,
                  agentId: ev.agentId,
                  payload: ev.payload as Record<string, unknown>
                });
              }
            } catch {
              // skip bad line
            }
          }
          json(res, 200, { ok: true, failures });
        } catch (e) {
          json(res, 500, { ok: false, error: "failures_read_failed", detail: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (url.pathname === "/api/studio/assets/generate-image" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const projectId = String(parsed?.projectId ?? "");
        const prompt = String(parsed?.prompt ?? "");
        const n = parsed?.n;
        const size = parsed?.size;
        const imageBaseUrl = process.env.STUDIO_IMAGE_BASE_URL?.trim() || "https://api.openai.com/v1";
        const apiKey = process.env.STUDIO_IMAGE_API_KEY?.trim() || providerConfig.cloud.apiKey;
        const model = process.env.STUDIO_IMAGE_MODEL?.trim();
        const r = await studioGenerateImages({
          repoRoot: env.repoRoot,
          projectId,
          prompt,
          n,
          size,
          imageBaseUrl,
          apiKey,
          model
        });
        if (!r.ok) {
          emit({
            v: 1,
            ts: nowIso(),
            type: "asset.pipeline_failed",
            sessionId: serverSessionId,
            correlationId: newId("asset"),
            payload: {
              projectId: String(projectId).replace(/[^a-zA-Z0-9_-]/g, ""),
              stage: "image_gen",
              message: r.error
            }
          });
          json(res, 502, { ok: false, error: r.error });
          return;
        }
        emit({
          v: 1,
          ts: nowIso(),
          type: "asset.image_saved",
          sessionId: serverSessionId,
          correlationId: newId("asset"),
          payload: { projectId: r.projectId, runId: r.runId, paths: r.relPaths }
        });
        json(res, 200, { ok: true, projectId: r.projectId, runId: r.runId, paths: r.relPaths });
        return;
      }

      if (url.pathname === "/api/studio/assets/pack-spritesheet" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const projectId = String(parsed?.projectId ?? "");
        const runId = String(parsed?.runId ?? "");
        const framePaths = Array.isArray(parsed?.framePaths)
          ? (parsed.framePaths as unknown[]).map((x) => String(x))
          : undefined;
        const r = await studioPackSpritesheet({
          repoRoot: env.repoRoot,
          projectId,
          runId,
          framePaths
        });
        if (!r.ok) {
          emit({
            v: 1,
            ts: nowIso(),
            type: "asset.pipeline_failed",
            sessionId: serverSessionId,
            correlationId: newId("asset"),
            payload: {
              projectId: String(projectId).replace(/[^a-zA-Z0-9_-]/g, ""),
              stage: "spritesheet",
              message: r.error
            }
          });
          json(res, 400, { ok: false, error: r.error });
          return;
        }
        emit({
          v: 1,
          ts: nowIso(),
          type: "asset.spritesheet_saved",
          sessionId: serverSessionId,
          correlationId: newId("asset"),
          payload: {
            projectId: r.projectId,
            runId: r.runId,
            sheet: r.sheetRel,
            manifest: r.manifestRel
          }
        });
        json(res, 200, {
          ok: true,
          projectId: r.projectId,
          runId: r.runId,
          sheet: r.sheetRel,
          manifest: r.manifestRel
        });
        return;
      }

      if (url.pathname === "/api/studio/assets/transcode-video" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const projectId = String(parsed?.projectId ?? "");
        const inputRel = String(parsed?.inputRel ?? "");
        const r = await studioTranscodeVideo({ repoRoot: env.repoRoot, projectId, inputRel });
        json(res, 200, r);
        return;
      }

      if (url.pathname === "/api/agents" && req.method === "GET") {
        const agents = await listAgents(env.repoRoot);
        json(res, 200, { agents });
        return;
      }

      if (url.pathname === "/api/log-tail" && req.method === "GET") {
        // Best-effort tail: last N lines for late-joining UI.
        const n = Math.max(1, Math.min(500, Number(url.searchParams.get("n") ?? "200")));
        if (!existsSync(env.logPath)) {
          json(res, 200, { lines: [] });
          return;
        }
        const raw = await readFile(env.logPath, "utf8");
        const lines = raw.trim().split("\n").slice(-n);
        json(res, 200, { lines });
        return;
      }

      if (url.pathname === "/api/settings" && req.method === "GET") {
        json(res, 200, { settings });
        return;
      }

      if (url.pathname === "/api/policy" && req.method === "GET") {
        json(res, 200, { ok: true, policy });
        return;
      }

      if (url.pathname === "/api/policy" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const next = parsed?.policy;
        if (!next || typeof next !== "object") {
          json(res, 400, { ok: false, error: "missing_policy" });
          return;
        }
        // shallow validate + clamp
        const p = defaultPolicy();
        const mode = (m: any) => (m === "llm" ? "llm" : "rules");
        p.producer.mode = mode(next?.producer?.mode);
        p.producer.autoSplit = Boolean(next?.producer?.autoSplit);
        p.producer.autoDispatch = Boolean(next?.producer?.autoDispatch);
        p.producer.maxSubtasks = Math.max(1, Math.min(12, Math.floor(Number(next?.producer?.maxSubtasks ?? p.producer.maxSubtasks))));

        p.technicalDirector.mode = mode(next?.technicalDirector?.mode);
        p.technicalDirector.autoOutsource = Boolean(next?.technicalDirector?.autoOutsource);
        p.technicalDirector.firstChunkMsThreshold = Math.max(
          200,
          Math.min(10_000, Math.floor(Number(next?.technicalDirector?.firstChunkMsThreshold ?? p.technicalDirector.firstChunkMsThreshold)))
        );
        p.technicalDirector.pauseOnErrors = Boolean(next?.technicalDirector?.pauseOnErrors);

        p.creativeDirector.mode = mode(next?.creativeDirector?.mode);
        p.creativeDirector.gateOnNoPreview = Boolean(next?.creativeDirector?.gateOnNoPreview);
        p.creativeDirector.requireAcceptanceCriteria = Boolean(next?.creativeDirector?.requireAcceptanceCriteria);

        policy = p;
        // keep existing settings in sync with technical director policy (MVP)
        settings.autoOutsource = policy.technicalDirector.autoOutsource;
        settings.autoOutsourceFirstChunkMsThreshold = policy.technicalDirector.firstChunkMsThreshold;

        emit({
          v: 1,
          ts: nowIso(),
          type: "policy.decision",
          sessionId: serverSessionId,
          correlationId: newId("policy"),
          agentId: pickAgentId(req),
          payload: { action: "save", reason: "user_update", policy: { ...policy, technicalDirector: { ...policy.technicalDirector, apiKey: undefined } } }
        });

        try {
          await mkdir(join(env.repoRoot, "production"), { recursive: true });
          await writeFile(policyPath, JSON.stringify({ policy }, null, 2), "utf8");
        } catch {
          // ignore persist error (still apply in-memory)
        }

        json(res, 200, { ok: true, policy });
        return;
      }

      if (url.pathname === "/api/model-routing" && req.method === "GET") {
        json(res, 200, { ok: true, modelRouting });
        return;
      }

      if (url.pathname === "/api/model-routing" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const tier = parsed?.tier;
        if (tier === "save" || tier === "balance" || tier === "quality") {
          modelRouting.tier = tier;
          const d = applyTier(tier);
          modelRouting.executionProviderId = d.executionProviderId;
          modelRouting.meetingProviderId = d.meetingProviderId;
        }
        if (typeof parsed?.executionProviderId === "string") modelRouting.executionProviderId = String(parsed.executionProviderId);
        if (typeof parsed?.meetingProviderId === "string") modelRouting.meetingProviderId = String(parsed.meetingProviderId);
        await persistModelRouting();
        json(res, 200, { ok: true, modelRouting });
        return;
      }

      if (url.pathname === "/api/charter" && req.method === "GET") {
        const pid = String(url.searchParams.get("projectId") ?? "").replace(/[^a-zA-Z0-9_-]/g, "") || currentProjectId.replace(/[^a-zA-Z0-9_-]/g, "");
        const c = ensureCharterProject(pid);
        json(res, 200, { ok: true, projectId: pid, draft: c.draft, archived: c.archived, pending: charterState.pendingChanges[pid] ?? null });
        return;
      }

      if (url.pathname === "/api/charter" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const pid = String(parsed?.projectId ?? currentProjectId).replace(/[^a-zA-Z0-9_-]/g, "");
        const c = ensureCharterProject(pid);
        const d = parsed?.draft;
        if (d && typeof d === "object") {
          c.draft = {
            goal: String(d?.goal ?? ""),
            milestones: Array.isArray(d?.milestones) ? d.milestones.map((x: any) => String(x)) : [],
            nodes: Array.isArray(d?.nodes) ? d.nodes.map((x: any) => String(x)) : []
          };
        }
        await persistCharterState();
        emit({
          v: 1,
          ts: nowIso(),
          type: "charter.draft_saved",
          sessionId: serverSessionId,
          correlationId: newId("chr"),
          payload: { projectId: pid, summary: c.draft.goal.slice(0, 120) }
        });
        const kinds = driftKinds(c.draft, c.archived);
        await maybeEmitDrift(pid, kinds, "章程草稿与已归档版本不一致");
        json(res, 200, { ok: true, projectId: pid, draft: c.draft, archived: c.archived, drift: kinds, pending: charterState.pendingChanges[pid] ?? null });
        return;
      }

      if (url.pathname === "/api/charter/archive" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const pid = String(parsed?.projectId ?? currentProjectId).replace(/[^a-zA-Z0-9_-]/g, "");
        const c = ensureCharterProject(pid);
        const nextVer = (c.archived?.version ?? 0) + 1;
        const archived: CharterArchived = {
          ...c.draft,
          version: nextVer,
          archivedAt: nowIso()
        };
        c.archived = archived;
        c.history.push(archived);
        delete charterState.pendingChanges[pid];
        await persistCharterState();
        emit({
          v: 1,
          ts: nowIso(),
          type: "charter.archived",
          sessionId: serverSessionId,
          correlationId: newId("chr"),
          payload: { projectId: pid, version: nextVer, summary: archived.goal.slice(0, 120) }
        });
        emit({
          v: 1,
          ts: nowIso(),
          type: "change.cleared",
          sessionId: serverSessionId,
          correlationId: newId("chg"),
          payload: { projectId: pid, reason: "archived" }
        });
        json(res, 200, { ok: true, projectId: pid, archived });
        return;
      }

      if (url.pathname === "/api/charter/history" && req.method === "GET") {
        const pid = String(url.searchParams.get("projectId") ?? "").replace(/[^a-zA-Z0-9_-]/g, "") || currentProjectId.replace(/[^a-zA-Z0-9_-]/g, "");
        const c = ensureCharterProject(pid);
        json(res, 200, { ok: true, projectId: pid, history: c.history.slice(-20) });
        return;
      }

      if (url.pathname === "/api/charter/changes" && req.method === "GET") {
        const pid = String(url.searchParams.get("projectId") ?? "").replace(/[^a-zA-Z0-9_-]/g, "") || currentProjectId.replace(/[^a-zA-Z0-9_-]/g, "");
        json(res, 200, { ok: true, projectId: pid, pending: charterState.pendingChanges[pid] ?? null });
        return;
      }

      if (url.pathname === "/api/charter/changes" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const pid = String(parsed?.projectId ?? currentProjectId).replace(/[^a-zA-Z0-9_-]/g, "");
        const action = String(parsed?.action ?? "clear");
        if (action === "clear") {
          delete charterState.pendingChanges[pid];
          await persistCharterState();
          emit({
            v: 1,
            ts: nowIso(),
            type: "change.cleared",
            sessionId: serverSessionId,
            correlationId: newId("chg"),
            payload: { projectId: pid, reason: "user_clear" }
          });
        }
        json(res, 200, { ok: true, projectId: pid, pending: charterState.pendingChanges[pid] ?? null });
        return;
      }

      if (url.pathname === "/api/meeting/start" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const pid = String(parsed?.projectId ?? currentProjectId).replace(/[^a-zA-Z0-9_-]/g, "");
        const topic = String(parsed?.topic ?? "");
        emit({
          v: 1,
          ts: nowIso(),
          type: "meeting.started",
          sessionId: serverSessionId,
          correlationId: newId("mtg"),
          payload: { projectId: pid, topic: topic.slice(0, 200) }
        });
        json(res, 200, { ok: true, projectId: pid });
        return;
      }

      if (url.pathname === "/api/meeting/decide" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const pid = String(parsed?.projectId ?? currentProjectId).replace(/[^a-zA-Z0-9_-]/g, "");
        const decision = String(parsed?.decision ?? "");
        emit({
          v: 1,
          ts: nowIso(),
          type: "meeting.decided",
          sessionId: serverSessionId,
          correlationId: newId("mtg"),
          payload: { projectId: pid, decision: decision.slice(0, 200) }
        });
        json(res, 200, { ok: true, projectId: pid });
        return;
      }

      if (url.pathname === "/api/meeting/kickoff" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const pid = String(parsed?.projectId ?? currentProjectId).replace(/[^a-zA-Z0-9_-]/g, "") || currentProjectId;
        const r = await enqueueMeetingKickoff(pid);
        if (!r.ok) {
          json(res, 400, { ok: false, error: r.error, details: r.details });
          return;
        }
        json(res, 200, {
          ok: true,
          projectId: pid,
          job: r.job,
          agentId: r.agentId,
          providerReason: r.providerReason
        });
        return;
      }

      if (url.pathname === "/api/meeting/llm_ping" && req.method === "POST") {
        const providerId = modelRouting.meetingProviderId;
        const providers = getProviders();
        const p = providers.find((x) => x.id === providerId);
        const t0 = Date.now();
        const pingDeadline = Number(process.env.STUDIO_MEETING_PING_MS ?? "25000");
        const llm = await chatCompletionNonStreaming(
          providerId,
          [{ role: "user", content: "只回复一个汉字「好」，不要其它字符。" }],
          pingDeadline
        );
        const latencyMs = Date.now() - t0;
        if (!llm.ok) {
          json(res, 200, {
            ok: false,
            providerId,
            model: p?.model ?? null,
            baseUrl: p?.baseUrl ?? null,
            error: llm.error,
            status: "status" in llm ? llm.status : undefined,
            latencyMs
          });
          return;
        }
        json(res, 200, {
          ok: true,
          providerId,
          model: p?.model ?? null,
          baseUrl: p?.baseUrl ?? null,
          latencyMs,
          snippet: llm.text.slice(0, 120)
        });
        return;
      }

      if (url.pathname === "/api/meeting/llm_transcript" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const pid = String(parsed?.projectId ?? currentProjectId).replace(/[^a-zA-Z0-9_-]/g, "");
        const topic = String(parsed?.topic ?? "").trim().slice(0, 500);
        const providerId = modelRouting.meetingProviderId;
        const sys = `你是游戏工作室立项会记录员。根据用户的立项议题，只输出 6～12 行中文发言记录。

格式（必须严格遵守，方便程序解析）：
每一行一条，行首必须是以下四种职位之一 + 中文全角冒号「：」，冒号后接发言正文，同一行内不要换行。
秘书：
制作人：
技术总监：
创意总监：

禁止：JSON、markdown、标题、「第x条」编号、空行、角色名加括号。先秘书开场与议程，三位总监各至少一句、中间有简短呼应，最后秘书收束。口语化、专业、紧扣议题。`;
        const user = topic.length > 0 ? `立项议题：${topic}` : "立项议题未填写，请仍生成一轮讨论并提醒补充主题。";
        const llm = await chatCompletionNonStreaming(providerId, [
          { role: "system", content: sys },
          { role: "user", content: user }
        ]);
        if (!llm.ok) {
          json(res, 200, {
            ok: false,
            note: "meeting_llm_failed",
            providerId,
            error: llm.error,
            status: "status" in llm && typeof llm.status === "number" ? llm.status : null
          });
          return;
        }
        const lines = parseMeetingTranscriptAny(llm.text);
        if (!lines) {
          json(res, 200, {
            ok: false,
            note: "meeting_llm_parse_failed",
            providerId,
            preview: llm.text.slice(0, 400)
          });
          return;
        }
        json(res, 200, { ok: true, projectId: pid, providerId, lines });
        return;
      }

      if (url.pathname === "/api/settings" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { error: "bad_json" });
          return;
        }
        if (typeof parsed?.computeSlots === "number") {
          settings.computeSlots = Math.max(1, Math.min(8, Math.floor(parsed.computeSlots)));
        }
        if (typeof parsed?.autoOutsource === "boolean") {
          settings.autoOutsource = parsed.autoOutsource;
        }
        if (typeof parsed?.autoOutsourceFirstChunkMsThreshold === "number") {
          settings.autoOutsourceFirstChunkMsThreshold = Math.max(200, Math.min(10_000, Math.floor(parsed.autoOutsourceFirstChunkMsThreshold)));
        }
        stmt.settingSet.run("computeSlots", String(settings.computeSlots));
        stmt.settingSet.run("autoOutsource", String(settings.autoOutsource));
        stmt.settingSet.run("autoOutsourceFirstChunkMsThreshold", String(settings.autoOutsourceFirstChunkMsThreshold));
        json(res, 200, { settings });
        void pumpQueue();
        return;
      }

      if (url.pathname === "/api/providers" && req.method === "GET") {
        // Do not return apiKey to clients
        const safeConfig = {
          local: { baseUrl: providerConfig.local.baseUrl, model: providerConfig.local.model, hasApiKey: Boolean(providerConfig.local.apiKey), pricing: providerConfig.local.pricing },
          cloud: { baseUrl: providerConfig.cloud.baseUrl, model: providerConfig.cloud.model, hasApiKey: Boolean(providerConfig.cloud.apiKey), pricing: providerConfig.cloud.pricing }
        };
        json(res, 200, { providers: getProviders(), config: safeConfig, agentProvider: Object.fromEntries(agentProvider.entries()) });
        return;
      }

      if (url.pathname === "/api/providers/config" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const next = parsed?.config;
        if (next?.local?.baseUrl) providerConfig.local.baseUrl = String(next.local.baseUrl);
        if (next?.local?.model) providerConfig.local.model = String(next.local.model);
        if (typeof next?.local?.apiKey === "string") {
          const k = String(next.local.apiKey).trim();
          if (k) providerConfig.local.apiKey = k;
        }
        if (next?.cloud?.baseUrl) providerConfig.cloud.baseUrl = String(next.cloud.baseUrl);
        if (next?.cloud?.model) providerConfig.cloud.model = String(next.cloud.model);
        if (typeof next?.cloud?.apiKey === "string") {
          const k = String(next.cloud.apiKey).trim();
          if (k) providerConfig.cloud.apiKey = k;
        }
        if (typeof next?.cloud?.pricing?.inputPer1k === "number") providerConfig.cloud.pricing = { ...(providerConfig.cloud.pricing ?? {}), inputPer1k: next.cloud.pricing.inputPer1k };
        if (typeof next?.cloud?.pricing?.outputPer1k === "number") providerConfig.cloud.pricing = { ...(providerConfig.cloud.pricing ?? {}), outputPer1k: next.cloud.pricing.outputPer1k };
        syncCloudModelIfSameBaseAsLocal();
        const safeConfig = {
          local: { baseUrl: providerConfig.local.baseUrl, model: providerConfig.local.model, hasApiKey: Boolean(providerConfig.local.apiKey), pricing: providerConfig.local.pricing },
          cloud: { baseUrl: providerConfig.cloud.baseUrl, model: providerConfig.cloud.model, hasApiKey: Boolean(providerConfig.cloud.apiKey), pricing: providerConfig.cloud.pricing }
        };
        try {
          await saveStudioProvidersToDisk();
        } catch {
          /* 仍返回成功，避免丢配置仅因写盘失败 */
        }
        json(res, 200, { ok: true, providers: getProviders(), config: safeConfig });
        return;
      }

      if (url.pathname === "/api/ollama/status" && req.method === "GET") {
        // Check whether `ollama` exists and whether local baseURL responds.
        let hasCli = false;
        try {
          const v = await execFileText("ollama", ["--version"], 2000);
          hasCli = Boolean(v);
        } catch {
          hasCli = false;
        }
        const local = getProviders().find((p) => p.id === "local");
        const check = local ? await checkProvider(local) : { ok: false, error: "missing_local_provider" };
        json(res, 200, { ok: true, hasCli, localCheck: check });
        return;
      }

      if (url.pathname === "/api/ollama/start" && req.method === "POST") {
        if (process.platform !== "win32") {
          json(res, 200, { ok: false, note: "only_win32_mvp" });
          return;
        }
        try {
          // Best-effort start (returns immediately). If already running, it may exit quickly.
          const child = spawn("ollama", ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
          child.unref();
          json(res, 200, { ok: true });
        } catch (e) {
          json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (url.pathname === "/api/providers/test" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const providerId = String(parsed?.providerId ?? "");
        const providers = getProviders();
        const baseUrlOverride = typeof parsed?.baseUrl === "string" ? String(parsed.baseUrl) : undefined;
        const modelOverride = typeof parsed?.model === "string" ? String(parsed.model) : undefined;
        const apiKeyOverride = typeof parsed?.apiKey === "string" ? String(parsed.apiKey) : undefined;

        const p0 = providers.find((x) => x.id === providerId);
        const p = p0
          ? {
              ...p0,
              baseUrl: (baseUrlOverride ?? p0.baseUrl).trim(),
              model: (modelOverride ?? p0.model).trim()
            }
          : undefined;
        if (!p) {
          json(res, 400, { ok: false, error: "unknown_provider" });
          return;
        }
        if (!p.baseUrl || !p.model || !p.capabilities.includes("text")) {
          json(res, 200, { ok: false, note: "provider_not_configured_or_not_text", providerId });
          return;
        }
        const prevKey = providerConfig[p.id as "local" | "cloud"]?.apiKey;
        try {
          if ((p.id === "local" || p.id === "cloud") && apiKeyOverride) providerConfig[p.id].apiKey = apiKeyOverride;
          const r = await benchProviderConnectivity(p);
          if (!(r as any).ok) {
            json(res, 200, {
              ok: false,
              providerId,
              note: (r as any).note ?? (r as any).hint ?? "upstream_not_streaming_or_model_not_chat",
              upstreamStatus: (r as any).upstreamStatus ?? null,
              upstreamDetail: typeof (r as any).upstreamDetail === "string" ? (r as any).upstreamDetail : undefined
            });
          } else {
            json(res, 200, {
              ok: true,
              providerId,
              firstChunkMs: (r as any).firstChunkMs ?? null,
              sampleChars: (r as any).sampleChars ?? null,
              note: typeof (r as any).note === "string" ? (r as any).note : undefined
            });
          }
        } catch (e) {
          json(res, 200, { ok: false, providerId, error: e instanceof Error ? e.message : String(e) });
        } finally {
          if (p.id === "local" || p.id === "cloud") providerConfig[p.id].apiKey = prevKey;
        }
        return;
      }

      if (url.pathname === "/api/providers/models" && req.method === "GET") {
        const providerId = String(url.searchParams.get("providerId") ?? "");
        const providers = getProviders();
        const p = providers.find((x) => x.id === providerId);
        if (!p) {
          json(res, 400, { ok: false, error: "unknown_provider" });
          return;
        }
        if (!p.baseUrl) {
          json(res, 200, { ok: false, note: "provider_baseurl_empty", providerId });
          return;
        }
        try {
          const u = new URL("models", p.baseUrl.endsWith("/") ? p.baseUrl : p.baseUrl + "/");
          const apiKey = providerConfig[p.id as "local" | "cloud"]?.apiKey;
          const r = await fetch(u, { method: "GET", headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) } });
          const txt = await r.text();
          if (!r.ok) {
            json(res, 200, { ok: false, providerId, status: r.status, body: txt.slice(0, 2000) });
            return;
          }
          let parsed: any;
          try {
            parsed = JSON.parse(txt);
          } catch {
            json(res, 200, { ok: false, providerId, note: "bad_json", body: txt.slice(0, 2000) });
            return;
          }
          const models = Array.isArray(parsed?.data) ? parsed.data.map((m: any) => String(m?.id ?? "")).filter(Boolean) : [];
          json(res, 200, { ok: true, providerId, models: models.slice(0, 200) });
        } catch (e) {
          json(res, 200, { ok: false, providerId, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (url.pathname === "/api/providers/bind" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { error: "bad_json" });
          return;
        }
        const agentId = String(parsed?.agentId ?? "");
        const providerId = String(parsed?.providerId ?? "");
        if (!agentId || !providerId) {
          json(res, 400, { error: "missing_agent_or_provider" });
          return;
        }
        const providers = getProviders();
        if (!providers.some((p) => p.id === providerId)) {
          json(res, 400, { error: "unknown_provider" });
          return;
        }
        agentProvider.set(agentId, providerId);
        json(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/api/system/profile" && req.method === "GET") {
        const memGB = gb(os.totalmem());
        const cpuModel = os.cpus()?.[0]?.model;
        const platform = process.platform;
        const osName = process.platform === "win32" ? "Windows" : platform;
        const gpu = await getWinGpuInfo();
        json(res, 200, {
          ok: true,
          platform,
          osName,
          memGB,
          cpuModel,
          gpuName: gpu?.gpuName,
          vramGB: gpu?.vramGB
        });
        return;
      }

      if (url.pathname === "/api/bench/sweep" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any = {};
        try {
          parsed = bodyRaw ? JSON.parse(bodyRaw) : {};
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const providerId = typeof parsed?.providerId === "string" ? parsed.providerId : "local";
        const providers = getProviders();
        const p = providers.find((x) => x.id === providerId) ?? providers[0];
        const levels: any[] = Array.isArray(parsed?.concurrencyLevels) ? parsed.concurrencyLevels : [1, 2, 3];
        const uniq = Array.from(
          new Set<number>(levels.map((n: any) => Math.max(1, Math.min(6, Math.floor(Number(n) || 1)))))
        ).sort((a: number, b: number) => a - b);
        const results: any[] = [];
        for (const c of uniq) {
          // Simulate concurrency by firing c bench calls in parallel and taking p50-like quick summary.
          const started = Date.now();
          const runs = await Promise.all(
            Array.from({ length: c }).map(async () => {
              try {
                return await benchOnce(p);
              } catch (e) {
                return { ok: false, error: e instanceof Error ? e.message : String(e) };
              }
            })
          );
          const okRuns = runs.filter((r: any) => r.ok && typeof r.firstChunkMs === "number");
          const firsts = okRuns.map((r: any) => r.firstChunkMs as number).sort((a: number, b: number) => a - b);
          const mid = firsts.length ? firsts[Math.floor(firsts.length / 2)] : null;
          const chars = okRuns.reduce((acc: number, r: any) => acc + (typeof r.sampleChars === "number" ? r.sampleChars : 0), 0);
          results.push({
            concurrency: c,
            ok: okRuns.length > 0,
            firstChunkMs: mid,
            sampleChars: chars,
            elapsedMs: Date.now() - started
          });
          // Avoid hammering upstream
          if (Date.now() - started > 0) await new Promise((r) => setTimeout(r, 150));
        }
        json(res, 200, { ok: true, providerId: p.id, results });
        return;
      }

      // ======== OA 工作流 API ========
      if (url.pathname === "/api/workflow/templates" && req.method === "GET") {
        json(res, 200, { ok: true, templates: BUILTIN_TEMPLATES });
        return;
      }
      if (url.pathname === "/api/workflow/runs" && req.method === "GET") {
        const runs = Array.from(workflowRuns.values()).map((r) => ({
          id: r.id, templateId: r.templateId, projectId: r.projectId,
          status: r.status, currentStep: r.currentStep, startedAt: r.startedAt,
          completedAt: r.completedAt, totalSteps: r.steps.length,
          steps: r.steps.map((s) => ({ id: s.id, agentId: s.agentId, task: s.task, dept: s.dept, status: s.status, jobId: s.jobId }))
        }));
        json(res, 200, { ok: true, runs });
        return;
      }
      if (url.pathname === "/api/workflow/runs" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try { parsed = JSON.parse(bodyRaw); } catch { json(res, 400, { ok: false, error: "bad_json" }); return; }
        const templateId = String(parsed?.templateId ?? "");
        const projectId = String(parsed?.projectId ?? currentProjectId);
        const run = launchWorkflow(templateId, projectId);
        if (!run) { json(res, 404, { ok: false, error: "template_not_found" }); return; }
        json(res, 200, { ok: true, run: { id: run.id, templateId, projectId, status: run.status, steps: run.steps.length } });
        return;
      }
      if (url.pathname === "/api/workflow/runs/approve" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try { parsed = JSON.parse(bodyRaw); } catch { json(res, 400, { ok: false, error: "bad_json" }); return; }
        const runId = String(parsed?.runId ?? "");
        const stepId = String(parsed?.stepId ?? "");
        const approve = parsed?.approve === true;
        const run = workflowRuns.get(runId);
        if (!run) { json(res, 404, { ok: false, error: "run_not_found" }); return; }
        const step = run.steps.find((s) => s.id === stepId);
        if (!step) { json(res, 404, { ok: false, error: "step_not_found" }); return; }
        if (!step.approvalNeeded) { json(res, 400, { ok: false, error: "step_does_not_require_approval" }); return; }
        step.status = approve ? "approved" : "rejected";
        step.completedAt = nowIso();
        broadcast({ type: "workflow.step_completed" as any, agentId: step.agentId, payload: { runId, stepId, success: approve }, ts: nowIso() });
        if (run.type === "serial") {
          run.currentStep += 1;
          if (run.currentStep >= run.steps.length) {
            run.status = "completed"; run.completedAt = nowIso();
            broadcast({ type: "workflow.completed" as any, agentId: "", payload: { runId, status: "completed" }, ts: nowIso() });
          } else { void advanceWorkflow(run); }
        }
        json(res, 200, { ok: true, runId, stepId, approved: approve });
        return;
      }

      // 自定义模板保存（编排器）
      if (url.pathname === "/api/workflow/templates/save" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try { parsed = JSON.parse(bodyRaw); } catch { json(res, 400, { ok: false, error: "bad_json" }); return; }
        const tpl = parsed?.template;
        if (!tpl?.name || !Array.isArray(tpl?.steps)) { json(res, 400, { ok: false, error: "invalid_template" }); return; }
        const id = `wf_custom_${Date.now()}`;
        const customTpl: WorkflowTemplate = { id, name: tpl.name, type: tpl.type ?? "serial", steps: tpl.steps, createdAt: nowIso() };
        stmt.workflowUpsert.run(id, tpl.name, JSON.stringify(tpl.steps), nowIso());
        json(res, 200, { ok: true, templateId: id });
        return;
      }

      // 自定义模板直接执行
      if (url.pathname === "/api/workflow/runs/custom" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try { parsed = JSON.parse(bodyRaw); } catch { json(res, 400, { ok: false, error: "bad_json" }); return; }
        const tpl = parsed?.template;
        if (!tpl?.name || !Array.isArray(tpl?.steps)) { json(res, 400, { ok: false, error: "invalid_template" }); return; }
        const id = `wf_custom_run_${Date.now()}`;
        const run: WorkflowRun = {
          id, templateId: id, projectId: String(parsed?.projectId ?? currentProjectId),
          steps: tpl.steps.map((s: any) => ({ id: s.id, agentId: s.agentId, task: s.task, dept: s.dept ?? "programming", priority: s.priority ?? 0, approvalNeeded: s.approvalNeeded ?? false, timeoutMinutes: s.timeoutMinutes ?? 20, status: "pending" as const })),
          currentStep: 0, status: "active", type: tpl.type ?? "serial",
          startedAt: nowIso(), completedAt: null
        };
        workflowRuns.set(run.id, run);
        broadcast({ type: "workflow.launched" as any, agentId: "", payload: { runId: run.id, templateId: id, projectId: run.projectId, steps: run.steps.length }, ts: nowIso() });
        void advanceWorkflow(run);
        json(res, 200, { ok: true, run: { id: run.id, steps: run.steps.length, status: run.status } });
        return;
      }

      if (url.pathname === "/api/advice" && req.method === "GET") {
        const memGB = gb(os.totalmem());
        const gpu = await getWinGpuInfo();
        const vramGB = gpu?.vramGB;
        const providers = getProviders();
        const localP = providers.find((p) => p.id === "local") ?? providers[0];
        const cloudP = providers.find((p) => p.id === "cloud") ?? providers[0];

        const localCheck = await checkProvider(localP);
        const cloudCheck = await checkProvider(cloudP);
        let localBench: any = null;
        try {
          localBench = await benchOnce(localP);
        } catch {
          localBench = { ok: false };
        }

        const snap = await getAdviceSnapshot();
        const localModelsSuggested = recommendLocalModels(vramGB, memGB);

        json(res, 200, {
          ok: true,
          recommendedProviderId: snap.recommendedProviderId,
          recommendedComputeSlots: snap.recommendedComputeSlots,
          grade: snap.grade,
          localAgentCap: snap.localAgentCap,
          notes: snap.notes,
          localModelsSuggested,
          observed: {
            memGB,
            gpuName: gpu?.gpuName,
            vramGB,
            local: { check: localCheck, bench: localBench },
            cloud: { check: cloudCheck }
          }
        });
        return;
      }

      if (url.pathname === "/api/hire" && req.method === "GET") {
        json(res, 200, { hired: Array.from(hired.values()).sort() });
        return;
      }

      if (url.pathname === "/api/hire/sync_all" && req.method === "POST") {
        const agents = await listAgents(env.repoRoot);
        hired.clear();
        for (const a of agents) hired.add(a.id);
        void persistHiredToDisk();
        json(res, 200, { ok: true, hired: Array.from(hired.values()).sort() });
        return;
      }

      if (url.pathname === "/api/hire" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { error: "bad_json" });
          return;
        }
        const agentId = String(parsed?.agentId ?? "");
        const on = Boolean(parsed?.hired);
        if (agentId) {
          if (on) hired.add(agentId);
          else hired.delete(agentId);
        }
        void persistHiredToDisk();
        json(res, 200, { hired: Array.from(hired.values()).sort() });
        return;
      }

      if (url.pathname === "/api/queue" && req.method === "GET") {
        json(res, 200, { queue, running: Array.from(running.values()) });
        return;
      }

      if (url.pathname === "/api/dept/workorder/action" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        const deptId = String(parsed?.deptId ?? "programming");
        const action = String(parsed?.action ?? "");
        const agentId = String(parsed?.agentId ?? "producer");
        const projectId = String(parsed?.projectId ?? currentProjectId).replace(/[^a-zA-Z0-9_-]/g, "") || currentProjectId;
        const workgroupId = String(parsed?.workgroupId ?? projectId).replace(/[^a-zA-Z0-9_-]/g, "") || projectId;

        const previewPath = join(previewDir, projectId, "index.html");
        if (action === "approve" && policy.creativeDirector.gateOnNoPreview && !existsSync(previewPath)) {
          emit({
            v: 1,
            ts: nowIso(),
            type: "policy.decision",
            sessionId: serverSessionId,
            correlationId: newId("policy"),
            agentId,
            payload: { action: "gate_review", reason: "no_preview", deptId, projectId }
          });
          json(res, 400, { ok: false, error: "gate_no_preview", projectId });
          return;
        }

        const deptLabel: Record<string, string> = {
          leadership: "领导/制作",
          design: "策划/设计",
          programming: "程序/工程",
          art_audio: "美术/音频",
          narrative: "叙事/本地化",
          qa_release: "QA/发布/平台",
          other: "其他"
        };
        const prefix = `【部门工单：${deptLabel[deptId] ?? deptId}】【项目:${projectId}】`;
        const ac = policy.creativeDirector.requireAcceptanceCriteria ? "\n验收点：\n- （请列出 3-7 条可检查的验收点）" : "";
        const task =
          action === "approve"
            ? `${prefix} 通过当前产出。请总结本次结果、风险与下一步计划（中文，简短）。${ac}`
            : action === "reject"
              ? `${prefix} 驳回当前产出。请列出问题清单与修复步骤，然后重新产出并更新预览。${ac}`
              : `${prefix} 继续/重做。请先确认目标与验收点，再执行并更新预览。${ac}`;

        // Enqueue (reuse core checks from /api/queue/enqueue in a minimal way)
        const providers = getProviders();
        let providerId: string;
        let providerReason: string | undefined;
        if (agentProvider.has(agentId)) {
          providerId = agentProvider.get(agentId)!;
          providerReason = "agent_provider_override";
        } else {
          const picked = await pickQueueProviderId(agentId, { usage: "execution" });
          providerId = picked.providerId;
          providerReason = picked.providerReason;
        }
        const provider = providers.find((p) => p.id === providerId);
        if (!provider || !provider.capabilities.includes("text")) {
          json(res, 400, { ok: false, error: "provider_not_supported_for_text", providerId });
          return;
        }
        if (hired.size > 0 && !hired.has(agentId)) {
          json(res, 400, { ok: false, error: "agent_not_hired", agentId });
          return;
        }

        const snap = await getAdviceSnapshot();
        const projectLimit = snap.grade === "S" ? 3 : snap.grade === "A" ? 2 : 1;
        const activeProjectIds = new Set<string>();
        for (const j of queue) if (j.status === "queued" || j.status === "running") activeProjectIds.add(j.projectId);
        for (const j of running.values()) activeProjectIds.add(j.projectId);
        const isNewActive = !activeProjectIds.has(projectId);
        if (isNewActive && activeProjectIds.size >= projectLimit) {
          json(res, 400, { ok: false, error: "project_limit_reached", projectLimit, active: Array.from(activeProjectIds.values()) });
          return;
        }

        if (providerReason) {
          emit({
            v: 1,
            ts: nowIso(),
            type: "policy.decision",
            sessionId: serverSessionId,
            correlationId: newId("policy"),
            agentId,
            payload: { action: "select_provider", reason: providerReason, providerId, from: "policy" }
          });
        }

        const job: Job = {
          id: newId("job"),
          agentId,
          task,
          priority: 1,
          createdAt: nowIso(),
          providerId,
          projectId,
          workgroupId,
          status: "queued"
        };
        queue.push(job);
        emit({
          v: 1,
          ts: nowIso(),
          type: "job.enqueued",
          sessionId: serverSessionId,
          correlationId: job.id,
          agentId,
          payload: { jobId: job.id, task: job.task, priority: job.priority, projectId, workgroupId, deptId, action }
        });
        void pumpQueue();
        json(res, 200, { ok: true, job, providerReason, task });
        return;
      }

      if (url.pathname === "/api/queue/enqueue" && req.method === "POST") {
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { error: "bad_json" });
          return;
        }
        const agentId = String(parsed?.agentId ?? "");
        const task = String(parsed?.task ?? "");
        const priority = Number(parsed?.priority ?? 0);
        const autoSplit = Boolean(parsed?.autoSplit);
        const projectIdRaw = typeof parsed?.projectId === "string" ? parsed.projectId : currentProjectId;
        const projectId = (projectIdRaw || currentProjectId).replace(/[^a-zA-Z0-9_-]/g, "");
        const workgroupIdRaw = typeof parsed?.workgroupId === "string" ? parsed.workgroupId : projectId;
        const workgroupId = (workgroupIdRaw || projectId).replace(/[^a-zA-Z0-9_-]/g, "");
        let providerId: string;
        let providerReason: string | undefined;
        if (typeof parsed?.providerId === "string") {
          providerId = parsed.providerId;
        } else if (agentProvider.has(agentId)) {
          providerId = agentProvider.get(agentId)!;
          providerReason = "agent_provider_override";
        } else {
          const picked = await pickQueueProviderId(agentId, parsed);
          providerId = picked.providerId;
          providerReason = picked.providerReason;
        }
        const providers = getProviders();
        const provider = providers.find((p) => p.id === providerId);
        if (!provider) {
          json(res, 400, { error: "unknown_provider" });
          return;
        }
        if (!provider.capabilities.includes("text")) {
          json(res, 400, { error: "provider_not_supported_for_text", providerId });
          return;
        }
        if (!agentId || !task) {
          json(res, 400, { error: "missing_agent_or_task" });
          return;
        }
        if (hired.size > 0 && !hired.has(agentId)) {
          json(res, 400, { error: "agent_not_hired" });
          return;
        }

        const snap = await getAdviceSnapshot();
        const projectLimit = snap.grade === "S" ? 3 : snap.grade === "A" ? 2 : 1;
        const activeProjectIds = new Set<string>();
        for (const j of queue) if (j.status === "queued" || j.status === "running") activeProjectIds.add(j.projectId);
        for (const j of running.values()) activeProjectIds.add(j.projectId);
        const isNewActive = !activeProjectIds.has(projectId);
        if (isNewActive && activeProjectIds.size >= projectLimit) {
          emit({
            v: 1,
            ts: nowIso(),
            type: "policy.decision",
            sessionId: serverSessionId,
            correlationId: newId("policy"),
            agentId,
            payload: { action: "block_project_parallelism", reason: "project_limit", projectId, projectLimit, active: Array.from(activeProjectIds.values()) }
          });
          json(res, 400, { error: "project_limit_reached", projectLimit, active: Array.from(activeProjectIds.values()) });
          return;
        }
        if (providerReason) {
          emit({
            v: 1,
            ts: nowIso(),
            type: "policy.decision",
            sessionId: serverSessionId,
            correlationId: newId("policy"),
            agentId,
            payload: { action: "select_provider", reason: providerReason, providerId, from: parsed?.providerId ? "explicit" : "policy" }
          });
        }

        const mkJob = (t: string, i?: number, n?: number): Job => ({
          id: newId("job"),
          agentId,
          task: typeof i === "number" && typeof n === "number" ? `【子任务 ${i + 1}/${n}】${t}` : t,
          priority: Number.isFinite(priority) ? priority : 0,
          createdAt: nowIso(),
          providerId,
          projectId,
          workgroupId,
          status: "queued"
        });

        if (autoSplit && policy.producer.autoSplit) {
          const rawLines = task
            .split(/\r?\n/g)
            .map((s) => s.trim())
            .filter(Boolean);
          const maxN = Math.max(1, Math.min(policy.producer.maxSubtasks, 12));
          const lines = rawLines.length > 0 ? rawLines.slice(0, maxN) : [task];
          const jobs = lines.map((t, i) => mkJob(t, i, lines.length));
          for (const j of jobs) {
            queue.push(j);
            emit({
              v: 1,
              ts: nowIso(),
              type: "job.enqueued",
              sessionId: serverSessionId,
              correlationId: j.id,
              agentId,
              payload: { jobId: j.id, task: j.task, priority: j.priority, projectId, workgroupId }
            });
          }
          json(res, 200, { ok: true, jobs, providerReason, split: true });
          void pumpQueue();
          return;
        }

        const job = mkJob(task);
        queue.push(job);
        emit({
          v: 1,
          ts: nowIso(),
          type: "job.enqueued",
          sessionId: serverSessionId,
          correlationId: job.id,
          agentId,
          payload: { jobId: job.id, task: job.task, priority: job.priority, projectId, workgroupId }
        });
        json(res, 200, { ok: true, job, providerReason, split: false });
        void pumpQueue();
        return;
      }

      if (url.pathname === "/api/finance/summary" && req.method === "GET") {
        const range = String(url.searchParams.get("range") ?? "today");
        if (!existsSync(env.logPath)) {
          json(res, 200, {
            range,
            tokensEstimated: 0,
            requests: 0,
            cost: 0,
            failures: 0,
            failuresByReason: {},
            requestsByProvider: {}
          });
          return;
        }
        const raw = await readFile(env.logPath, "utf8");
        const lines = raw.trim().split("\n");
        const now = new Date();
        const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

        // Allow "reset today" without truncating the whole log: only count events after last finance.reset (same day).
        let lastResetTs: Date | null = null;
        for (const line of lines.slice(-5000)) {
          try {
            const ev = JSON.parse(line) as StudioEventEnvelope;
            const ts = new Date(ev.ts);
            if (range === "today" && !sameDay(ts, now)) continue;
            if (ev.type === "finance.reset") lastResetTs = ts;
          } catch {
            // ignore
          }
        }

        let chars = 0;
        let requests = 0;
        let failures = 0;
        const failuresByReason: Record<string, number> = {};
        const requestsByProvider: Record<string, number> = {};
        for (const line of lines.slice(-5000)) {
          try {
            const ev = JSON.parse(line) as StudioEventEnvelope;
            const ts = new Date(ev.ts);
            if (range === "today" && !sameDay(ts, now)) continue;
            if (lastResetTs && ts < lastResetTs) continue;
            if (ev.type === "llm.chunk" && typeof (ev as any).payload?.text === "string") chars += ((ev as any).payload.text as string).length;
            if (ev.type === "job.started") requests += 1;
            if (ev.type === "job.started") {
              const pid = String((ev as any).payload?.providerId ?? "");
              if (pid) requestsByProvider[pid] = (requestsByProvider[pid] ?? 0) + 1;
            }
            if (ev.type === "job.finished") {
              const ok = (ev as any).payload?.ok;
              if (ok === false) {
                failures += 1;
                const r = String((ev as any).payload?.failureReason ?? "unknown");
                failuresByReason[r] = (failuresByReason[r] ?? 0) + 1;
              }
            }
          } catch {
            // ignore
          }
        }
        const tokensEstimated = Math.floor(chars / 4); // rough: 4 chars ~ 1 token
        const providers = getProviders();
        const cloud = providers.find((p) => p.id === "cloud");
        const cost = cloud ? (tokensEstimated / 1000) * (cloud.pricing.outputPer1k || 0) : 0;
        json(res, 200, { range, tokensEstimated, requests, cost, failures, failuresByReason, requestsByProvider });
        return;
      }

      if (url.pathname === "/api/finance/reset" && req.method === "POST") {
        emit({
          v: 1,
          ts: nowIso(),
          type: "finance.reset",
          sessionId: serverSessionId,
          correlationId: `finance.reset.${Date.now()}`,
          payload: { range: "today" }
        });
        json(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/api/bench" && req.method === "POST") {
        // Minimal bench: call /chat/completions once and measure first-chunk latency.
        const startedAt = Date.now();
        const upstreamUrl = new URL("chat/completions", env.upstreamBaseUrl.endsWith("/") ? env.upstreamBaseUrl : env.upstreamBaseUrl + "/");
        const body = {
          model: process.env.STUDIO_MODEL ?? "llama3.2",
          stream: true,
          messages: [{ role: "user", content: "输出 10 个数字，用逗号分隔。" }]
        };
        try {
          const upstreamRes = await fetch(upstreamUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          const ct = upstreamRes.headers.get("content-type") ?? "";
          const isSse = ct.includes("text/event-stream");
          if (upstreamRes.ok && isSse && upstreamRes.body) {
            const reader = upstreamRes.body.getReader();
            const decoder = new TextDecoder();
            let firstChunkMs: number | null = null;
            let totalChars = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (firstChunkMs == null) firstChunkMs = Date.now() - startedAt;
              totalChars += decoder.decode(value, { stream: true }).length;
              if (Date.now() - startedAt > 2500) break;
            }
            json(res, 200, { ok: true, firstChunkMs, sampleChars: totalChars, hint: "用于粗略估算体感。下一步可扩展并发阶梯压测。" });
            return;
          }
          if (upstreamRes.ok) {
            const raw = await upstreamRes.text();
            const text = assistantTextFromChatCompletionJson(raw);
            if (text != null) {
              json(res, 200, {
                ok: true,
                firstChunkMs: Date.now() - startedAt,
                sampleChars: text.length,
                hint: "上游以 JSON 返回完整回复（非 SSE）。连通性正常。"
              });
              return;
            }
          }
          json(res, 200, { ok: false, note: "upstream_not_streaming", upstreamStatus: upstreamRes.status });
          return;
        } catch (e) {
          json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
          return;
        }
      }

      if (url.pathname === "/api/emit" && req.method === "POST") {
        const correlationId = newId("ui");
        const bodyRaw = await readBody(req);
        let parsed: any;
        try {
          parsed = JSON.parse(bodyRaw);
        } catch {
          json(res, 400, { error: "bad_json" });
          return;
        }

        const type = String(parsed?.type ?? "");
        const agentId = typeof parsed?.agentId === "string" ? parsed.agentId : pickAgentId(req);
        const payload = (parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {}) as Record<string, unknown>;

        const ev: StudioEventEnvelope = {
          v: 1,
          ts: nowIso(),
          type: type as any,
          sessionId: serverSessionId,
          correlationId,
          agentId,
          payload
        };
        broadcast(ev);
        json(res, 200, { ok: true });
        return;
      }

      if (url.pathname.startsWith("/v1/")) {
        const correlationId = newId("corr");
        const agentId = pickAgentId(req);
        const task = (() => {
          const v = req.headers["x-studio-task"];
          if (!v) return undefined;
          return Array.isArray(v) ? v[0] : v;
        })();

        if (agentId && task) {
          const assignEv: StudioEventEnvelope<"agent.assign"> = {
            v: 1,
            ts: nowIso(),
            type: "agent.assign",
            sessionId: serverSessionId,
            correlationId,
            agentId,
            payload: { task }
          };
          broadcast(assignEv);
        }

        const upstreamUrl = new URL(url.pathname + url.search, env.upstreamBaseUrl.endsWith("/") ? env.upstreamBaseUrl : env.upstreamBaseUrl + "/");
        const method = req.method ?? "GET";
        const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);

        if (process.env.STUDIO_DEBUG_PROXY_HEADERS === "1") {
          console.warn("[studio proxy]", upstreamUrl.toString(), redactHeadersForDebug(forwardHeaders(req)));
        }

        const upstreamRes = await fetch(upstreamUrl, {
          method,
          headers: {
            ...forwardHeaders(req),
            ...(body ? { "content-type": req.headers["content-type"] ?? "application/json" } : {})
          },
          body: body ? body : undefined
        });

        res.statusCode = upstreamRes.status;
        upstreamRes.headers.forEach((v, k) => {
          if (k.toLowerCase() === "transfer-encoding") return;
          res.setHeader(k, v);
        });

        const ct = upstreamRes.headers.get("content-type") ?? "";
        const isSse = ct.includes("text/event-stream");

        if (!isSse) {
          const buf = Buffer.from(await upstreamRes.arrayBuffer());
          res.end(buf);
          return;
        }

        // Stream SSE to client while logging chunks.
        const decoder = new TextDecoder();
        let buffered = "";
        const activeTools = new Set<string>();

        const emitChunk = (text: string, raw?: unknown) => {
          const ev: StudioEventEnvelope<"llm.chunk"> = {
            v: 1,
            ts: nowIso(),
            type: "llm.chunk",
            sessionId: serverSessionId,
            correlationId,
            agentId,
            payload: { text, raw }
          };
          broadcast(ev);
        };

        const emitToolStart = (tool: string, toolCallId?: string) => {
          const key = toolCallId ? `${toolCallId}:${tool}` : tool;
          if (activeTools.has(key)) return;
          activeTools.add(key);
          const ev: StudioEventEnvelope<"tool.start"> = {
            v: 1,
            ts: nowIso(),
            type: "tool.start",
            sessionId: serverSessionId,
            correlationId,
            agentId,
            payload: { tool, toolCallId }
          };
          broadcast(ev);
        };

        const emitToolEndAll = (ok: boolean) => {
          for (const key of activeTools) {
            const [toolCallId, tool] = key.includes(":") ? (key.split(":") as [string, string]) : [undefined as unknown as string, key];
            const ev: StudioEventEnvelope<"tool.end"> = {
              v: 1,
              ts: nowIso(),
              type: "tool.end",
              sessionId: serverSessionId,
              correlationId,
              agentId,
              payload: { tool, toolCallId, ok }
            };
            broadcast(ev);
          }
          activeTools.clear();
        };

        const emitDone = () => {
          const ev: StudioEventEnvelope<"llm.message_done"> = {
            v: 1,
            ts: nowIso(),
            type: "llm.message_done",
            sessionId: serverSessionId,
            correlationId,
            agentId,
            payload: {}
          };
          broadcast(ev);
        };

        res.setHeader("cache-control", "no-cache");

        const reader = upstreamRes.body?.getReader();
        if (!reader) {
          res.end();
          emitToolEndAll(true);
          emitDone();
          return;
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkText = decoder.decode(value, { stream: true });
          res.write(chunkText);

          buffered += chunkText;
          const parts = buffered.split("\n");
          buffered = parts.pop() ?? "";

          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice("data:".length).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              emitToolEndAll(true);
              emitDone();
              continue;
            }
            try {
              const obj = JSON.parse(data) as any;
              const delta = obj?.choices?.[0]?.delta;
              const content = delta?.content;
              if (typeof content === "string" && content.length > 0) emitChunk(content, obj);

              const toolCalls = delta?.tool_calls;
              if (Array.isArray(toolCalls)) {
                for (const tc of toolCalls) {
                  const name = tc?.function?.name;
                  const id = tc?.id;
                  if (typeof name === "string" && name) emitToolStart(name, typeof id === "string" ? id : undefined);
                }
              }
            } catch {
              // ignore parse errors; still forward to client
            }
          }
        }

        res.end();
        emitToolEndAll(true);
        emitDone();
        return;
      }

      json(res, 404, { error: "not_found" });
    } catch (e) {
      json(res, 500, { error: "internal_error", message: e instanceof Error ? e.message : String(e) });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? env.host}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: import("ws").WebSocket) => wss.emit("connection", ws, req));
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(env.port, env.host, () => resolvePromise());
  });

  // eslint-disable-next-line no-console
  console.log(`[studio-server] listening on http://${env.host}:${env.port}`);
  // eslint-disable-next-line no-console
  console.log(`[studio-server] ws on ws://${env.host}:${env.port}/ws`);
  // eslint-disable-next-line no-console
  console.log(`[studio-server] log at ${env.logPath}`);
}

void main();
