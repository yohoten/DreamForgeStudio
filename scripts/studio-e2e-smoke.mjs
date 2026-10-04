#!/usr/bin/env node
/**
 * Studio 联调自动化冒烟：不调用上游 LLM，仅校验 API 与静态资源。
 * 用法：在仓库根目录 `npm run check:studio-e2e`
 * 环境：STUDIO_BASE=http://127.0.0.1:8787  STUDIO_WEB=http://127.0.0.1:5173
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.STUDIO_BASE ?? "http://127.0.0.1:8787";
const WEB = process.env.STUDIO_WEB ?? "http://127.0.0.1:5173";
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

async function getJson(path) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`[OK]   ${msg}`);
}

async function main() {
  const checks = [];

  // healthz
  {
    const r = await getJson("/healthz");
    if (!r.ok || r.body?.ok !== true) {
      checks.push(() => fail(`/healthz: status=${r.status} body=${JSON.stringify(r.body)}`));
    } else pass("GET /healthz → ok:true");
  }

  const jsonPaths = [
    "/api/projects",
    "/api/agents",
    "/api/settings",
    "/api/policy",
    "/api/model-routing",
    "/api/charter",
    "/api/charter/history",
    "/api/charter/changes",
    "/api/providers",
    "/api/hire",
    "/api/queue",
    "/api/finance/summary",
    "/api/advice",
    "/api/system/profile"
  ];

  for (const p of jsonPaths) {
    const r = await getJson(p);
    if (!r.ok) {
      checks.push(() => fail(`${p}: HTTP ${r.status}`));
    } else pass(`GET ${p} → ${r.status}`);
  }

  // preview HTML (server)
  {
    const r = await getJson("/preview");
    if (!r.ok) checks.push(() => fail(`/preview: HTTP ${r.status}`));
    else pass("GET /preview → HTML");
  }

  // Vite
  {
    const r = await getJson(WEB);
    if (!r.ok) checks.push(() => fail(`Web ${WEB}: HTTP ${r.status}`));
    else pass(`GET ${WEB} → ${r.status}`);
  }

  // M1 static file on disk
  const m1 = join(repoRoot, "production", "preview", "project_1", "index.html");
  if (!existsSync(m1)) {
    checks.push(() => fail(`missing ${m1}`));
  } else pass(`file production/preview/project_1/index.html exists`);

  // enqueue smoke: only if agents exist and hired empty (optional quick job — skip LLM by not running pump? Actually enqueue adds job and pump runs - would call LLM)
  // Skip automatic enqueue to avoid cost; document manual step.

  for (const c of checks) c();

  if (process.exitCode === 1) {
    console.error("\n提示：请先在本仓库根目录执行 `npm run dev`，再运行本脚本。");
  } else {
    console.log("\n自动化部分通过。需浏览器手测：设置里本地/互联网「测试」、会议室、章程、招聘、队列入队与 LLM 任务。");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
