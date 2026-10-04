import "./style.css";

// 认证检查
(function checkAuth() {
  const token = localStorage.getItem("studio_token");
  if (!token && !window.location.pathname.includes("auth.html")) {
    window.location.href = "/auth.html";
    return;
  }
  if (token) {
    const uname = localStorage.getItem("studio_username") ?? "用户";
    const sname = localStorage.getItem("studio_name") ?? "";
    document.addEventListener("DOMContentLoaded", () => {
      const tel = document.getElementById("tbProject");
      if (tel && sname) tel.textContent = `🏭 ${sname}`;
      const tName = document.getElementById("tbUser");
      if (tName) tName.textContent = `👤 ${uname}`;
      // 登出按钮（带确认提示）
      const lbtn = document.getElementById("btnLogout");
      if (lbtn) lbtn.onclick = () => {
        // 移除旧确认框
        const old = document.getElementById("logoutConfirm");
        if (old) { old.remove(); return; }
        const toast = document.createElement("div");
        toast.id = "logoutConfirm";
        toast.className = "toast warn";
        toast.style.cssText = "animation:none;pointer-events:auto;display:flex;align-items:center;gap:8px;max-width:280px";
        toast.innerHTML = `<span style="flex:1">确认登出「${uname}」？</span><button id="logoutYes" class="segBtn" style="font-size:10px;padding:2px 10px;border-color:rgba(239,68,68,0.4);color:#f87171">确认</button><button id="logoutNo" class="segBtn" style="font-size:10px;padding:2px 10px">取消</button>`;
        const container = document.getElementById("toastContainer") ?? (() => { const c = document.createElement("div"); c.id = "toastContainer"; c.className = "toastContainer"; document.body.appendChild(c); return c; })();
        container.appendChild(toast);
        document.getElementById("logoutYes")!.onclick = () => {
          toast.remove();
          const base = getStudioBase().http;
          fetch(`${base}/api/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).finally(() => {
            localStorage.removeItem("studio_token");
            localStorage.removeItem("studio_username");
            localStorage.removeItem("studio_name");
            window.location.href = "/auth.html";
          });
        };
        document.getElementById("logoutNo")!.onclick = () => toast.remove();
      };
    });
  }
})();

import Phaser from "phaser";

import type { StudioAgentState, StudioEventEnvelope, StudioState } from "@aigongfang/shared/studio-events";
import { reduceState } from "@aigongfang/shared/studio-events";

// --- 背景浮动粒子 ---
function initParticles() {
  const container = document.getElementById("particleContainer");
  if (!container || container.childElementCount > 0) return;
  const colors = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b"];
  for (let i = 0; i < 30; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    const size = 1.5 + Math.random() * 2.5;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = `${15 + Math.random() * 20}s`;
    p.style.animationDelay = `${Math.random() * 15}s`;
    p.style.boxShadow = `0 0 ${size + 1}px ${p.style.background}`;
    container.appendChild(p);
  }
}

// 立即执行
initParticles();

// --- Isometric (Kairo-like) projection config (32px-ish look) ---
const ISO = {
  tileW: 64,
  tileH: 32,
  originX: 140,
  originY: 140
};

function getStudioBase(): { http: string; ws: string } {
  const url = new URL(window.location.href);
  const studio = url.searchParams.get("studio");
  const host = studio ?? window.location.hostname;
  const http = `http://${host}:8787`;
  const ws = `ws://${host}:8787/ws`;
  return { http, ws };
}

type Desk = {
  agentId: string;
  x: number;
  y: number;
  gx: number;
  gy: number;
  status: string;
  label: Phaser.GameObjects.Text;
  statusIcon: Phaser.GameObjects.Image;
  statusText: Phaser.GameObjects.Text;
  avatar: Phaser.GameObjects.Image;
  desk: Phaser.GameObjects.Image;
  hit?: Phaser.GameObjects.Rectangle;
  baseX: number;
  baseY: number;
  /** 归属工位格（摸鱼区）；外出仅去公共设施，之后回此格 */
  homeGx: number;
  homeGy: number;
  /** 到此时间应开始走回工位 */
  breakReturnAfterAt?: number;
  /** 上次「出门摸鱼」出发时刻，用于拉长工位上发呆间隔 */
  lastBreakTripAt?: number;
  lastWanderAt?: number;
  moving?: boolean;
  bubble?: Phaser.GameObjects.Text;
  lastBubbleAt?: number;
  /** 站立 idle 呼吸；移动前必须停掉，否则会与位移 tween 抢 y 导致「瞬移」感 */
  idleBobTween?: Phaser.Tweens.Tween;
  bobPhaseMs?: number;
  /** 寻路可视化：头顶目标说明 */
  navHint?: Phaser.GameObjects.Text;
  /** 寻路可视化：地面路径折线（忽略其他占格，仅静态障碍） */
  navPathGfx?: Phaser.GameObjects.Graphics;
  /** 闲聊中，避免与其它逻辑抢头顶图 */
  inBanter?: boolean;
  /** 节流：未回工位任务提示 */
  lastOffDeskWarnAt?: number;
  /** 已预约的目标格（尚未走到），防止多人抢同一空位 */
  pendingGx?: number;
  pendingGy?: number;
};

/** 等距公共设施房间：未锁房间内地毯可走，容量用站位格统计 */
type IsoRoomDef = {
  id: string;
  title: string;
  locked: boolean;
  gx: number;
  gy: number;
  gw: number;
  gh: number;
  doorGx: number;
  doorGy: number;
  capacity: number;
  /** 未提供则不限部门；提供则仅这些部门可进入/被分配 */
  allowedDepts?: Dept[];
};

function isoToScreen(gx: number, gy: number) {
  const x = (gx - gy) * (ISO.tileW / 2) + ISO.originX;
  const y = (gx + gy) * (ISO.tileH / 2) + ISO.originY;
  return { x, y };
}

/** 地板格 gx∈[0,gw)、gy∈[0,gh) 的包络 + 对称外扩；避免等距左侧为负坐标时「左边拖不动、右边空拖一大截」 */
function getIsoGridPanBounds(gw: number, gh: number, padWorld: number) {
  const tw = ISO.tileW / 2;
  const th = ISO.tileH / 2;
  const minX = (0 - (gh - 1)) * tw + ISO.originX;
  const maxX = (gw - 1 - 0) * tw + ISO.originX;
  const minY = (0 + 0) * th + ISO.originY;
  const maxY = (gw - 1 + gh - 1) * th + ISO.originY;
  const edgeX = ISO.tileW;
  const edgeY = ISO.tileH * 4;
  const bx = minX - edgeX - padWorld;
  const by = minY - edgeY - padWorld;
  const bw = maxX - minX + 2 * edgeX + 2 * padWorld;
  const bh = maxY - minY + 2 * edgeY + 2 * padWorld;
  return { x: bx, y: by, width: bw, height: bh };
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function setText(elId: string, text: string) {
  const el = document.getElementById(elId);
  if (el) el.textContent = text;
}

function setSecretaryHud(text: string) {
  const el = document.getElementById("secretaryBannerText");
  if (el) el.textContent = text;
}

function normalizePreviewHtmlInput(raw: string): { html: string; hint?: string } {
  const src = String(raw ?? "");
  const trimmed = src.trim();
  if (!trimmed) return { html: "" };

  // Common paste: Markdown fenced code block
  const fence = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  if (fence?.[1]) return { html: fence[1].trim(), hint: "已自动去掉 ``` 代码块包裹" };

  // If user pasted an entire message, try to extract the first HTML document.
  const docStart = trimmed.search(/<!doctype\s+html|<html[\s>]/i);
  if (docStart > 0) {
    const extracted = trimmed.slice(docStart).trim();
    return { html: extracted, hint: "已从文本中提取 <html> 文档片段" };
  }
  return { html: trimmed };
}

function extractHtmlDocFromText(raw: string): string | null {
  const n = normalizePreviewHtmlInput(raw).html;
  if (!n) return null;
  const hasStart = /<!doctype\s+html/i.test(n) || /<html[\s>]/i.test(n);
  const hasEnd = /<\/html>/i.test(n);
  if (!hasStart || !hasEnd) return null;
  if (n.length < 200) return null;
  return n;
}

function appendLog(line: string) {
  const log = document.getElementById("log");
  if (!log) return;
  const div = document.createElement("div");
  div.className = "logLine";
  div.textContent = line;
  log.prepend(div);
  while (log.childElementCount > 60) log.removeChild(log.lastElementChild!);
  // 同步到动态卡片
  appendFeedCard("event", line, "");
}

/** 动态卡片系统 */
function appendFeedCard(kind: "start" | "done" | "fail" | "event", body: string, agent: string) {
  const feed = document.getElementById("feedCards");
  if (!feed) return;
  const cls = kind === "start" ? "fcStart" : kind === "done" ? "fcDone" : kind === "fail" ? "fcFail" : "fcEvent";
  const icon = kind === "start" ? "▶" : kind === "done" ? "✅" : kind === "fail" ? "❌" : "●";
  const card = document.createElement("div");
  card.className = `feedCard ${cls}`;
  card.innerHTML = `<div class="feedCardMeta"><span>${icon} ${agent}</span><span>${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div><div class="feedCardBody">${body}</div>`;
  card.title = body;
  card.onclick = () => { document.querySelector<HTMLButtonElement>('[data-hud-tab="log"]')?.click(); };
  feed.prepend(card);
  while (feed.childElementCount > 40) feed.removeChild(feed.lastElementChild!);
}

/** 确认弹窗 */
function showConfirm(title: string, body: string, onOk: () => void) {
  const overlay = document.createElement("div"); overlay.className = "confirmOverlay";
  overlay.innerHTML = `<div class="confirmBox">
    <div class="confirmTitle">${title}</div>
    <div class="confirmBody">${body}</div>
    <div class="confirmActions">
      <button class="menuBtn" id="confirmCancel">取消</button>
      <button class="btnWarn" id="confirmOk">确认</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#confirmCancel")?.addEventListener("click", () => overlay.remove());
  overlay.querySelector("#confirmOk")?.addEventListener("click", () => { overlay.remove(); onOk(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

/** Toast 通知 */
function showToast(message: string, kind: "success" | "error" | "warn" | "info" = "info") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toastContainer";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  toast.onclick = () => toast.remove();
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function qs<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

function setupDrawer() {
  const mask = qs<HTMLDivElement>("drawerMask");
  const drawer = qs<HTMLDivElement>("drawer");
  const closeBtn = qs<HTMLButtonElement>("drawerClose");
  const title = qs<HTMLDivElement>("drawerTitle");

  const setOpen = (open: boolean) => {
    mask.classList.toggle("hidden", !open);
    drawer.classList.toggle("hidden", !open);
    (window as any).__STUDIO_MODAL_OPEN__ = open;
  };

  const setSection = (key: string) => {
    const sections = Array.from(drawer.querySelectorAll<HTMLElement>(".drawerSection"));
    for (const s of sections) s.classList.toggle("isActive", s.id === `drawer_${key}`);
    title.textContent =
      key === "recruit"
        ? "招聘中心"
        : key === "settings"
          ? "设置"
          : key === "policy"
            ? "策略"
          : key === "meeting"
            ? "会议室"
          : key === "monitor"
            ? "显示器"
            : key === "dept"
              ? "部门看板"
          : key === "tasks"
            ? "队列"
            : key === "finance"
              ? "财务"
            : key === "notify"
              ? "通知"
              : key === "sandbox"
                ? "沙盘看板"
                : "管理";
    drawer.classList.toggle(
      "isCenter",
      key === "recruit" || key === "settings" || key === "policy" || key === "meeting" || key === "monitor" || key === "dept" || key === "sandbox"
    );
  };

  mask.addEventListener("click", () => setOpen(false));
  closeBtn.addEventListener("click", () => setOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    // 键盘快捷键：弹出/切换抽屉面板
    if (!(window as any).__STUDIO_MODAL_OPEN__) {
      const keyMap: Record<string, string> = {
        "m": "monitor",
        "s": "settings",
        "p": "policy",
        "h": "recruit",
        "q": "tasks",
        "f": "finance",
        "n": "notify",
        "d": "dept"
      };
      const target = keyMap[e.key.toLowerCase()];
      if (target) {
        e.preventDefault();
        setSection(target);
        setOpen(true);
      }
    }
  });

  const menu = document.getElementById("menuBar");
  if (menu) {
    menu.addEventListener("click", (e) => {
      const t = e.target as HTMLElement | null;
      const btn = t?.closest?.(".menuBtn") as HTMLElement | null;
      const key = btn?.getAttribute("data-open");
      if (!key) return;
      setSection(key);
      setOpen(true);
    });
  }

  // default
  setSection("recruit");
  setOpen(false);

  return { open: (key: string) => (setSection(key), setOpen(true)), close: () => setOpen(false) };
}

const Drawer = setupDrawer();

// HUD Tab 切换
(function setupHudTabs() {
  const tabs = document.querySelectorAll<HTMLButtonElement>("[data-hud-tab]");
  tabs.forEach((t) => {
    t.onclick = () => {
      const key = t.getAttribute("data-hud-tab")!;
      tabs.forEach((x) => x.classList.toggle("isActive", x === t));
      document.querySelectorAll<HTMLElement>(".hudTabContent").forEach((c) => c.classList.toggle("isActive", c.id === `hudTab_${key}`));
    };
  });
  const helpBtn = document.getElementById("hudHelpBtn");
  if (helpBtn) helpBtn.onclick = () => showShortcutPanel();
  document.addEventListener("keydown", (e) => { if (e.key === "F1") { e.preventDefault(); showShortcutPanel(); } });

function showShortcutPanel() {
  const old = document.getElementById("shortcutPanel");
  if (old) { old.remove(); return; }
  const panel = document.createElement("div");
  panel.id = "shortcutPanel";
  panel.className = "agentPopup";
  panel.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;min-width:320px;max-width:420px;pointer-events:auto";
  panel.innerHTML = `<div class="agentPopupTitle"><span>快捷键面板</span><span class="popupClose" onclick="this.parentElement.parentElement.remove()">&times;</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px;padding:8px">
      <div><kbd>M</kbd> 显示器</div><div><kbd>S</kbd> 设置</div>
      <div><kbd>P</kbd> 策略</div><div><kbd>H</kbd> 招聘</div>
      <div><kbd>Q</kbd> 队列</div><div><kbd>F</kbd> 财务</div>
      <div><kbd>N</kbd> 通知</div><div><kbd>D</kbd> 部门</div>
      <div><kbd>F1</kbd> 快捷键</div><div><kbd>Esc</kbd> 关闭面板</div>
      <div><kbd>滚轮</kbd> 缩放场景</div><div><kbd>拖拽</kbd> 移动场景</div>
      <div style="grid-column:1/-1;color:var(--muted);font-size:10px;margin-top:6px">右键Agent → 快速菜单 | Ctrl+点击 → 多选 | 小地图点击 → 跳转</div>
    </div>`;
  document.body.appendChild(panel);
  panel.addEventListener("mousedown", (ev) => ev.stopPropagation());
  const closeH = (ev: MouseEvent) => { if (!panel.contains(ev.target as Node)) { panel.remove(); window.removeEventListener("mousedown", closeH); } };
  window.addEventListener("mousedown", closeH);
}

  // 左侧面板折叠
  const collapseBtn = document.getElementById("hudCollapseBtn");
  const hud = document.getElementById("hud");
  if (collapseBtn && hud) {
    collapseBtn.onclick = () => {
      const collapsed = hud.classList.toggle("collapsed");
      collapseBtn.textContent = collapsed ? "»" : "«";
    };
  }
})();

// 全局状态栏刷新
function updateTopBar(projectName: string, activeCount: number, cost: string, online: boolean) {
  setText("tbProject", `📁 ${projectName}`);
  const acEl = document.getElementById("tbActive");
  if (acEl) acEl.textContent = `⚡${activeCount}`;
  setText("tbCost", cost ? `💰¥${cost}` : "💰-");
  const onEl = document.getElementById("tbOnline");
  if (onEl) onEl.textContent = online ? "🟢" : "🔴";
}

// 通知角标
let notifyCount = 0;
function bumpNotifyBadge(delta = 1) {
  notifyCount = Math.max(0, notifyCount + delta);
  const badge = document.getElementById("notifyBadge");
  if (badge) {
    badge.textContent = String(notifyCount);
    badge.classList.toggle("hidden", notifyCount <= 0);
  }
}

// 按钮 Loading 辅助
function setBtnLoading(btn: HTMLElement | null, loading: boolean) {
  if (!btn) return;
  btn.classList.toggle("isLoading", loading);
}

function setupPolicyUI(studioHttp: string) {
  const btn = document.getElementById("btnPolicy") as HTMLButtonElement | null;
  if (btn) btn.onclick = () => Drawer.open("policy");

  const out = document.getElementById("polOut") as HTMLDivElement | null;
  const saveBtn = document.getElementById("polSave") as HTMLButtonElement | null;
  const reloadBtn = document.getElementById("polReload") as HTMLButtonElement | null;

  const producerMode = document.getElementById("polProducerMode") as HTMLSelectElement | null;
  const producerSplit = document.getElementById("polProducerSplit") as HTMLInputElement | null;
  const producerDispatch = document.getElementById("polProducerDispatch") as HTMLInputElement | null;
  const producerMax = document.getElementById("polProducerMax") as HTMLInputElement | null;

  const techMode = document.getElementById("polTechMode") as HTMLSelectElement | null;
  const techOutsource = document.getElementById("polTechOutsource") as HTMLInputElement | null;
  const techPauseOnErrors = document.getElementById("polTechPauseOnErrors") as HTMLInputElement | null;
  const techFirstChunk = document.getElementById("polTechFirstChunk") as HTMLInputElement | null;

  const creativeMode = document.getElementById("polCreativeMode") as HTMLSelectElement | null;
  const creativeGatePreview = document.getElementById("polCreativeGatePreview") as HTMLInputElement | null;
  const creativeRequireAC = document.getElementById("polCreativeRequireAC") as HTMLInputElement | null;

  const applyToForm = (p: any) => {
    if (!p) return;
    if (producerMode) producerMode.value = String(p?.producer?.mode ?? "rules");
    if (producerSplit) producerSplit.checked = Boolean(p?.producer?.autoSplit);
    if (producerDispatch) producerDispatch.checked = Boolean(p?.producer?.autoDispatch);
    if (producerMax) producerMax.value = String(p?.producer?.maxSubtasks ?? 5);

    if (techMode) techMode.value = String(p?.technicalDirector?.mode ?? "rules");
    if (techOutsource) techOutsource.checked = Boolean(p?.technicalDirector?.autoOutsource);
    if (techPauseOnErrors) techPauseOnErrors.checked = Boolean(p?.technicalDirector?.pauseOnErrors);
    if (techFirstChunk) techFirstChunk.value = String(p?.technicalDirector?.firstChunkMsThreshold ?? 1800);

    if (creativeMode) creativeMode.value = String(p?.creativeDirector?.mode ?? "rules");
    if (creativeGatePreview) creativeGatePreview.checked = Boolean(p?.creativeDirector?.gateOnNoPreview);
    if (creativeRequireAC) creativeRequireAC.checked = Boolean(p?.creativeDirector?.requireAcceptanceCriteria);
  };

  const readFromForm = () => ({
    v: 1,
    producer: {
      mode: (producerMode?.value === "llm" ? "llm" : "rules") as "rules" | "llm",
      autoSplit: Boolean(producerSplit?.checked),
      autoDispatch: Boolean(producerDispatch?.checked),
      maxSubtasks: Number(producerMax?.value ?? 5)
    },
    technicalDirector: {
      mode: (techMode?.value === "llm" ? "llm" : "rules") as "rules" | "llm",
      autoOutsource: Boolean(techOutsource?.checked),
      firstChunkMsThreshold: Number(techFirstChunk?.value ?? 1800),
      pauseOnErrors: Boolean(techPauseOnErrors?.checked)
    },
    creativeDirector: {
      mode: (creativeMode?.value === "llm" ? "llm" : "rules") as "rules" | "llm",
      gateOnNoPreview: Boolean(creativeGatePreview?.checked),
      requireAcceptanceCriteria: Boolean(creativeRequireAC?.checked)
    }
  });

  const syncModelTier = (tier: string) => {
    document.querySelectorAll<HTMLInputElement>('input[name="modelTier"]').forEach((el) => {
      el.checked = el.value === tier;
    });
  };

  const load = async () => {
    const r = await fetch(`${studioHttp}/api/policy`).then((x) => x.json());
    applyToForm(r?.policy);
    if (out) out.textContent = r?.ok ? "已加载" : `加载失败：${r?.error ?? "未知原因"}`;
    try {
      const mr = await fetch(`${studioHttp}/api/model-routing`).then((x) => x.json());
      syncModelTier(String(mr?.modelRouting?.tier ?? "balance"));
    } catch {
      syncModelTier("balance");
    }
  };
  void load();

  const modelTierSave = document.getElementById("modelTierSave") as HTMLButtonElement | null;
  if (modelTierSave)
    modelTierSave.onclick = async () => {
      const sel = document.querySelector<HTMLInputElement>('input[name="modelTier"]:checked');
      const tier = sel?.value ?? "balance";
      const r = await fetch(`${studioHttp}/api/model-routing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier })
      }).then((x) => x.json());
      if (out) out.textContent = r?.ok ? "模型路由已保存" : `路由保存失败：${r?.error ?? ""}`;
    };

  if (reloadBtn) reloadBtn.onclick = () => void load();
  if (saveBtn)
    saveBtn.onclick = async () => {
      if (out) out.textContent = "保存中...";
      const r = await fetch(`${studioHttp}/api/policy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy: readFromForm() })
      }).then((x) => x.json());
      if (r?.ok) {
        applyToForm(r?.policy);
        if (out) out.textContent = "已保存并生效";
      } else {
        if (out) out.textContent = `保存失败：${r?.error ?? "未知原因"}`;
      }
    };
}

function setupMeetingUI(studioHttp: string) {
  (window as any).__STUDIO_OPEN_MEETING__ = () => Drawer.open("meeting");

  const projSel = document.getElementById("meetingProject") as HTMLSelectElement | null;
  const refreshBtn = document.getElementById("meetingRefreshCharter") as HTMLButtonElement | null;
  const topicEl = document.getElementById("meetingTopic") as HTMLInputElement | null;
  const adviceEl = document.getElementById("meetingAdvice") as HTMLDivElement | null;
  const startBtn = document.getElementById("meetingStart") as HTMLButtonElement | null;
  const approveBtn = document.getElementById("meetingApprove") as HTMLButtonElement | null;
  const goalEl = document.getElementById("charterGoal") as HTMLTextAreaElement | null;
  const milEl = document.getElementById("charterMilestones") as HTMLTextAreaElement | null;
  const nodesEl = document.getElementById("charterNodes") as HTMLTextAreaElement | null;
  const saveDraftBtn = document.getElementById("charterSaveDraft") as HTMLButtonElement | null;
  const archiveBtn = document.getElementById("charterArchive") as HTMLButtonElement | null;
  const charterOut = document.getElementById("charterOut") as HTMLDivElement | null;
  const charterActionOut = document.getElementById("charterActionOut") as HTMLDivElement | null;
  const changePending = document.getElementById("changePending") as HTMLDivElement | null;
  const changeClear = document.getElementById("changeClear") as HTMLButtonElement | null;
  const changeGoCharter = document.getElementById("changeGoCharter") as HTMLButtonElement | null;
  const meetingSkipLlm = document.getElementById("meetingSkipLlm") as HTMLInputElement | null;
  const meetingPingLlm = document.getElementById("meetingPingLlm") as HTMLButtonElement | null;
  const meetingPingOut = document.getElementById("meetingPingOut") as HTMLDivElement | null;
  const meetingAutoKickoff = document.getElementById("meetingAutoKickoff") as HTMLInputElement | null;

  const getPid = () => String(projSel?.value ?? "project_1").trim();

  let meetingPlaybackGen = 0;

  const appendMeetingLine = (container: HTMLDivElement, speaker: string, message: string) => {
    const line = document.createElement("div");
    line.className = "meetingLine";
    const meta = document.createElement("div");
    meta.className = "meetingMeta";
    const ts = document.createElement("span");
    ts.className = "meetingTs";
    const now = new Date();
    ts.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const who = document.createElement("strong");
    who.textContent = speaker;
    meta.appendChild(ts);
    meta.appendChild(who);
    const msgEl = document.createElement("div");
    msgEl.className = "meetingMsg";
    msgEl.textContent = message;
    line.appendChild(meta);
    line.appendChild(msgEl);
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
  };

  const loadProjects = async () => {
    if (!projSel) return;
    const r = await fetch(`${studioHttp}/api/projects`).then((x) => x.json());
    const list = Array.isArray(r?.projects) ? r.projects : [];
    const cur = String(r?.currentProjectId ?? "project_1");
    projSel.innerHTML = "";
    for (const p of list) {
      const opt = document.createElement("option");
      opt.value = String(p?.id ?? "");
      opt.textContent = `${String(p?.title ?? p.id)} (${p?.id})`;
      projSel.appendChild(opt);
    }
    projSel.value = cur;
  };

  const applyCharter = (data: any) => {
    if (goalEl) goalEl.value = String(data?.draft?.goal ?? "");
    if (milEl) milEl.value = Array.isArray(data?.draft?.milestones) ? data.draft.milestones.join("\n") : "";
    if (nodesEl) nodesEl.value = Array.isArray(data?.draft?.nodes) ? data.draft.nodes.join("\n") : "";
    if (charterOut && data?.archived)
      charterOut.textContent = `已归档 v${data.archived.version} @ ${data.archived.archivedAt ?? ""}`;
    else if (charterOut) charterOut.textContent = data?.archived ? "" : "尚无归档版本";
  };

  const refreshCharter = async () => {
    const pid = getPid();
    const r = await fetch(`${studioHttp}/api/charter?projectId=${encodeURIComponent(pid)}`).then((x) => x.json());
    if (r?.ok) applyCharter(r);
    const ch = await fetch(`${studioHttp}/api/charter/changes?projectId=${encodeURIComponent(pid)}`).then((x) => x.json());
    if (changePending) {
      if (ch?.pending?.kinds?.length)
        changePending.textContent = `待确认偏离：${ch.pending.kinds.join("，")}（累计 ${ch.pending.count ?? 0}）`;
      else changePending.textContent = "无待确认偏离";
    }
  };

  void loadProjects().then(() => refreshCharter());
  if (projSel) projSel.onchange = () => void refreshCharter();
  if (refreshBtn) refreshBtn.onclick = () => void refreshCharter();

  if (meetingPingLlm)
    meetingPingLlm.onclick = async () => {
      if (!meetingPingOut) return;
      meetingPingOut.textContent = "检测中（走当前策略里的会议提供方）…";
      try {
        const r = await fetch(`${studioHttp}/api/meeting/llm_ping`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}"
        }).then((x) => x.json());
        meetingPingOut.textContent = r?.ok
          ? `会议模型可用：${r.providerId} / 模型 ${r.model}，延迟约 ${r.latencyMs}ms。上游回复片段：${String(r.snippet ?? "").slice(0, 80)}`
          : `会议模型未接通：槽位 ${r.providerId}，模型 ${r?.model ?? "?"}，BaseURL ${String(r?.baseUrl ?? "").slice(0, 48)}… — ${r?.error ?? "unknown"}${r?.status != null ? ` (HTTP ${r.status})` : ""}`;
      } catch (e) {
        meetingPingOut.textContent = `检测失败：${e instanceof Error ? e.message : String(e)}`;
      }
    };

  const meetingTabs = document.querySelectorAll<HTMLButtonElement>("[data-meeting-tab]");
  const goMeetingTab = (tab: "kickoff" | "charter" | "change") => {
    meetingTabs.forEach((x) => x.classList.toggle("isActive", x.getAttribute("data-meeting-tab") === tab));
    document.querySelectorAll<HTMLElement>(".recruitTab").forEach((p) => {
      if (p.id.startsWith("meetingTab_")) p.classList.toggle("isActive", p.id === `meetingTab_${tab}`);
    });
  };

  meetingTabs.forEach((b) => {
    b.onclick = () => {
      const key = b.getAttribute("data-meeting-tab") as "kickoff" | "charter" | "change" | null;
      if (key) goMeetingTab(key);
    };
  });

  if (startBtn)
    startBtn.onclick = async () => {
      const skipLlm = Boolean(meetingSkipLlm?.checked);
      const topicRaw = String(topicEl?.value ?? "").trim();
      const topic = topicRaw.length > 0 ? topicRaw : "（待补充主题）";
      const topicShort = topic.length > 120 ? `${topic.slice(0, 120)}…` : topic;
      const pid = getPid();
      const prevBtnText = startBtn.textContent;
      startBtn.disabled = true;
      startBtn.textContent = skipLlm ? "生成中…" : "模型生成中…";
      await fetch(`${studioHttp}/api/meeting/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: pid, topic: topicRaw })
      });
      if (!adviceEl) {
        startBtn.disabled = false;
        startBtn.textContent = prevBtnText ?? "开始会议";
        return;
      }
      meetingPlaybackGen += 1;
      const gen = meetingPlaybackGen;
      adviceEl.className = "meetingTranscript cardBody";
      adviceEl.replaceChildren();

      const loadingEl = document.createElement("div");
      loadingEl.className = "meetingMsg";
      loadingEl.style.opacity = "0.78";
      loadingEl.textContent = skipLlm
        ? "已跳过模型，正在播放规则脚本…"
        : "正在请求会议模型（约 60 秒内无结果将超时并自动改用规则脚本）…";
      adviceEl.appendChild(loadingEl);

      const scheduleRuleMeeting = () => {
        const script: Array<{ delay: number; speaker: string; message: string }> = [
          {
            delay: 0,
            speaker: "秘书",
            message: `各位好，立项会现在开始。今天议题是「${topicShort}」。先请三位总监从范围与风险各说一两分钟，最后请老板拍板。`
          },
          {
            delay: 700,
            speaker: "秘书",
            message: "议程：① 制作人定主线与里程碑 ② 技术评估可行性与工程边界 ③ 创意对齐爽点与验收 / 风格。"
          },
          {
            delay: 1600,
            speaker: "制作人",
            message: `我想把「${topicShort}」收成「最小可玩」：一条核心循环 + 两到三个里程碑。首版控制范围，后面再叠模式与内容。`
          },
          {
            delay: 2800,
            speaker: "技术总监",
            message:
              "赞同。先做可本地打开的 HTML 试玩包即可，性能按主流浏览器验收；复杂后端、排行榜之类放到后置里程碑，避免拖死 M1。"
          },
          {
            delay: 4000,
            speaker: "创意总监",
            message:
              "玩法上希望章程里写清一句「爽点」，再拆 3～7 条勾选式验收点；UI 风格关键词也写进节点，减少后期扯皮。"
          },
          {
            delay: 5200,
            speaker: "制作人",
            message: "收到。创意提的验收点我来落到里程碑节点里；和技术对齐——首版不联网没问题。"
          },
          {
            delay: 6400,
            speaker: "技术总监",
            message: "那 M1 我按「单机、无服务端依赖」卡交付物；需要的话只留接口占位，不实现。"
          },
          {
            delay: 7600,
            speaker: "秘书",
            message: "自由讨论先到这里。若无补充，请老板点击「立项通过（生成章程草稿）」。"
          }
        ];
        for (const row of script) {
          window.setTimeout(() => {
            if (gen !== meetingPlaybackGen || !adviceEl) return;
            appendMeetingLine(adviceEl, row.speaker, row.message);
          }, row.delay);
        }
      };

      let usedLlm = false;
      let llmDiag = "";
      let llmProvider = "";
      try {
        if (skipLlm) {
          llmDiag = "用户勾选跳过模型";
        } else {
          const ac = new AbortController();
          const clientDeadlineMs = 62_000;
          const kill = window.setTimeout(() => ac.abort(), clientDeadlineMs);
          try {
            const res = await fetch(`${studioHttp}/api/meeting/llm_transcript`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ projectId: pid, topic: topicRaw }),
              signal: ac.signal
            });
            const rawText = await res.text();
        let r: { ok?: boolean; lines?: unknown; note?: string; error?: string; providerId?: string };
        try {
          r = JSON.parse(rawText) as typeof r;
        } catch {
          llmDiag = `HTTP ${res.status}，响应不是 JSON（常见原因：studio-server 未重启、接口 404）`;
        }
        if (llmDiag) {
          /* skip */
        } else if (!r?.ok) {
          llmProvider = String(r?.providerId ?? "");
          llmDiag = [r?.note, r?.error].filter(Boolean).join(" ") || "接口返回 ok:false";
        } else if (Array.isArray(r.lines)) {
          llmProvider = String(r?.providerId ?? "");
          const clean = (r.lines as unknown[])
            .map((row) =>
              row && typeof row === "object"
                ? {
                    speaker: String((row as { speaker?: unknown }).speaker ?? "").trim(),
                    text: String((row as { text?: unknown }).text ?? "").trim()
                  }
                : { speaker: "", text: "" }
            )
            .filter((row) => row.speaker && row.text);
          if (clean.length >= 3) {
            usedLlm = true;
            loadingEl.remove();
            clean.forEach((row, i) => {
              window.setTimeout(() => {
                if (gen !== meetingPlaybackGen || !adviceEl) return;
                appendMeetingLine(adviceEl, row.speaker, row.text);
              }, i * 580);
            });
            const tailMs = clean.length * 580 + 400;
            window.setTimeout(() => {
              if (gen !== meetingPlaybackGen || !adviceEl) return;
              appendMeetingLine(
                adviceEl,
                "系统",
                `以上由会议路由模型生成（提供方：${llmProvider || "未知"}）。策略里「省钱」= 本地 Ollama；「均衡」= 会议默认走云端。`
              );
            }, tailMs);
          } else {
            llmDiag = `模型返回可解析行数不足（${clean.length} 条，需≥3）`;
          }
        } else {
          llmDiag = "响应缺少 lines 数组";
        }
          } finally {
            window.clearTimeout(kill);
          }
        }
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        const msg = e instanceof Error ? e.message : String(e);
        llmDiag = name === "AbortError" || /abort/i.test(msg) ? "请求超时（约 60s），本地模型过慢或未响应" : msg;
      } finally {
        startBtn.disabled = false;
        startBtn.textContent = prevBtnText ?? "开始会议";
      }

      if (!usedLlm) {
        loadingEl.remove();
        scheduleRuleMeeting();
        window.setTimeout(() => {
          if (gen !== meetingPlaybackGen || !adviceEl) return;
          appendMeetingLine(
            adviceEl,
            "系统",
            `以上为规则脚本。原因：${llmDiag || "未知"}。可先勾选「跳过模型」稳定走流程；外接 API 用 Moonshot 开放平台；本地用省钱档 + 小模型 + 保存配置。`
          );
        }, 8200);
      }
    };

  if (approveBtn)
    approveBtn.onclick = async () => {
      const topic = String(topicEl?.value ?? "新项目");
      const pid = getPid();
      const draft = {
        goal: `目标：${topic}`,
        milestones: ["M1 可试玩原型", "M2 打磨手感与容错", "M3 可对外演示"].filter(Boolean),
        nodes: ["浏览器打开预览可运行", "核心操作反馈清晰", "无明显脚本错误", "有简单胜负/进度反馈"]
      };
      const prevLabel = approveBtn.textContent;
      approveBtn.disabled = true;
      approveBtn.textContent = "生成中…";
      if (meetingPingOut) meetingPingOut.textContent = "";
      try {
        const res = await fetch(`${studioHttp}/api/charter`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: pid, draft })
        });
        const txt = await res.text();
        let r: { ok?: boolean; error?: string };
        try {
          r = txt ? JSON.parse(txt) : {};
        } catch {
          throw new Error(`章程接口返回非 JSON（HTTP ${res.status}）：${txt.slice(0, 120)}`);
        }
        const decRes = await fetch(`${studioHttp}/api/meeting/decide`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: pid, decision: "立项通过" })
        });
        let decOk = false;
        try {
          decOk = Boolean((await decRes.json())?.ok);
        } catch {
          decOk = false;
        }
        if (r?.ok) {
          applyCharter(r);
          goMeetingTab("charter");
          let kickHint = "";
          if (meetingAutoKickoff?.checked !== false) {
            try {
              const kr = await fetch(`${studioHttp}/api/meeting/kickoff`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ projectId: pid })
              }).then((x) => x.json());
              if (kr?.ok && kr?.job?.id) {
                kickHint = ` 已生成首包并入队（${String(kr.agentId ?? "producer")} · job ${kr.job.id}）。`;
                appendLog(`立项首包已入队 → ${String(kr.agentId ?? "producer")}（job ${kr.job.id}）`);
                Drawer.open("recruit");
                setTimeout(() => {
                  document.querySelector<HTMLButtonElement>(".segBtn[data-recruit-tab=\"dispatch\"]")?.click();
                }, 0);
                setTimeout(() => {
                  document.querySelector<HTMLButtonElement>(".menuBtn[data-open=\"tasks\"]")?.click();
                }, 80);
              } else {
                const why = kr?.error ?? JSON.stringify(kr?.details ?? "");
                kickHint = ` 首包入队未执行：${why}。可到「招聘→派单」手动入队。`;
                appendLog(`立项首包未入队：${why}`);
              }
            } catch (ke) {
              kickHint = ` 首包入队请求失败：${ke instanceof Error ? ke.message : String(ke)}。`;
              appendLog(`立项首包请求失败：${ke instanceof Error ? ke.message : String(ke)}`);
            }
          }
          if (meetingPingOut)
            meetingPingOut.textContent = decOk
              ? `已生成立项章程草稿，已切换到「章程」页，可继续编辑或归档。${kickHint}`
              : `章程已保存，但会议状态上报失败（可忽略或重试）。${kickHint}`;
        } else if (meetingPingOut) {
          meetingPingOut.textContent = `章程未保存：${r?.error ?? "unknown"}`;
        }
      } catch (e) {
        if (meetingPingOut)
          meetingPingOut.textContent = `立项通过失败：${e instanceof Error ? e.message : String(e)}`;
      } finally {
        approveBtn.disabled = false;
        approveBtn.textContent = prevLabel ?? "立项通过（生成章程草稿）";
      }
      void refreshCharter();
    };

  const readDraftFromForm = () => ({
    goal: String(goalEl?.value ?? ""),
    milestones: String(milEl?.value ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
    nodes: String(nodesEl?.value ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  });

  if (saveDraftBtn)
    saveDraftBtn.onclick = async () => {
      const pid = getPid();
      const prev = saveDraftBtn.textContent;
      saveDraftBtn.disabled = true;
      saveDraftBtn.textContent = "保存中…";
      if (charterActionOut) charterActionOut.textContent = "";
      try {
        const res = await fetch(`${studioHttp}/api/charter`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: pid, draft: readDraftFromForm() })
        });
        const txt = await res.text();
        let r: { ok?: boolean; error?: string };
        try {
          r = txt ? JSON.parse(txt) : {};
        } catch {
          throw new Error(`返回非 JSON（HTTP ${res.status}）：${txt.slice(0, 100)}`);
        }
        if (charterActionOut)
          charterActionOut.textContent = r?.ok ? "草稿已保存。" : `保存失败：${r?.error ?? "unknown"}`;
      } catch (e) {
        if (charterActionOut)
          charterActionOut.textContent = `保存失败：${e instanceof Error ? e.message : String(e)}`;
      } finally {
        saveDraftBtn.disabled = false;
        saveDraftBtn.textContent = prev ?? "保存草稿";
      }
      await refreshCharter();
    };

  if (archiveBtn)
    archiveBtn.onclick = async () => {
      const pid = getPid();
      const prev = archiveBtn.textContent;
      archiveBtn.disabled = true;
      saveDraftBtn && (saveDraftBtn.disabled = true);
      archiveBtn.textContent = "归档中…";
      if (charterActionOut) charterActionOut.textContent = "";
      try {
        const saveRes = await fetch(`${studioHttp}/api/charter`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: pid, draft: readDraftFromForm() })
        });
        const saveTxt = await saveRes.text();
        let saveJson: { ok?: boolean; error?: string };
        try {
          saveJson = saveTxt ? JSON.parse(saveTxt) : {};
        } catch {
          throw new Error(`先存草稿失败：响应非 JSON（HTTP ${saveRes.status}）：${saveTxt.slice(0, 80)}`);
        }
        if (!saveJson?.ok) throw new Error(`先存草稿失败：${saveJson?.error ?? "unknown"}`);

        const arcRes = await fetch(`${studioHttp}/api/charter/archive`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: pid })
        });
        const arcTxt = await arcRes.text();
        let r: { ok?: boolean; error?: string; archived?: { version?: number } };
        try {
          r = arcTxt ? JSON.parse(arcTxt) : {};
        } catch {
          throw new Error(`归档接口返回非 JSON（HTTP ${arcRes.status}）：${arcTxt.slice(0, 100)}`);
        }
        if (charterActionOut)
          charterActionOut.textContent = r?.ok
            ? `已归档新版本 v${r.archived?.version ?? "?"}（上方为当前归档信息）。`
            : `归档失败：${r?.error ?? "unknown"}`;
      } catch (e) {
        if (charterActionOut)
          charterActionOut.textContent = `归档失败：${e instanceof Error ? e.message : String(e)}`;
      } finally {
        archiveBtn.disabled = false;
        saveDraftBtn && (saveDraftBtn.disabled = false);
        archiveBtn.textContent = prev ?? "归档新版本";
      }
      await refreshCharter();
    };

  if (changeClear)
    changeClear.onclick = async () => {
      const pid = getPid();
      await fetch(`${studioHttp}/api/charter/changes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: pid, action: "clear" })
      });
      void refreshCharter();
    };

  if (changeGoCharter) changeGoCharter.onclick = () => goMeetingTab("charter");
}

function setupSettingsUI(studioHttp: string) {
  const btn = document.getElementById("btnSettings") as HTMLButtonElement | null;
  if (btn) btn.onclick = () => Drawer.open("settings");

  const localBase = document.getElementById("cfgLocalBaseUrl") as HTMLInputElement | null;
  const localModel = document.getElementById("cfgLocalModel") as HTMLSelectElement | null;
  const cloudBase = document.getElementById("cfgCloudBaseUrl") as HTMLInputElement | null;
  const cloudModel = document.getElementById("cfgCloudModel") as HTMLInputElement | null;
  const cloudApiKey = document.getElementById("cfgCloudApiKey") as HTMLInputElement | null;
  const cloudOut1k = document.getElementById("cfgCloudOut1k") as HTMLInputElement | null;
  const cloudPreset = document.getElementById("cloudPreset") as HTMLSelectElement | null;
  const cloudKeyHint = document.getElementById("cfgCloudKeyHint") as HTMLDivElement | null;
  const saveBtn = document.getElementById("saveProviderCfg") as HTMLButtonElement | null;
  const saveOut = document.getElementById("saveProviderCfgOut") as HTMLDivElement | null;
  const testLocal = document.getElementById("testLocal") as HTMLButtonElement | null;
  const testCloud = document.getElementById("testCloud") as HTMLButtonElement | null;
  const testLocalOut = document.getElementById("testLocalOut") as HTMLDivElement | null;
  const testCloudOut = document.getElementById("testCloudOut") as HTMLDivElement | null;
  const ollamaStatus = document.getElementById("ollamaStatus") as HTMLButtonElement | null;
  const ollamaStart = document.getElementById("ollamaStart") as HTMLButtonElement | null;
  const ollamaOut = document.getElementById("ollamaOut") as HTMLDivElement | null;

  const load = async () => {
    const r = await fetch(`${studioHttp}/api/providers`).then((x) => x.json());
    const cfg = r?.config;
    if (localBase) localBase.value = String(cfg?.local?.baseUrl ?? "");
    if (localModel) {
      localModel.innerHTML = "";
      const cur = String(cfg?.local?.model ?? "");
      const fallback = document.createElement("option");
      fallback.value = cur || "";
      fallback.textContent = cur || "（未选择）";
      localModel.appendChild(fallback);
      localModel.value = cur || "";
    }
    if (cloudBase) cloudBase.value = String(cfg?.cloud?.baseUrl ?? "");
    if (cloudModel) cloudModel.value = String(cfg?.cloud?.model ?? "");
    if (cloudOut1k) cloudOut1k.value = String(cfg?.cloud?.pricing?.outputPer1k ?? 0.03);
    if (cloudKeyHint) cloudKeyHint.textContent = cfg?.cloud?.hasApiKey ? "已保存 Key（不会回显）" : "未保存 Key";
  };
  void load();

  const refreshLocalModels = async () => {
    if (!localModel) return;
    const r = await fetch(`${studioHttp}/api/providers/models?providerId=local`).then((x) => x.json());
    if (!r?.ok || !Array.isArray(r.models)) return;
    const prev = localModel.value;
    localModel.innerHTML = "";
    const isEmbed = (s: string) => /embed|embedding/i.test(s);
    const sorted = [...r.models].sort((a: string, b: string) => Number(isEmbed(a)) - Number(isEmbed(b)) || a.localeCompare(b));
    for (const id of sorted) {
      const opt = document.createElement("option");
      opt.value = id;
      const embed = isEmbed(id);
      opt.textContent = embed ? `${id}（Embedding，仅向量，不可对话）` : id;
      localModel.appendChild(opt);
    }
    if (prev && r.models.includes(prev)) localModel.value = prev;
    else {
      const firstChat = sorted.find((m: string) => !isEmbed(m));
      if (firstChat) localModel.value = firstChat;
    }
  };

  const applyPreset = (key: string) => {
    if (!cloudBase || !cloudModel || !cloudOut1k) return;
    if (key === "deepseek_v4") {
      cloudBase.value = "https://api.deepseek.com/v1";
      cloudModel.value = "deepseek-v4-pro";
      cloudOut1k.value = "0.008";
      if (cloudApiKey) cloudApiKey.placeholder = "sk-... DeepSeek API Key";
    } else if (key === "deepseek_flash") {
      cloudBase.value = "https://api.deepseek.com/v1";
      cloudModel.value = "deepseek-flash";
      cloudOut1k.value = "0.002";
      if (cloudApiKey) cloudApiKey.placeholder = "sk-... DeepSeek API Key";
    } else if (key === "deepseek_r1") {
      cloudBase.value = "https://api.deepseek.com/v1";
      cloudModel.value = "deepseek-reasoner";
      cloudOut1k.value = "0.015";
      if (cloudApiKey) cloudApiKey.placeholder = "sk-... DeepSeek API Key";
    } else if (key === "moonshot") {
      cloudBase.value = "https://api.moonshot.cn/v1";
      cloudModel.value = "moonshot-v1-8k";
      cloudOut1k.value = "0.012";
      if (cloudApiKey) cloudApiKey.placeholder = "sk-... Moonshot API Key";
    } else if (key === "minimax") {
      cloudBase.value = "https://api.minimaxi.com/v1";
      cloudModel.value = "abab6.5s-chat";
      cloudOut1k.value = "0.015";
      if (cloudApiKey) cloudApiKey.placeholder = "Bearer ... MiniMax API Key";
    } else if (key === "cursor") {
      cloudBase.value = "（请填 Cursor 提供的 BaseURL）";
      cloudModel.value = "（请填 Cursor 模型名）";
    } else if (key === "codebuddy") {
      cloudBase.value = "（请填 CodeBuddy 提供的 BaseURL）";
      cloudModel.value = "（请填 CodeBuddy 模型名）";
    }
  };
  if (cloudPreset) cloudPreset.onchange = () => applyPreset(cloudPreset.value);

  const save = async () => {
    if (!saveOut) return;
    saveOut.textContent = "保存中...";
    const resp = await fetch(`${studioHttp}/api/providers/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: {
          local: { baseUrl: localBase?.value?.trim(), model: localModel?.value?.trim() },
          cloud: {
            baseUrl: cloudBase?.value?.trim(),
            model: cloudModel?.value?.trim(),
            apiKey: cloudApiKey?.value?.trim(),
            pricing: { outputPer1k: Number(cloudOut1k?.value ?? "0.03") }
          }
        }
      })
    }).then((x) => x.json());
    saveOut.textContent = resp?.ok ? "已保存" : `保存失败：${resp?.error ?? "unknown"}`;
    if (cloudApiKey) cloudApiKey.value = "";
    void load();
    void refreshLocalModels();
  };

  if (saveBtn) saveBtn.onclick = () => void save();

  const test = async (providerId: string, outEl: HTMLDivElement | null) => {
    if (!outEl) return;
    outEl.textContent = "测试中...";
    const ac = new AbortController();
    const clientMs = 70_000;
    const t = window.setTimeout(() => ac.abort(), clientMs);
    let r: any;
    try {
      const res = await fetch(`${studioHttp}/api/providers/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          providerId,
          baseUrl: providerId === "local" ? localBase?.value?.trim() : cloudBase?.value?.trim(),
          model: providerId === "local" ? localModel?.value?.trim() : cloudModel?.value?.trim(),
          apiKey: providerId === "cloud" ? cloudApiKey?.value?.trim() : undefined
        })
      });
      const txt = await res.text();
      try {
        r = txt ? JSON.parse(txt) : {};
      } catch {
        outEl.textContent = `响应不是 JSON（HTTP ${res.status}）：${txt.slice(0, 160)}`;
        return;
      }
    } catch {
      outEl.textContent = `请求中断或超时（>${Math.round(clientMs / 1000)}s）：请确认 studio-server 已重启、本页与 8787 同机时用 127.0.0.1:5173 打开（勿混用 localhost/127）。`;
      return;
    } finally {
      window.clearTimeout(t);
    }
    const failDetail = r?.upstreamDetail ? ` — ${String(r.upstreamDetail)}` : "";
    const failHttp = r?.upstreamStatus != null ? ` HTTP ${r.upstreamStatus}` : "";
    outEl.textContent = r?.ok
      ? `已连接（首包≈${r.firstChunkMs ?? "-"}ms）${r?.note === "upstream_json_completion" ? "（JSON 非流式）" : ""}`
      : `未连接：${r?.note ?? r?.error ?? "unknown"}${failHttp}${failDetail}`;
  };

  if (testLocal)
    testLocal.onclick = async () => {
      await test("local", testLocalOut);
      void refreshLocalModels();
    };
  if (testCloud) testCloud.onclick = () => void test("cloud", testCloudOut);

  if (ollamaStatus) {
    ollamaStatus.onclick = async () => {
      if (!ollamaOut) return;
      ollamaOut.textContent = "检测中...";
      const r = await fetch(`${studioHttp}/api/ollama/status`).then((x) => x.json());
      ollamaOut.textContent = r?.ok
        ? `CLI:${r.hasCli ? "有" : "无"} 本地连通:${r.localCheck?.ok ? "OK" : "FAIL"}`
        : `检测失败：${r?.error ?? "unknown"}`;
      if (r?.localCheck?.ok) void refreshLocalModels();
    };
  }
  if (ollamaStart) {
    ollamaStart.onclick = async () => {
      if (!ollamaOut) return;
      ollamaOut.textContent = "启动中...";
      const r = await fetch(`${studioHttp}/api/ollama/start`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((x) => x.json());
      ollamaOut.textContent = r?.ok ? "已尝试启动（稍后点测试/检测确认）" : `启动失败：${r?.note ?? r?.error ?? "unknown"}`;
    };
  }
}

function statusColor(status: string): number {
  switch (status) {
    case "streaming":
      return 0x6ee7ff;
    case "tool":
      return 0xffd66e;
    case "thinking":
      return 0xa7ff83;
    case "blocked":
      return 0xff6e6e;
    case "error":
      return 0xff4d9a;
    case "offline":
      return 0x7a819b;
    case "idle":
    default:
      return 0xc9d3ff;
  }
}

const TILE = 32;

type Theme = {
  bg0: number;
  bg1: number;
  ink: number;
  paper: number;
  deskTop: number;
  deskLeg: number;
  screen: number;
  skin: number;
  shirt: number;
};

const THEME: Theme = {
  bg0: 0x0b1020,
  bg1: 0x111a35,
  ink: 0x0b1020,
  paper: 0xe7ecff,
  deskTop: 0x6b4f2a,
  deskLeg: 0x3e2b16,
  screen: 0x2b355f,
  skin: 0xffd1b3,
  shirt: 0x5fd6ff
};

/** 部门主题色（用于角色差异化） */
const DEPT_COLORS: Record<string, { hair: number; shirt: number; accent: number }> = {
  leadership:  { hair: 0x1a1a2e, shirt: 0x818cf8, accent: 0xa5b4fc },
  design:      { hair: 0x3b1f0e, shirt: 0x22d3ee, accent: 0x67e8f9 },
  programming: { hair: 0x1c1c1c, shirt: 0x34d399, accent: 0x6ee7b7 },
  art_audio:   { hair: 0x4a1a2e, shirt: 0xf472b6, accent: 0xf9a8d4 },
  narrative:   { hair: 0x3d2b0a, shirt: 0xfbbf24, accent: 0xfcd34d },
  qa_release:  { hair: 0x2d1a0a, shirt: 0xf87171, accent: 0xfca5a5 },
  other:       { hair: 0x444444, shirt: 0x94a3b8, accent: 0xcbd5e1 }
};

function makePixelTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) {
  const g = scene.add.graphics();
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

function ensurePixelTextures(scene: Phaser.Scene) {
  if (scene.textures.exists("px_desk")) return;

  makePixelTexture(scene, "px_desk", TILE * 3, TILE * 2, (g) => {
    g.clear();
    // 桌腿
    g.fillStyle(THEME.deskLeg, 1);
    g.fillRect(6, TILE + 8, 8, TILE - 10);
    g.fillRect(TILE * 3 - 14, TILE + 8, 8, TILE - 10);
    // 桌面
    g.fillStyle(THEME.deskTop, 1);
    g.fillRect(0, TILE - 2, TILE * 3, 18);
    g.fillStyle(THEME.ink, 0.25);
    g.fillRect(0, TILE - 2, TILE * 3, 2);
    // 桌面木纹
    g.fillStyle(0x7d5c3a, 0.3);
    g.fillRect(4, TILE + 2, TILE * 3 - 8, 1);
    // 键盘（桌面左下区域）
    g.fillStyle(0x1a1a2e, 1);
    g.fillRoundedRect(4, TILE, 28, 14, 3);
    g.fillStyle(0x2d2d4a, 0.6);
    g.fillRect(7, TILE + 2, 22, 3);
    g.fillRect(7, TILE + 6, 22, 3);
    // 鼠标
    g.fillStyle(0x1a1a2e, 1);
    g.fillEllipse(38, TILE + 7, 8, 11);
    g.fillStyle(0x2d2d4a, 0.4);
    g.fillEllipse(38, TILE + 5, 4, 5);
    // 屏幕光晕
    g.fillStyle(0x06b6d4, 0.08);
    g.fillRect(TILE + 6, 2, TILE + 8, TILE - 4);
    // 屏幕
    g.fillStyle(THEME.screen, 1);
    g.fillRect(TILE + 10, 6, TILE, TILE - 10);
    g.fillStyle(0x6ee7ff, 0.50);
    g.fillRect(TILE + 12, 8, TILE - 4, TILE - 14);
    // 屏幕内容（代码线条）
    g.fillStyle(0xffffff, 0.12);
    g.fillRect(TILE + 15, 11, TILE - 12, 1);
    g.fillRect(TILE + 15, 14, 10, 1);
    g.fillRect(TILE + 15, 17, TILE - 8, 1);
    // 屏幕底部发光
    g.fillStyle(0x06b6d4, 0.12);
    g.fillRect(TILE + 10, TILE - 8, TILE, 4);
  });

  // 为每个部门创建独特的角色纹理
  const deptKeys = ["leadership", "design", "programming", "art_audio", "narrative", "qa_release", "other"];
  for (const dept of deptKeys) {
    const dc = DEPT_COLORS[dept] ?? DEPT_COLORS["other"]!;
    makePixelTexture(scene, `px_avatar_${dept}`, TILE, TILE, (g) => {
      g.clear();
      // shadow
      g.fillStyle(0x000000, 0.25);
      g.fillEllipse(TILE / 2, TILE - 4, TILE - 6, 8);
      // body
      g.fillStyle(dc.shirt, 1);
      g.fillRoundedRect(7, 16, 18, 14, 4);
      // 领带/领结
      g.fillStyle(dc.accent, 0.7);
      g.fillRect(14, 16, 4, 8);
      // head
      g.fillStyle(THEME.skin, 1);
      g.fillRoundedRect(9, 6, 14, 12, 5);
      // hair
      g.fillStyle(dc.hair, 1);
      g.fillRect(9, 6, 14, 4);
      // 头发顶部细节
      g.fillStyle(dc.accent, 0.3);
      g.fillRect(11, 6, 10, 1);
      // eyes
      g.fillStyle(0x111111, 1);
      g.fillRect(13, 11, 2, 2);
      g.fillRect(18, 11, 2, 2);
      // 微笑
      g.fillStyle(0x111111, 0.3);
      g.fillRect(14, 15, 5, 1);
    });
  }

  // 通用 avatar（回退用）
  makePixelTexture(scene, "px_avatar", TILE, TILE, (g) => {
    g.clear();
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(TILE / 2, TILE - 4, TILE - 6, 8);
    g.fillStyle(THEME.shirt, 1);
    g.fillRoundedRect(7, 16, 18, 14, 4);
    g.fillStyle(THEME.skin, 1);
    g.fillRoundedRect(9, 6, 14, 12, 5);
    g.fillStyle(0x2b1d12, 1);
    g.fillRect(9, 6, 14, 4);
    g.fillStyle(0x111111, 1);
    g.fillRect(13, 11, 2, 2);
    g.fillRect(18, 11, 2, 2);
  });

  /** 头顶状态灯：霓虹光晕 + 小圆点 + 色芯 */
  const statusLamp = (key: string, color: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
    makePixelTexture(scene, key, TILE, TILE, (g) => {
      g.clear();
      // 外圈光晕
      g.fillStyle(color, 0.08);
      g.fillCircle(16, 11, 12);
      g.fillStyle(color, 0.15);
      g.fillCircle(16, 11, 9);
      // 背景底色
      g.fillStyle(0x0b1020, 0.92);
      g.fillCircle(16, 11, 9);
      // 边框发光
      g.lineStyle(1.5, color, 0.95);
      g.strokeCircle(16, 11, 7);
      // 色芯
      g.fillStyle(color, 1);
      g.fillCircle(16, 11, 5);
      draw(g);
    });
  };

  statusLamp("px_status_idle", statusColor("idle"), (g) => {
    g.fillStyle(0xffffff, 0.35);
    g.fillCircle(16, 11, 2);
  });
  statusLamp("px_status_thinking", statusColor("thinking"), (g) => {
    g.fillStyle(0x0b1020, 0.85);
    g.fillCircle(13, 11, 2);
    g.fillCircle(16, 11, 2);
    g.fillCircle(19, 11, 2);
  });
  statusLamp("px_status_streaming", statusColor("streaming"), (g) => {
    g.fillStyle(0x0b1020, 0.75);
    g.fillRect(12, 8, 8, 2);
    g.fillRect(12, 11, 6, 2);
    g.fillRect(12, 14, 4, 2);
  });
  statusLamp("px_status_tool", statusColor("tool"), (g) => {
    g.fillStyle(0x0b1020, 0.8);
    g.fillRect(14, 7, 4, 2);
    g.fillRect(12, 9, 2, 6);
    g.fillRect(18, 9, 2, 6);
    g.fillRect(14, 15, 4, 2);
  });
  statusLamp("px_status_blocked", statusColor("blocked"), (g) => {
    g.fillStyle(0x0b1020, 0.9);
    g.fillRect(13, 8, 6, 6);
  });
  statusLamp("px_status_error", statusColor("error"), (g) => {
    g.fillStyle(0x0b1020, 0.95);
    g.fillRect(15, 7, 2, 9);
    g.fillRect(15, 18, 2, 2);
  });
  statusLamp("px_status_offline", statusColor("offline"), (g) => {
    g.fillStyle(0x0b1020, 0.85);
    g.fillRect(11, 12, 10, 2);
    g.fillRect(11, 15, 10, 2);
  });

  // --- Isometric tiles / props (runtime placeholder art) ---
  makePixelTexture(scene, "px_iso_floor", ISO.tileW, ISO.tileH, (g) => {
    g.clear();
    // 底色
    g.fillStyle(0x111a35, 1);
    g.lineStyle(1, 0x1a2446, 0.45);
    g.beginPath();
    g.moveTo(ISO.tileW / 2, 0);
    g.lineTo(ISO.tileW, ISO.tileH / 2);
    g.lineTo(ISO.tileW / 2, ISO.tileH);
    g.lineTo(0, ISO.tileH / 2);
    g.closePath();
    g.fillPath();
    g.strokePath();
    // 边缘发光
    g.lineStyle(1, 0x6366f1, 0.12);
    g.beginPath();
    g.moveTo(ISO.tileW / 2, 2);
    g.lineTo(ISO.tileW - 2, ISO.tileH / 2);
    g.lineTo(ISO.tileW / 2, ISO.tileH - 2);
    g.lineTo(2, ISO.tileH / 2);
    g.closePath();
    g.strokePath();
  });

  makePixelTexture(scene, "px_iso_carpet", ISO.tileW, ISO.tileH, (g) => {
    g.clear();
    g.fillStyle(0x1a244a, 1);
    g.lineStyle(1.5, 0x06b6d4, 0.35);
    g.beginPath();
    g.moveTo(ISO.tileW / 2, 0);
    g.lineTo(ISO.tileW, ISO.tileH / 2);
    g.lineTo(ISO.tileW / 2, ISO.tileH);
    g.lineTo(0, ISO.tileH / 2);
    g.closePath();
    g.fillPath();
    g.strokePath();
    // 中心装饰线
    g.lineStyle(1, 0x06b6d4, 0.18);
    g.beginPath();
    g.moveTo(ISO.tileW / 2, 4);
    g.lineTo(ISO.tileW / 2, ISO.tileH - 4);
    g.strokePath();
    // 发光点
    g.fillStyle(0x06b6d4, 0.15);
    g.fillCircle(ISO.tileW / 2, ISO.tileH / 2, 4);
  });

  // Wall segment (a small vertical-ish iso face)
  makePixelTexture(scene, "px_iso_wall", ISO.tileW, ISO.tileH + 26, (g) => {
    g.clear();
    const topY = 0;
    const baseY = 18;
    const height = 26;
    // 墙面渐变
    g.fillStyle(0x0f1730, 1);
    g.lineStyle(1, 0x2b355f, 0.9);
    // top edge (diamond-ish)
    g.beginPath();
    g.moveTo(ISO.tileW / 2, baseY);
    g.lineTo(ISO.tileW, baseY + ISO.tileH / 2);
    g.lineTo(ISO.tileW / 2, baseY + ISO.tileH);
    g.lineTo(0, baseY + ISO.tileH / 2);
    g.closePath();
    g.fillPath();
    g.strokePath();
    // 顶部边缘霓虹光
    g.lineStyle(1.5, 0x6366f1, 0.25);
    g.beginPath();
    g.moveTo(ISO.tileW / 2, baseY + 1);
    g.lineTo(ISO.tileW - 1, baseY + ISO.tileH / 2);
    g.strokePath();
    g.lineStyle(1.5, 0x06b6d4, 0.15);
    g.beginPath();
    g.moveTo(ISO.tileW / 2, baseY + 1);
    g.lineTo(1, baseY + ISO.tileH / 2);
    g.strokePath();
    // front face
    g.fillStyle(0x0b1020, 0.55);
    g.fillRect(ISO.tileW / 2 - 2, baseY + ISO.tileH, 4, height);
    // small highlight
    g.fillStyle(0xe7ecff, 0.08);
    g.fillRect(6, baseY + 6, 6, ISO.tileH + 10);
    // outline base
    g.lineStyle(1, 0x1a2446, 0.55);
    g.strokeRect(0, topY, 1, ISO.tileH + height + baseY);
  });

  makePixelTexture(scene, "px_iso_door", ISO.tileW, ISO.tileH + 26, (g) => {
    g.clear();
    const baseY = 18;
    const height = 26;
    g.fillStyle(0x111a35, 1);
    g.beginPath();
    g.moveTo(ISO.tileW / 2, baseY);
    g.lineTo(ISO.tileW, baseY + ISO.tileH / 2);
    g.lineTo(ISO.tileW / 2, baseY + ISO.tileH);
    g.lineTo(0, baseY + ISO.tileH / 2);
    g.closePath();
    g.fillPath();
    g.lineStyle(1, 0x2b355f, 0.9);
    g.strokePath();

    // 门框发光
    g.lineStyle(1.5, 0x6366f1, 0.15);
    g.beginPath();
    g.moveTo(ISO.tileW / 2 - 8, baseY + ISO.tileH - 2);
    g.lineTo(ISO.tileW / 2 + 8, baseY + ISO.tileH - 2);
    g.lineTo(ISO.tileW / 2 + 8, baseY + ISO.tileH + height - 2);
    g.lineTo(ISO.tileW / 2 - 8, baseY + ISO.tileH + height - 2);
    g.closePath();
    g.strokePath();

    // door glyph
    g.fillStyle(0x6b4f2a, 1);
    g.fillRect(ISO.tileW / 2 - 8, baseY + ISO.tileH - 2, 16, height);
    g.fillStyle(0x8b6f3a, 0.6);
    g.fillRect(ISO.tileW / 2 - 6, baseY + ISO.tileH + 2, 12, height - 8);
    g.fillStyle(0xe7ecff, 0.6);
    g.fillRect(ISO.tileW / 2 + 4, baseY + ISO.tileH + 10, 2, 2);
    // 门底部发光
    g.fillStyle(0x06b6d4, 0.08);
    g.fillRect(ISO.tileW / 2 - 8, baseY + ISO.tileH + height - 4, 16, 4);
  });

  // monitor prop (simple small screen + stand) — 增强版
  makePixelTexture(scene, "px_prop_monitor", TILE * 2, TILE * 2, (g) => {
    g.clear();
    // 底座
    g.fillStyle(0x0b1020, 0.55);
    g.fillRect(TILE - 2, TILE + 10, 4, 16);
    g.fillRect(TILE - 10, TILE + 24, 20, 4);
    // 屏幕外框
    g.fillStyle(0x1a2446, 1);
    g.fillRoundedRect(6, 6, TILE * 2 - 12, TILE + 10, 6);
    // 外框发光
    g.lineStyle(1, 0x6366f1, 0.2);
    g.strokeRoundedRect(6, 6, TILE * 2 - 12, TILE + 10, 6);
    // 屏幕光晕（外层）
    g.fillStyle(0x06b6d4, 0.08);
    g.fillRoundedRect(8, 8, TILE * 2 - 16, TILE + 6, 4);
    // 屏幕亮光
    g.fillStyle(0x6ee7ff, 0.30);
    g.fillRoundedRect(10, 10, TILE * 2 - 20, TILE + 2, 4);
    // 屏幕内容线条
    g.fillStyle(0xe7ecff, 0.20);
    g.fillRect(14, 14, TILE - 4, 2);
    g.fillStyle(0x6ee7ff, 0.25);
    g.fillRect(14, 18, TILE - 8, 2);
    g.fillStyle(0xe7ecff, 0.12);
    g.fillRect(14, 22, TILE - 10, 1);
    // 底部蓝色呼吸指示灯
    g.fillStyle(0x06b6d4, 0.6);
    g.fillCircle(TILE, TILE + 8, 2);
  });
}

/** 尝试加载外部 spritesheet。缺失时自动回退程序化纹理。 */
async function tryLoadExternalAssets(scene: Phaser.Scene) {
  const assetBase = "/assets";
  const sheets: Array<{ key: string; file: string; width?: number; height?: number }> = [
    { key: "sp_agents", file: "spritesheet_agents.png", width: 768, height: 128 },
    { key: "sp_furniture", file: "spritesheet_furniture.png", width: 640, height: 64 },
    { key: "sp_ui", file: "spritesheet_ui.png", width: 320, height: 32 }
  ];
  for (const s of sheets) {
    try {
      const r = await fetch(`${assetBase}/${s.file}`, { method: "HEAD" });
      if (r.ok && !scene.textures.exists(s.key)) {
        scene.textures.addImage(s.key, await createImageBitmap(await (await fetch(`${assetBase}/${s.file}`)).blob()));
      }
    } catch { /* 回退到程序化纹理 */ }
  }
  // 立绘
  const portraitAgents = ["producer", "game-designer", "lead-programmer", "artist", "writer", "qa-lead"];
  for (const pid of portraitAgents) {
    const key = `portrait_${pid}`;
    if (scene.textures.exists(key)) continue;
    try {
      const r = await fetch(`${assetBase}/portraits/${pid}.png`, { method: "HEAD" });
      if (r.ok) {
        scene.textures.addImage(key, await createImageBitmap(await (await fetch(`${assetBase}/portraits/${pid}.png`)).blob()));
      }
    } catch { /* 无立绘时回退 */ }
  }
  (window as any).__ASSETS_LOADED__ = true;
}

function statusKey(status: string) {
  switch (status) {
    case "thinking":
      return "px_status_thinking";
    case "streaming":
      return "px_status_streaming";
    case "tool":
      return "px_status_tool";
    case "blocked":
      return "px_status_blocked";
    case "error":
      return "px_status_error";
    case "offline":
      return "px_status_offline";
    case "idle":
    default:
      return "px_status_idle";
  }
}

function agentStatusZh(status: string): string {
  const m: Record<string, string> = {
    idle: "空闲",
    thinking: "执行中",
    streaming: "生成中",
    tool: "工具",
    blocked: "排队",
    error: "异常",
    offline: "离线"
  };
  return m[status] ?? status;
}

const deptNamesShort: Record<string, string> = {
  leadership: "领导", design: "策划", programming: "程序",
  art_audio: "美术", narrative: "叙事", qa_release: "QA", other: "综合"
};

const deptColorsShort: Record<string, string> = {
  leadership: "#818cf8", design: "#22d3ee", programming: "#34d399",
  art_audio: "#f472b6", narrative: "#fbbf24", qa_release: "#f87171", other: "#94a3b8"
};

const ROOM_ZONE_ZH: Record<string, string> = {
  meeting: "会议室",
  cafe: "咖啡室",
  cafe2: "茶室",
  restroom: "卫生间",
  arcade: "游戏机室",
  crossdress: "女装大佬室",
  gym: "健身室",
  pool: "桌球室",
  library: "图书室",
  cosplay: "COS室"
};

type Dept =
  | "leadership"
  | "design"
  | "programming"
  | "art_audio"
  | "narrative"
  | "qa_release"
  | "other";

type ZoneDef = {
  id: Dept;
  title: string;
  gx: number;
  gy: number;
  gw: number;
  gh: number;
};

function zoneTitleAt(gx: number, gy: number, zones: ZoneDef[]): string {
  for (const z of zones) {
    if (gx >= z.gx && gx < z.gx + z.gw && gy >= z.gy && gy < z.gy + z.gh) return z.title;
  }
  return "公共区域";
}

/** 园区 NPC 轻量行为规则（非插值移动、非 ML） */
const OFFICE_NAV_THREE_RULES = {
  /** 1 责任优先：非「空闲」不触发（执行/排队由 WS 状态约束） */
  dutyFirst: true,
  /** 2 工位摸鱼：人在工位上基本不动；出门只去咖啡/会议/卫生间等门点，不在楼里乱逛 */
  deskSlackThenPublicOnly: true,
  /** 3 安全可达：目标须 isWalkable；占格在 moveAgentGrid 内维护 */
  safeCells: true,
  /** 两次「出门摸鱼」之间最少间隔（ms） */
  minMsBetweenBreaks: 3500,
  /** 在公共设施附近停留多久后回工位（再加 0~9s 随机） */
  breakLingerBaseMs: 6000
} as const;

const DEPT_LABEL: Record<Dept, string> = {
  leadership: "领导/制作",
  design: "策划/设计",
  programming: "程序/工程",
  art_audio: "美术/音频",
  narrative: "叙事/本地化",
  qa_release: "QA/发布/平台",
  other: "其他"
};

const AGENT_CN: Record<string, string> = {
  producer: "制作人",
  "creative-director": "创意总监",
  "technical-director": "技术总监",
  "game-designer": "游戏策划",
  "systems-designer": "系统策划",
  "economy-designer": "数值策划",
  "level-designer": "关卡策划",
  "ux-designer": "UX 设计",
  "lead-programmer": "主程",
  "gameplay-programmer": "玩法程序",
  "engine-programmer": "引擎程序",
  "ai-programmer": "AI 程序",
  "network-programmer": "网络程序",
  "tools-programmer": "工具程序",
  "ui-programmer": "UI 程序",
  "security-engineer": "安全工程",
  "devops-engineer": "DevOps",
  "performance-analyst": "性能分析",
  "analytics-engineer": "数据分析",
  "web-h5-specialist": "H5 专家",
  "art-director": "美术总监",
  "technical-artist": "技术美术",
  "audio-director": "音频总监",
  "sound-designer": "音效设计",
  "narrative-director": "叙事总监",
  writer: "文案",
  "world-builder": "世界观",
  "localization-lead": "本地化负责人",
  "qa-lead": "QA 负责人",
  "qa-tester": "测试",
  "release-manager": "发布经理",
  "community-manager": "社区运营",
  "accessibility-specialist": "无障碍专员",
  "live-ops-designer": "活动/运营策划",
  prototyper: "原型开发",
  "wechat-minigame-specialist": "微信小游戏专家",
  "douyin-minigame-specialist": "抖音小游戏专家"
};

function agentLabel(agentId: string) {
  const cn = AGENT_CN[agentId];
  return cn ? `${cn}（${agentId}）` : agentId;
}

function studioEventTypeZh(type: string): string {
  const m: Record<string, string> = {
    "llm.chunk": "模型输出片段",
    "llm.message_done": "模型回复结束",
    "tool.start": "工具开始",
    "tool.end": "工具结束",
    "fs.change": "文件变更",
    "agent.assign": "任务指派",
    "policy.decision": "策略决策",
    "meeting.started": "会议开始",
    "meeting.decided": "会议决议",
    "charter.draft_saved": "章程草稿已保存",
    "charter.archived": "章程已归档",
    "change.detected": "检测到章程偏离",
    "change.cleared": "偏离提醒已清除",
    "room.enter": "进入房间",
    "room.leave": "离开房间",
    "job.enqueued": "任务已入队",
    "job.started": "任务已开始",
    "job.failed": "任务失败",
    "job.finished": "任务已结束",
    "asset.image_saved": "图像已生成",
    "asset.spritesheet_saved": "精灵表已生成",
    "asset.pipeline_failed": "资产流水线失败",
    heartbeat: "心跳"
  };
  return m[type] ?? type;
}

function policyActionZh(action: string): string {
  const m: Record<string, string> = {
    select_provider: "选择算力提供方",
    block_project_parallelism: "限制并行项目数",
    gate_review: "创意门禁拦截",
    gate_no_preview: "无预览拦截",
    producer_cascade: "制作人衔接入队",
    preview_saved_from_job: "预览已由任务写入",
    preview_not_saved_from_job: "预览未写入（程序任务）"
  };
  return m[action] ?? action;
}

function fsChangeKindZh(kind: string): string {
  const m: Record<string, string> = {
    add: "新增",
    change: "修改",
    unlink: "删除",
    addDir: "新建目录",
    unlinkDir: "删除目录"
  };
  return m[kind] ?? kind;
}

function formatStudioEventForLog(ev: StudioEventEnvelope): string {
  const typeZh = studioEventTypeZh(ev.type);
  const who = ev.agentId ? agentLabel(ev.agentId) : "";
  const agentPart = who ? ` · ${who}` : "";
  const p = ev.payload as Record<string, unknown>;
  const text = typeof p?.text === "string" ? p.text : "";

  const trunc = (s: string, n: number) => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };

  if (ev.type === "llm.chunk") {
    const preview = text ? trunc(text, 72) : "";
    return preview ? `【${typeZh}】${agentPart} ${preview}` : `【${typeZh}】${agentPart}`;
  }
  if (ev.type === "llm.message_done") {
    return `【${typeZh}】${agentPart}`;
  }
  if (ev.type === "job.started") {
    const task = typeof p?.task === "string" ? trunc(p.task, 100) : "";
    return task ? `【${typeZh}】${agentPart} — ${task}` : `【${typeZh}】${agentPart}`;
  }
  if (ev.type === "job.enqueued") {
    const task = typeof p?.task === "string" ? trunc(p.task, 100) : "";
    return task ? `【${typeZh}】${agentPart} — ${task}` : `【${typeZh}】${agentPart}`;
  }
  if (ev.type === "job.finished") {
    const ok = p?.ok === false ? "失败" : "成功";
    return `【${typeZh}】${agentPart}（${ok}）`;
  }
  if (ev.type === "policy.decision") {
    const action = typeof p?.action === "string" ? policyActionZh(p.action) : "";
    const reason = typeof p?.reason === "string" ? p.reason : "";
    const providerId = typeof p?.providerId === "string" ? p.providerId : "";
    const enq = typeof p?.enqueued === "number" ? `入队${p.enqueued}条` : "";
    const proj = typeof p?.projectId === "string" ? p.projectId : "";
    const bits = [action, reason, enq, proj ? `项目:${proj}` : "", providerId ? `提供方:${providerId}` : ""].filter(Boolean);
    return bits.length ? `【${typeZh}】${agentPart} — ${bits.join(" · ")}` : `【${typeZh}】${agentPart}`;
  }
  if (ev.type === "fs.change") {
    const path = typeof p?.path === "string" ? p.path : "";
    const kind = typeof p?.kind === "string" ? fsChangeKindZh(p.kind) : "";
    return path ? `【${typeZh}】${kind ? `${kind} ` : ""}${path}` : `【${typeZh}】`;
  }
  if (ev.type === "meeting.started") {
    const topic = typeof p?.topic === "string" ? trunc(p.topic, 80) : "";
    return topic ? `【${typeZh}】${topic}` : `【${typeZh}】`;
  }
  if (ev.type === "meeting.decided") {
    const decision = typeof p?.decision === "string" ? trunc(p.decision, 80) : "";
    return decision ? `【${typeZh}】${decision}` : `【${typeZh}】`;
  }
  if (ev.type === "charter.draft_saved") {
    const sum = typeof p?.summary === "string" ? trunc(p.summary, 80) : "";
    return sum ? `【${typeZh}】${sum}` : `【${typeZh}】`;
  }
  if (ev.type === "charter.archived") {
    const pid = typeof p?.projectId === "string" ? p.projectId : "";
    const v = typeof p?.version === "number" ? `v${p.version}` : "";
    const sum = typeof p?.summary === "string" ? trunc(p.summary, 60) : "";
    const head = [pid, v].filter(Boolean).join(" ");
    return sum ? `【${typeZh}】${head} — ${sum}` : head ? `【${typeZh}】${head}` : `【${typeZh}】`;
  }
  if (ev.type === "change.detected") {
    const pid = typeof p?.projectId === "string" ? p.projectId : "";
    const kinds = Array.isArray(p?.kinds) ? (p.kinds as string[]).join("、") : "";
    return [pid, kinds].filter(Boolean).length ? `【${typeZh}】${pid}${kinds ? `（${kinds}）` : ""}` : `【${typeZh}】`;
  }
  if (ev.type === "change.cleared") {
    const pid = typeof p?.projectId === "string" ? p.projectId : "";
    const reason = typeof p?.reason === "string" ? (p.reason === "archived" ? "因已归档" : p.reason) : "";
    return pid ? `【${typeZh}】${pid}${reason ? `（${reason}）` : ""}` : `【${typeZh}】`;
  }
  if (ev.type === "tool.start" || ev.type === "tool.end") {
    const tool = typeof p?.tool === "string" ? p.tool : "";
    const ok = ev.type === "tool.end" ? (p?.ok === false ? "失败" : "完成") : "";
    return tool ? `【${typeZh}】${tool}${ok ? `（${ok}）` : ""}` : `【${typeZh}】`;
  }
  if (ev.type === "agent.assign") {
    const task = typeof p?.task === "string" ? trunc(p.task, 80) : "";
    return task ? `【${typeZh}】${agentPart} — ${task}` : `【${typeZh}】${agentPart}`;
  }
  if (ev.type === "room.enter" || ev.type === "room.leave") {
    const room = typeof p?.roomId === "string" ? p.roomId : "";
    return room ? `【${typeZh}】${agentPart} → ${room}` : `【${typeZh}】${agentPart}`;
  }
  if (text) {
    return `【${typeZh}】${agentPart} ${trunc(text, 100)}`.trim();
  }
  return `【${typeZh}】${agentPart}`.trim();
}

const AGENT_INTRO_CN: Record<string, string> = {
  producer: "统筹项目、排期与资源分配，推动团队按期交付。",
  "creative-director": "把控创意方向与产品气质，统一团队对「做什么/为什么」的共识。",
  "technical-director": "把控技术路线与架构边界，解决关键技术风险与性能/稳定性问题。",
  "game-designer": "设计核心玩法与系统规则，定义体验目标与可实现的机制。",
  "systems-designer": "设计并维护系统机制（成长/数值/循环），让玩法可扩展且不崩坏。",
  "economy-designer": "校准经济与数值曲线，避免通胀/断档/无解最优策略。",
  "level-designer": "设计关卡结构与节奏，安排引导、挑战与奖励分布。",
  "ux-designer": "优化交互流程与信息架构，降低学习成本与误操作。",
  "lead-programmer": "制定工程规范与模块边界，负责关键系统落地与代码质量。",
  "gameplay-programmer": "实现玩法与交互逻辑，把策划规则变成可玩的系统。",
  "engine-programmer": "负责底层性能与渲染/资源/框架能力，解决性能瓶颈。",
  "ai-programmer": "实现 NPC/决策/寻路/行为系统，提升可玩性与智能表现。",
  "network-programmer": "实现联机同步/协议/延迟优化，保障多人体验稳定。",
  "tools-programmer": "开发编辑器/流水线工具，提高内容生产效率。",
  "ui-programmer": "实现界面系统与动效、数据绑定与交互逻辑。",
  "security-engineer": "识别与修复安全风险，降低数据泄露/滥用与攻击面。",
  "devops-engineer": "维护构建/发布/监控/部署流程，保证上线稳定可回滚。",
  "performance-analyst": "定位卡顿与内存问题，制定并验证性能优化方案。",
  "analytics-engineer": "设计埋点与指标体系，帮助用数据驱动迭代。",
  "web-h5-specialist": "专注 H5/网页端性能与兼容，保障跨端运行体验。",
  "art-director": "把控美术风格与品质标准，统一视觉语言与资产规范。",
  "technical-artist": "连接美术与工程：材质/特效/工具/性能，提升表现与效率。",
  "audio-director": "把控音乐与音效方向，统一风格并落地到实现方案。",
  "sound-designer": "设计音效与反馈层次，提升打击感、氛围与可读性。",
  "narrative-director": "搭建叙事结构与世界观，统一角色与文本表达。",
  writer: "撰写对白、文案与说明文本，保证风格一致且信息清晰。",
  "world-builder": "构建世界观设定与背景细节，支撑长期内容扩展。",
  "localization-lead": "管理多语言与术语一致性，保证不同地区的体验质量。",
  "qa-lead": "制定测试策略与质量门禁，组织回归与发布验收。",
  "qa-tester": "执行测试用例、复现与记录问题，推动缺陷闭环。",
  "release-manager": "组织版本发布、变更控制与回滚预案，保证上线可控。",
  "community-manager": "对外沟通与社区运营，收集反馈并协助危机处理。",
  "accessibility-specialist": "提升可访问性与易用性，覆盖更多玩家与设备场景。",
  "live-ops-designer": "设计活动/赛季/运营节奏，提高留存与长期目标感。",
  prototyper: "快速做原型验证想法，用最低成本试错与收敛方案。",
  "wechat-minigame-specialist": "处理微信小游戏平台适配、限制与发布流程。",
  "douyin-minigame-specialist": "处理抖音小游戏平台适配、限制与发布流程。"
};

function isProbablyChinese(s: string) {
  return /[\u4e00-\u9fff]/.test(s);
}

function agentIntro(agentId: string, serverDesc?: string) {
  const d = (serverDesc ?? "").trim();
  if (d && isProbablyChinese(d)) return d;
  return AGENT_INTRO_CN[agentId] ?? (d || "（暂无介绍）");
}

type RoleAdvice = {
  short: string;
  providerHint?: "local" | "cloud";
  suggestedProviders?: string[]; // providerId order
  tools?: string[];
  localDeployHint?: string;
};

function roleAdvice(agentId: string, grade?: string): RoleAdvice {
  const dept = deptOf(agentId);
  const strong = grade === "S" || grade === "A";
  if (dept === "art_audio") {
    if (agentId === "sound-designer" || agentId === "audio-director") {
      return {
        short: "音乐/音效更适合用云端服务（质量稳定、素材库丰富），本地可作为备选。",
        providerHint: "cloud",
        suggestedProviders: ["music_cloud", "cloud", "local"],
        tools: ["AI音乐生成（后续接入）", "音效素材库（后续接入）"]
      };
    }
    return {
      short: strong ? "美术建议优先本地（更隐私、可控），不足时再用云端。" : "美术建议优先云端（更省事），本地性能足够再搭建 SD。",
      providerHint: strong ? "local" : "cloud",
      suggestedProviders: ["doubao_image", "local", "cloud"],
      tools: ["豆包/通义等图像生成（后续接入）", "Stable Diffusion（本地）"],
      localDeployHint: "本地建议：SD WebUI / ComfyUI（后续在帮助里给一键检测+安装指引）"
    };
  }
  if (dept === "qa_release") {
    return { short: "QA/发布偏流程与检查：本地小模型够用；需要广泛知识时用云端补齐。", providerHint: "local", suggestedProviders: ["local", "cloud"] };
  }
  if (dept === "programming") {
    return { short: "程序岗位：本地用于日常迭代（隐私+便宜），复杂任务/排队严重时切云端外包。", providerHint: "local", suggestedProviders: ["local", "cloud"] };
  }
  if (dept === "design" || dept === "narrative") {
    return { short: "策划/文案：云端更省心（长文本/创意），机密项目可用本地减少外发。", providerHint: "cloud", suggestedProviders: ["cloud", "local"] };
  }
  if (dept === "leadership") {
    return { short: "领导岗：云端快速出方案；关键资料建议本地处理。", providerHint: "cloud", suggestedProviders: ["cloud", "local"] };
  }
  return { short: "通用岗位：按体检建议选择 Provider，本地优先、卡顿则外包。", providerHint: "local", suggestedProviders: ["local", "cloud"] };
}

function deptOf(agentId: string): Dept {
  if (agentId === "producer" || agentId === "creative-director" || agentId === "technical-director") return "leadership";

  if (
    agentId === "game-designer" ||
    agentId === "systems-designer" ||
    agentId === "economy-designer" ||
    agentId === "level-designer" ||
    agentId === "ux-designer"
  )
    return "design";

  if (
    agentId === "lead-programmer" ||
    agentId === "gameplay-programmer" ||
    agentId === "engine-programmer" ||
    agentId === "ai-programmer" ||
    agentId === "network-programmer" ||
    agentId === "tools-programmer" ||
    agentId === "ui-programmer" ||
    agentId === "security-engineer" ||
    agentId === "devops-engineer" ||
    agentId === "performance-analyst" ||
    agentId === "analytics-engineer" ||
    agentId === "web-h5-specialist"
  )
    return "programming";

  if (agentId === "art-director" || agentId === "technical-artist" || agentId === "audio-director" || agentId === "sound-designer") return "art_audio";

  if (agentId === "narrative-director" || agentId === "writer" || agentId === "world-builder" || agentId === "localization-lead") return "narrative";

  if (
    agentId === "qa-lead" ||
    agentId === "qa-tester" ||
    agentId === "release-manager" ||
    agentId === "community-manager" ||
    agentId === "accessibility-specialist" ||
    agentId === "live-ops-designer" ||
    agentId === "prototyper" ||
    agentId === "wechat-minigame-specialist" ||
    agentId === "douyin-minigame-specialist"
  )
    return "qa_release";

  return "other";
}

class OfficeScene extends Phaser.Scene {
  private desks = new Map<string, Desk>();
  private state: StudioState = { sessionId: "ui", agents: {} };
  private studio = getStudioBase();
  private zones: ZoneDef[] = [];
  private zoneGfx?: Phaser.GameObjects.Graphics;
  private minimapCam?: Phaser.Cameras.Scene2D.Camera;
  private minimapOverlay?: Phaser.GameObjects.Graphics;
  /** 与 layoutOffice 中 setBounds 一致，供小地图点击跳转 */
  private officePanBounds = new Phaser.Geom.Rectangle(0, 0, 1, 1);
  private isPanning = false;
  private panStart?: { x: number; y: number; camX: number; camY: number };
  private selectedAgentId?: string;
  private selectedAgentIds = new Set<string>();
  private selectionRing?: Phaser.GameObjects.Graphics;
  private gridW = 56;
  private gridH = 36;
  /** 动态占格（工位上的小人）；寻路用 staticBlocked，可穿过他人格 */
  private blocked = new Set<string>();
  /** 墙体与房间内部等静态障碍 */
  private staticBlocked = new Set<string>();
  /** 地图内等距房间（主题医院式：与工区同一地板，从房门进入） */
  private roomGrid: IsoRoomDef[] = [];
  private jobMeta = new Map<string, { agentId?: string; providerId?: string }>(); // jobId -> meta
  private jobChars = new Map<string, number>(); // jobId -> chars
  private notifyFeed: string[] = [];
  /** 秘书Keyed 提示节流（避免同一卡点刷屏） */
  private secretaryLastKeyed = new Map<string, number>();
  /** WS 是否可用（秘书与事件依赖） */
  private wsOnline = false;
  private readonly onPreviewSavedListener = ((ev: Event) => {
    const d = (ev as CustomEvent<{ projectId?: string }>).detail;
    const pid = d?.projectId ? String(d.projectId) : "";
    if (!pid) return;
    const url = `${this.studio.http}/preview?projectId=${encodeURIComponent(pid)}`;
    const line = `秘书：已保存可玩 HTML（${pid}）。浏览器打开 ${url} ；仓库文件 production/preview/${pid}/index.html ；Studio 内看「显示器」iframe。`;
    this.pushNotify(line);
    setSecretaryHud(`已保存 HTML。预览：${url}`);
  }) as EventListener;
  private cloudPricingOutPer1k = 0.03; // fallback; will be refreshed from /api/providers when possible
  private allAgentIds: string[] = [];
  private monitorObj?: Phaser.GameObjects.Image;
  private deptMonitors = new Map<Dept, Phaser.GameObjects.Image>();
  private meetingRoomObj?: Phaser.GameObjects.Image;
  private recentEvents: StudioEventEnvelope[] = [];
  /** 轮流尝试出门，避免总随机到同一人或概率跳过 */
  private wanderRoundRobin = 0;

  constructor() {
    super("OfficeScene");
  }

  async create() {
    this.cameras.main.setBackgroundColor("#0b1020");

    ensurePixelTextures(this);
    void tryLoadExternalAssets(this);

    this.setupControls();

    // Load agents list (for desk slots)
    try {
      const agents = await fetch(`${this.studio.http}/api/agents`).then((r) => r.json() as Promise<{ agents: Array<{ id: string; description?: string }> }>);
      setText("agentCount", `Agents: ${agents.agents.length}`);
      const allAgents = agents.agents;
      const allAgentIds = allAgents.map((a) => a.id);
      this.allAgentIds = allAgentIds;

      // 初始在岗：服务端默认全员雇佣（见 studio-hired.json）；若列表为空则退回仅领导区
      let hiredIds: string[] = [];
      try {
        const h = await fetch(`${this.studio.http}/api/hire`).then((r) => r.json() as Promise<{ hired: string[] }>);
        hiredIds = Array.isArray(h?.hired) ? h.hired : [];
      } catch {
        hiredIds = [];
      }

      const leadershipOnly = allAgentIds.filter((id) => deptOf(id) === "leadership");
      const activeIds = hiredIds.length > 0 ? hiredIds : leadershipOnly;
      this.layoutOffice(activeIds);
      this.setupRooms();
      this.setupSelectionUI();
      void this.setupRecruitUI(allAgents);
    } catch (e) {
      setText("agentCount", `Agents: 0`);
      appendLog(`无法连接 studio-server：${this.studio.http}（${e instanceof Error ? e.message : String(e)}）`);
      // Still render empty office.
    }

    await this.bootstrapTail();
    // 历史日志里的 job/llm 状态会覆盖为「一直在干活」，导致从不 idle、溜达永远不触发
    this.resetAgentsIdleForOffice();
    setSecretaryHud("流程：会议→制作人→衔接串行（策划→程序→美术→QA）。预览由程序任务写盘；卡住时每 5s 会对齐服务端队列。");
    window.addEventListener("studio-preview-saved", this.onPreviewSavedListener);
    this.connectWs();

    this.setupMinimap();

    // Idle wandering loop（略快于 1s，且首轮延迟后立刻试一次，避免「永远等不到第一次」）
    this.time.delayedCall(500, () => this.tickWander());
    this.time.addEvent({
      delay: 800,
      loop: true,
      callback: () => this.tickWander()
    });
    this.time.addEvent({
      delay: 5200,
      loop: true,
      callback: () => this.tickBanter()
    });
    this.time.addEvent({
      delay: 9000,
      loop: true,
      callback: () => this.warnOffDeskWorkers()
    });
    this.time.addEvent({
      delay: 14000,
      loop: true,
      callback: () => void this.tickSecretary()
    });
    this.time.delayedCall(2500, () => void this.tickSecretary());

    this.time.addEvent({
      delay: 5000,
      loop: true,
      callback: () => this.syncDeskStatusWithServerQueue()
    });
    this.time.addEvent({
      delay: 3000,
      loop: true,
      callback: () => void this.tickSandbox()
    });
    this.time.delayedCall(1500, () => void this.tickSandbox());
  }

  /** 仅用于园区可视化：清掉日志重放带来的陈旧 agent 状态，避免全员卡在非 idle */
  private resetAgentsIdleForOffice() {
    const agents: Record<string, StudioAgentState> = {};
    for (const id of this.desks.keys()) {
      agents[id] = { agentId: id, status: "idle" };
    }
    this.state = { ...this.state, agents };
    this.applyState();
  }

  private clearDesks() {
    for (const d of this.desks.values()) {
      d.idleBobTween?.stop();
      d.navPathGfx?.destroy();
      d.navHint?.destroy();
      d.bubble?.destroy();
      d.label.destroy();
      d.statusIcon.destroy();
      d.avatar.destroy();
      d.desk.destroy();
      d.hit?.destroy();
    }
    this.desks.clear();
  }

  private async refreshOfficeFromHire() {
    if (!this.allAgentIds.length) return;
    let hiredIds: string[] = [];
    try {
      const h = await fetch(`${this.studio.http}/api/hire`).then((r) => r.json() as Promise<{ hired: string[] }>);
      hiredIds = Array.isArray(h?.hired) ? h.hired : [];
    } catch {
      hiredIds = [];
    }
    const leadershipOnly = this.allAgentIds.filter((id) => deptOf(id) === "leadership");
    const activeIds = hiredIds.length > 0 ? hiredIds : leadershipOnly;
    this.clearDesks();
    this.layoutOffice(activeIds);
    this.applyState();
  }

  private async setupRecruitUI(agents: Array<{ id: string; description?: string }>) {
    const agentIds = agents.map((a) => a.id);
    const hireList = qs<HTMLDivElement>("hireList");
    const agentSelect = qs<HTMLSelectElement>("agentSelect");
    const slotsInput = qs<HTMLInputElement>("slots");
    const saveSlots = qs<HTMLButtonElement>("saveSlots");
    const autoOutsource = qs<HTMLInputElement>("autoOutsource");
    const saveAutoOutsource = qs<HTMLButtonElement>("saveAutoOutsource");
    const benchBtn = qs<HTMLButtonElement>("bench");
    const benchOut = qs<HTMLDivElement>("benchOut");
    const benchSweepBtn = qs<HTMLButtonElement>("benchSweep");
    const benchSweepOut = qs<HTMLDivElement>("benchSweepOut");
    const sysProfile = qs<HTMLDivElement>("sysProfile");
    const adviceOut = qs<HTMLDivElement>("adviceOut");
    const applyAdviceBtn = qs<HTMLButtonElement>("applyAdvice");
    const applyAdviceOut = qs<HTMLDivElement>("applyAdviceOut");
    const enqueueBtn = qs<HTMLButtonElement>("enqueue");
    const taskInput = qs<HTMLInputElement>("task");
    const priorityInput = qs<HTMLInputElement>("priority");
    const queueOut = qs<HTMLDivElement>("queueOut");
    const providerSelect = qs<HTMLSelectElement>("providerSelect");
    const bindProviderBtn = qs<HTMLButtonElement>("bindProvider");
    const queueDetail = document.getElementById("queueDetail");
    const finTokens = document.getElementById("finTokens");
    const finReq = document.getElementById("finReq");
    const finFail = document.getElementById("finFail");
    const finFailReason = document.getElementById("finFailReason");
    const finReqByProvider = document.getElementById("finReqByProvider");
    const finCost = document.getElementById("finCost");
    const finReset = document.getElementById("finReset") as HTMLButtonElement | null;
    const finResetOut = document.getElementById("finResetOut");
    const notifyList = document.getElementById("notifyList");
    const hireFilter = qs<HTMLSelectElement>("hireFilter");
    const hireEarlyMode = qs<HTMLInputElement>("hireEarlyMode");
    const hireSearch = qs<HTMLInputElement>("hireSearch");
    const hireClear = qs<HTMLButtonElement>("hireClear");
    const hireSyncAll = qs<HTMLButtonElement>("hireSyncAll");
    const seg = document.querySelectorAll<HTMLButtonElement>(".segBtn[data-recruit-tab]");

    // recruit tabs (市场/派单/体检)
    const setRecruitTab = (key: string) => {
      for (const b of seg) b.classList.toggle("isActive", b.getAttribute("data-recruit-tab") === key);
      for (const k of ["market", "dispatch", "diagnose"]) {
        document.getElementById(`recruitTab_${k}`)?.classList.toggle("isActive", k === key);
      }
    };
    for (const b of seg) {
      b.addEventListener("click", () => setRecruitTab(b.getAttribute("data-recruit-tab") || "market"));
    }
    setRecruitTab("market");

    // Settings
    const settings = await fetch(`${this.studio.http}/api/settings`).then((r) => r.json() as Promise<{ settings: { computeSlots: number; autoOutsource?: boolean } }>);
    slotsInput.value = String(settings.settings.computeSlots);
    autoOutsource.checked = Boolean(settings.settings.autoOutsource);

    saveSlots.onclick = async () => {
      const v = Number(slotsInput.value);
      await fetch(`${this.studio.http}/api/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ computeSlots: v })
      });
      appendLog(`ComputeSlots = ${v}`);
    };

    saveAutoOutsource.onclick = async () => {
      await fetch(`${this.studio.http}/api/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoOutsource: autoOutsource.checked })
      });
      appendLog(`自动外包 = ${autoOutsource.checked ? "开启" : "关闭"}`);
    };

    // Bench
    benchBtn.onclick = async () => {
      benchOut.textContent = "体检中...";
      const out = await fetch(`${this.studio.http}/api/bench`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json());
      benchOut.textContent = out?.ok ? `首包延迟: ${out.firstChunkMs}ms` : `不可用: ${out.note ?? out.error ?? "unknown"}`;
    };

    benchSweepBtn.onclick = async () => {
      benchSweepOut.textContent = "阶梯体检中...";
      const out = await fetch(`${this.studio.http}/api/bench/sweep`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: providerSelect.value, concurrencyLevels: [1, 2, 3] })
      }).then((r) => r.json());
      if (!out?.ok) {
        benchSweepOut.textContent = `不可用: ${out?.error ?? out?.note ?? "unknown"}`;
      } else {
        const rows = (out.results as any[]).map((x) => `${x.concurrency}并发 首包${x.firstChunkMs ?? "-"}ms 字符${x.sampleChars ?? "-"}`).join(" | ");
        benchSweepOut.textContent = rows || "完成";
      }
    };

    let lastAdviceGrade: string | undefined;
    let lastAdvice: any = null;

    const refreshProfileAndAdvice = async () => {
      const p = await fetch(`${this.studio.http}/api/system/profile`).then((r) => r.json());
      sysProfile.textContent = p?.ok
        ? `设备：${p.osName ?? p.platform ?? "-"} / 内存${p.memGB ?? "-"}GB / CPU${p.cpuModel ?? "-"} / GPU${p.gpuName ?? "未知"} / 显存${p.vramGB ?? "-"}GB`
        : `设备：不可用（${p?.error ?? "unknown"}）`;

      const a = await fetch(`${this.studio.http}/api/advice`).then((r) => r.json());
      lastAdvice = a;
      if (!a?.ok) {
        adviceOut.textContent = `建议：不可用（${a?.error ?? "unknown"}）`;
      } else {
        const lines: string[] = [];
        if (a.grade) lines.push(`算力等级：${a.grade}`);
        lines.push(`建议：Provider=${a.recommendedProviderId} / ComputeSlots=${a.recommendedComputeSlots}`);
        if (Array.isArray(a.notes)) lines.push(...a.notes.map((s: string) => `- ${s}`));
        if (Array.isArray(a.localModelsSuggested) && a.localModelsSuggested.length > 0) {
          lines.push(`可部署模型建议：${a.localModelsSuggested.join("、")}`);
        }
        adviceOut.textContent = lines.join("\n");
      }
      lastAdviceGrade = a?.grade;
      const perfPill = document.getElementById("perfPill");
      if (perfPill && a?.ok) {
        const cap = typeof a.recommendedComputeSlots === "number" ? a.recommendedComputeSlots : "-";
        const hireCap = typeof a.localAgentCap === "number" ? a.localAgentCap : "-";
        perfPill.textContent = `算力：${a.grade ?? "-"}  本地可雇：${hireCap}  推荐：${a.recommendedProviderId ?? "-"}  并发：${cap}`;
      }
      (applyAdviceBtn as any)._lastAdvice = a;
    };
    setInterval(() => void refreshProfileAndAdvice(), 8000);
    void refreshProfileAndAdvice();

    applyAdviceBtn.onclick = async () => {
      applyAdviceOut.textContent = "应用中...";
      const a = (applyAdviceBtn as any)._lastAdvice;
      if (!a?.ok) {
        applyAdviceOut.textContent = "暂无可应用的建议";
        return;
      }
      // Apply computeSlots
      await fetch(`${this.studio.http}/api/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ computeSlots: a.recommendedComputeSlots })
      });
      slotsInput.value = String(a.recommendedComputeSlots);

      // Apply provider bind for current agent
      await fetch(`${this.studio.http}/api/providers/bind`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: agentSelect.value, providerId: a.recommendedProviderId })
      });
      providerSelect.value = a.recommendedProviderId;
      applyAdviceOut.textContent = "已应用（ComputeSlots + 当前 Agent Provider）";
    };

    // Hire list (optional gate)
    const hired = await fetch(`${this.studio.http}/api/hire`).then((r) => r.json() as Promise<{ hired: string[] }>);
    let hiredSet = new Set(hired.hired);

    // Filter options
    hireFilter.innerHTML = "";
    const fAll = document.createElement("option");
    fAll.value = "all";
    fAll.textContent = "全部";
    hireFilter.appendChild(fAll);
    for (const d of ["leadership", "design", "programming", "art_audio", "narrative", "qa_release", "other"] as const) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = DEPT_LABEL[d];
      hireFilter.appendChild(opt);
    }

    let providersResp: { providers: Array<{ id: string; label: string; pricing?: { outputPer1k?: number }; capabilities?: string[] }>; agentProvider: Record<string, string> } | null = null;

    const renderHire = () => {
      hireList.classList.remove("list");
      hireList.classList.add("cardGrid");
      hireList.innerHTML = "";
      const filter = hireFilter.value as "all" | Dept;
      const early = !!hireEarlyMode.checked;
      const seenDept = new Set<Dept>();
      const q = hireSearch.value.trim().toLowerCase();

      for (const id of agentIds) {
        const d = deptOf(id);
        if (filter !== "all" && d !== filter) continue;
        const label = agentLabel(id);
        if (q && !label.toLowerCase().includes(q) && !id.toLowerCase().includes(q)) continue;
        if (early) {
          if (seenDept.has(d)) continue;
          seenDept.add(d);
        }

        const card = document.createElement("div");
        card.className = "card";

        const top = document.createElement("div");
        top.className = "cardTop";

        const title = document.createElement("div");
        title.className = "cardTitle";
        title.textContent = label;

        const meta = document.createElement("div");
        meta.className = "cardMeta";
        const tagDept = document.createElement("div");
        tagDept.className = "tag";
        tagDept.textContent = DEPT_LABEL[d];
        meta.appendChild(tagDept);

        const adv = roleAdvice(id, lastAdviceGrade);
        if (adv.providerHint) {
          const t = document.createElement("div");
          t.className = "tag";
          t.textContent = `建议：${adv.providerHint === "local" ? "本地" : "云端"}`;
          meta.appendChild(t);
        }

        top.appendChild(title);
        top.appendChild(meta);
        card.appendChild(top);

        const body = document.createElement("div");
        body.className = "cardBody";
        const lines: string[] = [];
        const desc = agents.find((a) => a.id === id)?.description;
        lines.push(`介绍：${agentIntro(id, desc)}`);
        lines.push(adv.short);
        if (adv.tools?.length) lines.push(`工具：${adv.tools.join("、")}`);
        if (adv.localDeployHint) lines.push(adv.localDeployHint);
        body.textContent = lines.join("\n");
        card.appendChild(body);

        const actions = document.createElement("div");
        actions.className = "cardActions";

        const btnHire = document.createElement("button");
        const hiredNow = hiredSet.has(id);
        btnHire.textContent = hiredNow ? "解雇" : "雇佣";
        btnHire.className = hiredNow ? "btnWarn" : "btnPrimary";
        btnHire.onclick = async () => {
          const next = !hiredSet.has(id);
          if (next) hiredSet.add(id);
          else hiredSet.delete(id);
          await fetch(`${this.studio.http}/api/hire`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agentId: id, hired: next })
          });
          renderHire();
          void this.refreshOfficeFromHire();
        };
        actions.appendChild(btnHire);

        const providerMini = document.createElement("select");
        providerMini.style.minWidth = "120px";
        const bound = providersResp?.agentProvider?.[id];
        const want = bound ?? (adv.suggestedProviders?.[0] ?? (adv.providerHint ?? "local"));
        const list = providersResp?.providers ?? [
          { id: "local", label: "本地文本", capabilities: ["text"] },
          { id: "cloud", label: "云端文本", capabilities: ["text"] },
          { id: "doubao_image", label: "豆包绘图（建议接入）", capabilities: ["image"] },
          { id: "music_cloud", label: "AI音乐（建议接入）", capabilities: ["music"] }
        ];
        const ordered = adv.suggestedProviders?.length ? adv.suggestedProviders : undefined;
        const display = ordered ? ordered.map((pid) => list.find((p) => p.id === pid)).filter(Boolean) as any[] : list;
        providerMini.innerHTML = "";
        for (const p of display) {
          const opt = document.createElement("option");
          opt.value = p.id;
          const caps = Array.isArray(p.capabilities) ? p.capabilities : [];
          const canText = caps.includes("text");
          opt.textContent = p.label || p.id;
          if (!canText) {
            opt.disabled = true;
            opt.textContent = `${opt.textContent}（暂不可派单）`;
          }
          providerMini.appendChild(opt);
        }
        providerMini.value = want;
        actions.appendChild(providerMini);

        const btnBind = document.createElement("button");
        btnBind.textContent = "绑定模型";
        btnBind.onclick = async () => {
          const providerId = providerMini.value;
          const r = await fetch(`${this.studio.http}/api/providers/bind`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agentId: id, providerId })
          }).then((x) => x.json());
          if (r?.ok) appendLog(`绑定 Provider: ${id} -> ${providerId}`);
          else appendLog(`绑定失败: ${r?.error ?? "unknown"}`);
        };
        actions.appendChild(btnBind);

        card.appendChild(actions);
        hireList.appendChild(card);
      }
    };
    renderHire();
    hireFilter.addEventListener("change", renderHire);
    hireEarlyMode.addEventListener("change", renderHire);
    hireSearch.addEventListener("input", renderHire);
    hireClear.onclick = () => {
      hireSearch.value = "";
      renderHire();
    };
    hireSyncAll.onclick = async () => {
      const r = await fetch(`${this.studio.http}/api/hire/sync_all`, { method: "POST" }).then((x) => x.json());
      if (r?.ok && Array.isArray(r.hired)) {
        hiredSet = new Set(r.hired);
        appendLog(`全员在岗：${r.hired.length} 人`);
        renderHire();
        void this.refreshOfficeFromHire();
      } else {
        appendLog(`全员在岗失败：${r?.error ?? "unknown"}`);
      }
    };

    // Agent select
    agentSelect.innerHTML = "";
    for (const id of agentIds) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = agentLabel(id);
      agentSelect.appendChild(opt);
    }

    // Providers
    providersResp = await fetch(`${this.studio.http}/api/providers`).then(
      (r) => r.json() as Promise<{ providers: Array<{ id: string; label: string; pricing?: { outputPer1k?: number }; capabilities?: string[] }>; agentProvider: Record<string, string> }>
    );
    providerSelect.innerHTML = "";
    for (const p of providersResp.providers) {
      const opt = document.createElement("option");
      opt.value = p.id;
      const caps = Array.isArray(p.capabilities) ? p.capabilities : [];
      const canText = caps.includes("text");
      opt.textContent = p.label || p.id;
      if (!canText) {
        opt.disabled = true;
        opt.textContent = `${opt.textContent}（暂不可派单）`;
      }
      providerSelect.appendChild(opt);
    }

    // refresh cloud pricing for coin estimate (best-effort)
    try {
      const cloud = providersResp.providers.find((x) => x.id === "cloud");
      const outPer1k = cloud?.pricing?.outputPer1k;
      if (typeof outPer1k === "number" && Number.isFinite(outPer1k)) this.cloudPricingOutPer1k = outPer1k;
    } catch {
      // ignore
    }
    const applyProviderSel = () => {
      const aid = agentSelect.value;
      const pid = providersResp.agentProvider?.[aid] ?? "local";
      providerSelect.value = pid;
    };
    agentSelect.addEventListener("change", applyProviderSel);
    applyProviderSel();

    bindProviderBtn.onclick = async () => {
      const agentId = agentSelect.value;
      const providerId = providerSelect.value;
      const r = await fetch(`${this.studio.http}/api/providers/bind`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, providerId })
      }).then((x) => x.json());
      if (r?.ok) appendLog(`绑定 Provider: ${agentId} -> ${providerId}`);
      else appendLog(`绑定失败: ${r?.error ?? "unknown"}`);
    };

    const cancelJob = async (jobId: string) => {
      try {
        await fetch(`${this.studio.http}/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
        void refreshQueue();
      } catch { /* ignore */ }
    };
    const deleteJob = async (jobId: string) => {
      try {
        await fetch(`${this.studio.http}/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
        void refreshQueue();
      } catch { /* ignore */ }
    };
    const refreshQueue = async () => {
      try {
        const q = await fetch(`${this.studio.http}/api/queue`).then((r) => r.json() as Promise<{ queue: any[]; running: any[] }>);
        queueOut.textContent = `队列: ${q.queue.filter((j: any) => j.status === "queued").length} 运行中: ${q.running.length}`;
        if (queueDetail) {
          let html = '<div class="muted" style="margin-bottom:4px">运行中</div>';
          if (q.running.length === 0) html += '<div class="muted">-</div>';
          for (const j of q.running) {
            html += `<div class="scoreRow" style="justify-content:space-between;margin:2px 0">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${j.agentId}: ${(j.task ?? "").slice(0, 60)}</span>
              <button class="segBtn" onclick="(window as any).__studioCancelJob__('${j.id}')" style="font-size:10px;padding:2px 8px" title="取消任务">✕ 取消</button>
            </div>`;
          }
          html += '<div class="hr"></div><div class="muted" style="margin-bottom:4px">排队中 · 已完成</div>';
          const shown = q.queue.slice(0, 15);
          if (shown.length === 0) html += '<div class="muted">-</div>';
          for (const j of shown) {
            const canCancel = j.status === "queued";
            const isDone = j.status === "done" || j.status === "failed" || j.status === "cancelled";
            html += `<div class="scoreRow" style="justify-content:space-between;margin:2px 0;opacity:${isDone ? '0.55' : '1'}">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${j.priority} ${j.agentId}: ${(j.task ?? "").slice(0, 50)} <span style="color:var(--muted)">[${j.status}]</span></span>
              ${canCancel ? `<button class="segBtn" onclick="(window as any).__studioCancelJob__('${j.id}')" style="font-size:10px;padding:2px 8px" title="取消">✕ 取消</button>` : ''}
              ${isDone ? `<button class="segBtn" onclick="(window as any).__studioDeleteJob__('${j.id}')" style="font-size:10px;padding:2px 8px;border-color:rgba(255,110,110,0.3)" title="移出队列">🗑</button>` : ''}
            </div>`;
          }
          queueDetail.innerHTML = html;
        }
      } catch { /* ignore */ }
    };
    (window as any).__studioCancelJob__ = cancelJob;
    (window as any).__studioDeleteJob__ = deleteJob;
    setInterval(() => void refreshQueue(), 1200);
    void refreshQueue();

    const refreshFinance = async () => {
      const f = await fetch(`${this.studio.http}/api/finance/summary?range=today`).then((r) => r.json());
      if (finTokens) finTokens.textContent = String(f.tokensEstimated ?? "-");
      if (finReq) finReq.textContent = String(f.requests ?? "-");
      if (finFail) finFail.textContent = String(f.failures ?? 0);
      if (finFailReason) {
        const m = (f?.failuresByReason && typeof f.failuresByReason === "object" ? f.failuresByReason : {}) as Record<string, number>;
        const rows = Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([k, v]) => `${k}:${v}`)
          .join("  ");
        finFailReason.textContent = rows || "-";
      }
      if (finReqByProvider) {
        const m = (f?.requestsByProvider && typeof f.requestsByProvider === "object" ? f.requestsByProvider : {}) as Record<string, number>;
        const rows = Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}:${v}`)
          .join("  ");
        finReqByProvider.textContent = rows || "-";
      }
      if (finCost) finCost.textContent = typeof f.cost === "number" ? `${f.cost.toFixed(4)}` : "-";
    };
    setInterval(() => void refreshFinance(), 2500);
    void refreshFinance();

    if (finReset) {
      finReset.onclick = async () => {
        if (finResetOut) finResetOut.textContent = "清空中...";
        if (finTokens) finTokens.textContent = "-";
        if (finReq) finReq.textContent = "-";
        if (finFail) finFail.textContent = "-";
        if (finFailReason) finFailReason.textContent = "-";
        if (finReqByProvider) finReqByProvider.textContent = "-";
        if (finCost) finCost.textContent = "-";
        try {
          const r = await fetch(`${this.studio.http}/api/finance/reset`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}"
          }).then((x) => x.json());
          if (finResetOut) finResetOut.textContent = r?.ok ? "已清空（今日从现在重新统计）" : `清空失败：${r?.error ?? "unknown"}`;
        } catch (e) {
          if (finResetOut) finResetOut.textContent = `清空失败：${String((e as any)?.message ?? e)}`;
        }
        void refreshFinance();
      };
    }

    // notifyList will be populated by WS secretary feed (job.finished), avoid overwriting here.

    enqueueBtn.onclick = async () => {
      const agentId = agentSelect.value;
      const task = taskInput.value.trim();
      const priority = Number(priorityInput.value);
      if (!task) return;
      const resp = await fetch(`${this.studio.http}/api/queue/enqueue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, task, priority, providerId: providerSelect.value })
      }).then((r) => r.json());
      if (resp?.error) appendLog(`入队失败: ${resp.error}`);
      else appendLog(`入队: ${agentId} / ${task}`);
      taskInput.value = "";
      void refreshQueue();
    };
  }

  private layoutOffice(agentIds: string[]) {
    const grouped = new Map<Dept, string[]>();
    for (const id of agentIds) {
      const d = deptOf(id);
      const arr = grouped.get(d) ?? [];
      arr.push(id);
      grouped.set(d, arr);
    }
    for (const arr of grouped.values()) arr.sort((a, b) => a.localeCompare(b));

    // 相机边界：按等距网格真实包络对称外扩（旧固定 2600×1800 + 700 会导致左侧很快顶死、右侧空拖很远）
    const pan = getIsoGridPanBounds(this.gridW, this.gridH, 380);
    this.officePanBounds.setTo(pan.x, pan.y, pan.width, pan.height);
    this.cameras.main.setBounds(pan.x, pan.y, pan.width, pan.height);

    // Zones in grid coordinates (kairo-like layout)
    const zones: ZoneDef[] = [
      { id: "leadership", title: "领导/制作", gx: 2, gy: 2, gw: 10, gh: 5 },
      { id: "design", title: "策划/设计", gx: 2, gy: 9, gw: 13, gh: 10 },
      { id: "programming", title: "程序/工程", gx: 16, gy: 2, gw: 18, gh: 17 },
      { id: "art_audio", title: "美术/音频", gx: 37, gy: 2, gw: 12, gh: 10 },
      { id: "narrative", title: "叙事/本地化", gx: 37, gy: 14, gw: 12, gh: 6 },
      { id: "qa_release", title: "QA/发布/平台", gx: 37, gy: 22, gw: 12, gh: 8 },
      { id: "other", title: "综合/支持", gx: 2, gy: 20, gw: 13, gh: 8 }
    ];
    this.zones = zones;

    if (this.zoneGfx) this.zoneGfx.destroy();
    const zg = this.add.graphics();
    zg.setDepth(-10);

    // Reset navigation grid
    this.blocked.clear();
    this.staticBlocked.clear();

    // Isometric ground grid (tile images)
    for (let gx = 0; gx < this.gridW; gx++) {
      for (let gy = 0; gy < this.gridH; gy++) {
        const p = isoToScreen(gx, gy);
        const tile = this.add.image(p.x, p.y, "px_iso_floor").setOrigin(0.5, 0);
        tile.setDepth(p.y - 2000);
      }
    }

    // 部门配色
    const deptColor: Record<string, { fill: number; stroke: number }> = {
      leadership: { fill: 0x6366f1, stroke: 0x818cf8 },
      design:     { fill: 0x06b6d4, stroke: 0x22d3ee },
      programming:{ fill: 0x10b981, stroke: 0x34d399 },
      art_audio:  { fill: 0xec4899, stroke: 0xf472b6 },
      narrative:  { fill: 0xf59e0b, stroke: 0xfbbf24 },
      qa_release: { fill: 0xef4444, stroke: 0xf87171 },
      other:      { fill: 0x94a3b8, stroke: 0xcbd5e1 },
    };

    for (const z of zones) {
      const a = isoToScreen(z.gx, z.gy);
      const b = isoToScreen(z.gx + z.gw, z.gy);
      const c = isoToScreen(z.gx + z.gw, z.gy + z.gh);
      const d = isoToScreen(z.gx, z.gy + z.gh);
      const dc = deptColor[z.id] ?? { fill: 0x6366f1, stroke: 0x818cf8 };

      // 底色
      zg.fillStyle(dc.fill, 0.06);
      zg.beginPath();
      zg.moveTo(a.x, a.y);
      zg.lineTo(b.x, b.y);
      zg.lineTo(c.x, c.y);
      zg.lineTo(d.x, d.y);
      zg.closePath();
      zg.fillPath();

      // 外发光边框
      zg.lineStyle(3, dc.stroke, 0.15);
      zg.strokePath();
      zg.lineStyle(1.5, dc.stroke, 0.4);
      zg.strokePath();

      // 部门标签
      const labelPos = isoToScreen(z.gx + 1, z.gy);
      const colStr = "#" + dc.stroke.toString(16).padStart(6, "0");
      this.add.text(labelPos.x - 18, labelPos.y - 18, z.title, {
        fontFamily: "monospace",
        fontSize: "14px",
        color: colStr
      }).setDepth(-9);
    }

    const pubBand = isoToScreen(14, 29);
    this.add.text(pubBand.x - 52, pubBand.y - 36, "公共服务 · 休闲区（点击房门派人进入）", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#9aa8d6",
      fontStyle: "bold"
    }).setDepth(-9);
    this.zoneGfx = zg;

    const placeDept = (dept: Dept) => {
      const list = grouped.get(dept) ?? [];
      const zone = zones.find((z) => z.id === dept);
      if (!zone) return;

      const cols = Math.max(1, zone.gw - 2);

      list.forEach((agentId, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const gx = zone.gx + 1 + col;
        const gy = zone.gy + 1 + row;
        this.spawnDesk(agentId, gx, gy, idx);
      });
    };

    this.desks.clear();
    placeDept("leadership");
    placeDept("design");
    placeDept("programming");
    placeDept("art_audio");
    placeDept("narrative");
    placeDept("qa_release");
    placeDept("other");

    // Scene monitor (programming zone top-right-ish)
    if (this.monitorObj) this.monitorObj.destroy();
    const pg = this.zones.find((z) => z.id === "programming");
    if (pg) {
      const gx = pg.gx + pg.gw - 2;
      const gy = pg.gy + 1;
      const p = isoToScreen(gx, gy);
      const mon = this.add.image(p.x - 10, p.y + 18, "px_prop_monitor").setOrigin(0.5, 1);
      mon.setDepth(p.y + 1200);
      mon.setInteractive({ cursor: "pointer" });
      mon.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        if ((window as any).__STUDIO_MODAL_OPEN__) return;
        if (this.shouldIgnoreGameObjectTap(pointer)) return;
        (window as any).__STUDIO_OPEN_MONITOR__?.();
      });
      this.monitorObj = mon;
    }

    // Dept monitors (one per visible zone)
    for (const m of this.deptMonitors.values()) m.destroy();
    this.deptMonitors.clear();
    for (const z of this.zones) {
      const gx = z.gx + z.gw - 1;
      const gy = z.gy + z.gh - 1;
      const p = isoToScreen(gx, gy);
      const mon = this.add.image(p.x + 22, p.y + 26, "px_prop_monitor").setOrigin(0.5, 1);
      mon.setScale(0.85);
      mon.setDepth(p.y + 1200);
      mon.setInteractive({ cursor: "pointer" });
      mon.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        if ((window as any).__STUDIO_MODAL_OPEN__) return;
        if (this.shouldIgnoreGameObjectTap(pointer)) return;
        (window as any).__STUDIO_OPEN_DEPT__?.(z.id, { agentId: Array.from(this.desks.keys()).find((id) => deptOf(id) === z.id) });
        const stats = this.deptStats(z.id);
        (window as any).__STUDIO_SET_DEPT_STATS__?.(z.id, stats);
      });
      this.deptMonitors.set(z.id, mon);
    }

    if (this.meetingRoomObj) this.meetingRoomObj.destroy();
    const dz = zones.find((z) => z.id === "design");
    if (dz) {
      const gx = dz.gx + 4;
      const gy = dz.gy + dz.gh + 1;
      const p = isoToScreen(gx, gy);
      const mtg = this.add.image(p.x, p.y + 22, "px_prop_monitor").setOrigin(0.5, 1);
      mtg.setScale(0.95);
      mtg.setDepth(p.y + 1250);
      mtg.setInteractive({ cursor: "pointer" });
      this.add.text(p.x - 28, p.y - 8, "会议室", { fontFamily: "monospace", fontSize: "12px", color: "#ffd66e" }).setDepth(p.y + 1251);
      mtg.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        if ((window as any).__STUDIO_MODAL_OPEN__) return;
        if (this.shouldIgnoreGameObjectTap(pointer)) return;
        (window as any).__STUDIO_OPEN_MEETING__?.();
      });
      this.meetingRoomObj = mtg;
    }
  }

  private spawnDesk(agentId: string, gx: number, gy: number, idx: number) {
    const p = isoToScreen(gx, gy);
    const deskX = p.x - 48;
    const deskY = p.y + 46;
    const dept = deptOf(agentId);
    const avatarKey = this.textures.exists(`px_avatar_${dept}`) ? `px_avatar_${dept}` : "px_avatar";
    const desk = this.add.image(deskX, deskY, "px_desk").setOrigin(0, 1);
    const avatar = this.add.image(p.x - 42, p.y + 6, avatarKey).setOrigin(0, 0);
    const statusIcon = this.add.image(p.x - 26, p.y + 4, "px_status_idle").setOrigin(0.5, 0.5);
    const statusText = this.add.text(p.x - 12, p.y - 18, "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#c9d3ff",
      backgroundColor: "rgba(11,16,32,0.78)",
      padding: { left: 6, right: 6, top: 2, bottom: 2 }
    });
    statusText.setOrigin(0, 0.5);
    statusText.setAlpha(0);

    // Agent 名牌颜色跟随部门色
    const deptLabelColor: Record<string, string> = {
      leadership: "#818cf8",
      design:     "#22d3ee",
      programming:"#34d399",
      art_audio:  "#f472b6",
      narrative:  "#fbbf24",
      qa_release: "#f87171",
      other:      "#cbd5e1",
    };
    const labelColor = deptLabelColor[deptOf(agentId)] ?? "#e7ecff";
    const label = this.add.text(p.x - 54, p.y + 82, agentLabel(agentId), {
      fontFamily: "monospace",
      fontSize: "12px",
      color: labelColor
    });
    label.setOrigin(0, 0);

    desk.setDepth(deskY);
    avatar.setDepth(avatar.y + 999);
    statusIcon.setDepth(avatar.y + 1000);
    label.setDepth(avatar.y + 1001);
    statusText.setDepth(avatar.y + 1002);

    // 办公桌屏幕呼吸发光动画
    this.tweens.add({
      targets: desk,
      alpha: { from: 1, to: 0.88 },
      duration: 2000 + Math.random() * 1000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });

    const d: Desk = {
      agentId,
      x: avatar.x,
      y: avatar.y,
      gx,
      gy,
      homeGx: gx,
      homeGy: gy,
      status: "idle",
      label,
      statusIcon,
      statusText,
      avatar,
      desk,
      baseX: avatar.x,
      baseY: avatar.y
    };
    this.desks.set(agentId, d);
    d.lastBreakTripAt = -9e12;

    // 仅挡脚下这一格；若把四周都挡住，A* 无法从工位展开，小人永远不能溜达
    this.setBlocked(gx, gy, true);

    const hit = this.add.rectangle(p.x - 54, p.y + 10, 170, 120, 0x000000, 0);
    hit.setOrigin(0, 0);
    hit.setInteractive({ cursor: "pointer" });
    hit.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if ((window as any).__STUDIO_MODAL_OPEN__) return;
      if (this.shouldIgnoreGameObjectTap(pointer)) return;
      if (pointer.rightButtonReleased()) { this.showAgentContextMenu(agentId, pointer.event as MouseEvent); return; }
      const ev = pointer.event as MouseEvent;
      if (ev?.ctrlKey || ev?.metaKey) {
        if (this.selectedAgentIds.has(agentId)) this.selectedAgentIds.delete(agentId);
        else this.selectedAgentIds.add(agentId);
        this.redrawSelectionRings();
        return;
      }
      this.selectedAgentIds.clear(); this.selectedAgentIds.add(agentId);
      this.selectAgent(agentId);
    });
    d.hit = hit;

    d.bobPhaseMs = 720 + (idx % 9) * 55;
    d.idleBobTween = this.startDeskIdleBob(d);
  }

  private startDeskIdleBob(d: Desk): Phaser.Tweens.Tween {
    return this.tweens.add({
      targets: d.avatar,
      y: d.avatar.y + 2,
      duration: d.bobPhaseMs ?? 760,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        d.statusIcon.setPosition(d.avatar.x + 16, d.avatar.y - 2);
        d.statusText.setPosition(d.avatar.x - 12, d.avatar.y - 18);
        d.label.setPosition(d.avatar.x - 12, d.avatar.y + 76);
        if (d.navHint) {
          d.navHint.setPosition(d.avatar.x + 16, d.avatar.y - 26);
          d.navHint.setDepth(d.avatar.y + 1002);
        }
        if (d.hit) d.hit.setPosition(d.avatar.x - 12, d.avatar.y + 4);
      }
    });
  }

  private setupSelectionUI() {
    const ring = this.add.graphics();
    ring.setDepth(9998);
    this.selectionRing = ring;
  }

  private selectAgent(agentId: string) {
    this.selectedAgentId = agentId;
    appendLog(`选中：${agentId}`);
    this.redrawSelectionRing();
    this.showAgentPopup(agentId);
  }

  private showAgentPopup(agentId: string) {
    // 移除旧浮层
    const old = document.getElementById("agentPopup");
    if (old) old.remove();

    const d = this.desks.get(agentId);
    if (!d) return;

    // 屏幕坐标
    const cam = this.cameras.main;
    const sx = (d.avatar.x - cam.scrollX) * cam.zoom + cam.x;
    const sy = (d.avatar.y - cam.scrollY) * cam.zoom + cam.y;

    const deptZh: Record<string, string> = {
      leadership: "领导/制作", design: "策划/设计", programming: "程序/工程",
      art_audio: "美术/音频", narrative: "叙事/本地化", qa_release: "QA/发布", other: "综合/支持"
    };
    const statusZh: Record<string, string> = {
      idle: "空闲", thinking: "执行中", streaming: "生成中",
      tool: "工具调用", blocked: "排队", error: "异常", offline: "离线"
    };
    const statusTagClass: Record<string, string> = {
      idle: "idle", thinking: "thinking", streaming: "streaming",
      tool: "tool", blocked: "blocked", error: "error", offline: "offline"
    };
    const dept = deptOf(agentId);
    const label = agentLabel(agentId);
    const status = statusZh[d.status] ?? d.status;
    const tagCls = statusTagClass[d.status] ?? "idle";

    // 构建浮层 HTML
    const popup = document.createElement("div");
    popup.id = "agentPopup";
    popup.className = "agentPopup";
    // 定位在 Agent 右侧
    let px = Math.min(sx + 80, window.innerWidth - 340);
    let py = Math.min(sy - 40, window.innerHeight - 250);
    px = Math.max(10, px);
    py = Math.max(10, py);
    popup.style.left = `${px}px`;
    popup.style.top = `${py}px`;

    popup.innerHTML = `
      <div class="agentPopupTitle">
        <span>${label}</span>
        <span class="popupClose" id="popupCloseBtn">&times;</span>
      </div>
      <div class="agentPopupRow">
        <span class="agentPopupLabel">部门</span>
        <span class="agentPopupValue">${deptZh[dept] ?? dept}</span>
      </div>
      <div class="agentPopupRow">
        <span class="agentPopupLabel">状态</span>
        <span class="agentPopupTag ${tagCls}">${status}</span>
      </div>
      <div class="agentPopupRow">
        <span class="agentPopupLabel">工位</span>
        <span class="agentPopupValue">(${d.gx}, ${d.gy})</span>
      </div>
      <div class="hr"></div>
      <div class="label" style="margin-bottom:4px">快速派单</div>
      <input id="popupTaskInput" placeholder="一句话任务…" style="width:100%;box-sizing:border-box;margin-bottom:4px" />
      <div class="row2" style="margin-bottom:4px">
        <select id="popupPriority" style="flex:0 0 auto;width:80px">
          <option value="0">普通</option>
          <option value="1">优先</option>
          <option value="2">紧急</option>
        </select>
        <button class="btnPrimary" id="popupBtnDispatch" style="flex:1">派单</button>
      </div>
      <div class="row2" style="justify-content:center;margin-bottom:0">
        <button class="menuBtn" id="popupBtnDept">部门看板</button>
        <button class="menuBtn" id="popupBtnLog">最近事件</button>
      </div>
    `;
    document.body.appendChild(popup);

    // 关闭
    const closeBtn = document.getElementById("popupCloseBtn");
    if (closeBtn) closeBtn.onclick = () => popup.remove();

    // 快速派单
    const dispatchBtn = document.getElementById("popupBtnDispatch");
    const taskInput = document.getElementById("popupTaskInput") as HTMLInputElement | null;
    const prioritySel = document.getElementById("popupPriority") as HTMLSelectElement | null;
    if (dispatchBtn) dispatchBtn.onclick = async () => {
      const task = taskInput?.value?.trim();
      if (!task) { showToast("请输入任务描述", "warn"); return; }
      const prio = parseInt(prioritySel?.value ?? "0", 10);
      try {
        const r = await fetch(`${this.studio.http}/api/queue/enqueue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId, task, priority: prio }) });
        const data = await r.json() as any;
        if (data.ok) { showToast(`已派单给 ${label}`, "success"); popup.remove(); }
        else { showToast(`派单失败：${data.error ?? ""}`, "error"); }
      } catch { showToast("网络错误，派单失败", "error"); }
    };

    // 部门看板 → 打开部门
    const deptBtn = document.getElementById("popupBtnDept");
    if (deptBtn) deptBtn.onclick = () => { popup.remove(); Drawer.open("dept"); };

    // 最近事件 → 切换到日志Tab
    const logBtn = document.getElementById("popupBtnLog");
    if (logBtn) logBtn.onclick = () => { popup.remove(); document.querySelector<HTMLButtonElement>('[data-hud-tab="log"]')?.click(); };

    // 点击其他地方关闭
    const closeHandler = (ev: MouseEvent) => {
      if (!popup.contains(ev.target as Node)) {
        popup.remove();
        window.removeEventListener("mousedown", closeHandler);
      }
    };
    window.addEventListener("mousedown", closeHandler);
  }

  /** Agent 右键菜单 */
  private showAgentContextMenu(agentId: string, ev: MouseEvent) {
    const old = document.getElementById("ctxMenu"); if (old) old.remove();
    const menu = document.createElement("div");
    menu.id = "ctxMenu"; menu.className = "contextMenu";
    menu.style.left = `${ev.clientX}px`; menu.style.top = `${ev.clientY}px`;
    const label = agentLabel(agentId);
    menu.innerHTML = `
      <button class="contextMenuItem" data-act="dispatch">📋 派单给 ${label}</button>
      <button class="contextMenuItem" data-act="detail">🔍 查看详情</button>
      <div class="contextMenuDivider"></div>
      <button class="contextMenuItem" data-act="rest">☕ 送去休息</button>
      <button class="contextMenuItem" data-act="home">🏠 召回工位</button>
      <div class="contextMenuDivider"></div>
      <button class="contextMenuItem danger" data-act="dismiss">✕ 解雇</button>
    `;
    document.body.appendChild(menu);
    const close = () => menu.remove();
    menu.querySelectorAll(".contextMenuItem").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = (btn as HTMLElement).dataset.act;
        if (act === "dispatch") { close(); this.selectAgent(agentId); }
        else if (act === "detail") { close(); this.selectAgent(agentId); }
        else if (act === "rest") { close(); this.sendAgentToBreak(agentId); }
        else if (act === "home") { close(); this.recallAgentHome(agentId); }
        else if (act === "dismiss") {
          close();
          showConfirm(`确定解雇 ${label}？`, "Agent 将被移出工作室，可稍后在招聘中心重新雇佣。", () => {
            void fetch(`${this.studio.http}/api/hire?agentId=${encodeURIComponent(agentId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hired: false }) });
            showToast(`${label} 已解雇`, "warn");
          });
        }
      });
    });
    const closeH = (e: MouseEvent) => { if (!menu.contains(e.target as Node)) { close(); window.removeEventListener("mousedown", closeH); } };
    window.addEventListener("mousedown", closeH);
  }

  /** 多选选择环 */
  private redrawSelectionRings() {
    if (!this.selectionRing) return;
    this.selectionRing.clear();
    for (const id of this.selectedAgentIds) {
      const d = this.desks.get(id); if (!d) continue;
      this.selectionRing.lineStyle(2, 0x6ee7ff, 0.7);
      this.selectionRing.strokeRoundedRect(d.avatar.x - 14, d.avatar.y - 8, 160, 120, 8);
    }
  }

  private sendAgentToBreak(agentId: string) {
    const d = this.desks.get(agentId);
    if (!d) return;
    d.breakReturnAfterAt = -1;
    d.lastBreakTripAt = -1;
    showToast(`${agentLabel(agentId)} 已送去休息`, "info");
  }

  private recallAgentHome(agentId: string) {
    const d = this.desks.get(agentId);
    if (!d || (d.gx === d.homeGx && d.gy === d.homeGy)) return;
    d.gx = d.homeGx; d.gy = d.homeGy;
    d.breakReturnAfterAt = undefined;
    const p = isoToScreen(d.homeGx, d.homeGy);
    d.avatar.setPosition(p.x - 42, p.y + 6);
    showToast(`${agentLabel(agentId)} 已召回工位`, "info");
  }

  private clearDeskNavVisual(d: Desk) {
    d.navPathGfx?.destroy();
    d.navPathGfx = undefined;
    d.navHint?.destroy();
    d.navHint = undefined;
  }

  private navGoalLabel(toGx: number, toGy: number, d: Desk): string {
    if (toGx === d.homeGx && toGy === d.homeGy) return "回家";
    const r = this.roomGrid.find((room) => room.doorGx === toGx && room.doorGy === toGy);
    if (r) return `→${r.title}`;
    return `→${toGx},${toGy}`;
  }

  private showDeskNavRoute(d: Desk, path: Array<{ gx: number; gy: number }>, fromGx: number, fromGy: number, toGx: number, toGy: number) {
    this.clearDeskNavVisual(d);
    const label = this.navGoalLabel(toGx, toGy, d);
    const hintText = this.add.text(d.avatar.x + 16, d.avatar.y - 26, `${label} · ${path.length}步`, {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#a5f3fc",
      backgroundColor: "#0f172a",
      padding: { left: 5, right: 5, top: 2, bottom: 2 }
    });
    hintText.setOrigin(0.5, 1);
    hintText.setDepth(d.avatar.y + 1002);
    d.navHint = hintText;

    const pts: { x: number; y: number }[] = [];
    const p0 = isoToScreen(fromGx, fromGy);
    pts.push({ x: p0.x, y: p0.y - 6 });
    for (const step of path) {
      const p = isoToScreen(step.gx, step.gy);
      pts.push({ x: p.x, y: p.y - 6 });
    }
    const minY = Math.min(...pts.map((q) => q.y));
    const g = this.add.graphics();
    g.setDepth(minY - 2500);
    g.lineStyle(2, 0x5eead4, 0.55);
    for (let i = 0; i < pts.length - 1; i++) {
      g.lineBetween(pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y);
    }
    d.navPathGfx = g;
  }

  private redrawSelectionRing() {
    if (!this.selectionRing) return;
    this.selectionRing.clear();
    if (!this.selectedAgentId) return;
    const d = this.desks.get(this.selectedAgentId);
    if (!d) return;
    this.selectionRing.lineStyle(3, 0x6ee7ff, 0.9);
    this.selectionRing.strokeRoundedRect(d.avatar.x - 16, d.avatar.y - 10, 180, 128, 10);
  }

  /** 路径有效并已启动位移链时返回 true */
  private moveAgentGrid(agentId: string, toGx: number, toGy: number): boolean {
    const d = this.desks.get(agentId);
    if (!d) return false;

    if (d.moving) return false;
    const fromGx = d.gx;
    const fromGy = d.gy;
    if (fromGx === toGx && fromGy === toGy) {
      d.pendingGx = undefined;
      d.pendingGy = undefined;
      return false;
    }
    let path = this.astar({ gx: fromGx, gy: fromGy }, { gx: toGx, gy: toGy });
    if (!path || path.length === 0) {
      path = [{ gx: toGx, gy: toGy }];
      appendLog(`${agentId} 无路网，直线移动到 (${toGx},${toGy})`);
    }

    this.showDeskNavRoute(d, path, fromGx, fromGy, toGx, toGy);

    d.pendingGx = toGx;
    d.pendingGy = toGy;
    d.moving = true;
    d.idleBobTween?.stop();
    d.idleBobTween = undefined;
    this.tweens.killTweensOf(d.avatar);

    this.setBlocked(fromGx, fromGy, false);
    const last = path[path.length - 1]!;
    this.setBlocked(last.gx, last.gy, true);

    const syncFollowers = () => {
      d.statusIcon.setPosition(d.avatar.x + 16, d.avatar.y - 2);
      d.statusText.setPosition(d.avatar.x - 12, d.avatar.y - 18);
      d.label.setPosition(d.avatar.x - 12, d.avatar.y + 76);
      d.avatar.setDepth(d.avatar.y + 999);
      d.statusIcon.setDepth(d.avatar.y + 1000);
      d.label.setDepth(d.avatar.y + 1001);
      d.statusText.setDepth(d.avatar.y + 1002);
      if (d.navHint) {
        d.navHint.setPosition(d.avatar.x + 16, d.avatar.y - 26);
        d.navHint.setDepth(d.avatar.y + 1002);
      }
      if (d.hit) d.hit.setPosition(d.avatar.x - 12, d.avatar.y + 4);
      this.redrawSelectionRing();
    };

    d.statusIcon.setTexture("px_status_thinking");

    const finishWalk = () => {
      d.pendingGx = undefined;
      d.pendingGy = undefined;
      d.gx = toGx;
      d.gy = toGy;
      d.moving = false;
      d.x = d.avatar.x;
      d.y = d.avatar.y;
      syncFollowers();
      this.clearDeskNavVisual(d);
      d.idleBobTween = this.startDeskIdleBob(d);
      d.statusIcon.setTexture(statusKey(d.status));

      const atHome = d.gx === d.homeGx && d.gy === d.homeGy;
      if (atHome) d.breakReturnAfterAt = undefined;
      else d.breakReturnAfterAt = this.time.now + OFFICE_NAV_THREE_RULES.breakLingerBaseMs + Math.random() * 9000;
    };

    const runStep = (index: number) => {
      if (index >= path.length) {
        finishWalk();
        return;
      }
      const step = path[index]!;
      const p = isoToScreen(step.gx, step.gy);
      const ax = p.x - 42;
      const ay = p.y + 6;
      const dist = Math.hypot(ax - d.avatar.x, ay - d.avatar.y);
      const duration = Math.max(140, Math.round(320 + Math.min(420, dist * 5.5)));
      this.tweens.add({
        targets: d.avatar,
        x: ax,
        y: ay,
        duration,
        ease: "Cubic.easeInOut",
        onUpdate: () => syncFollowers(),
        onComplete: () => runStep(index + 1)
      });
    };

    runStep(0);
    return true;
  }

  /** 队列 job.started 时若人还在公共设施等格子，逻辑上已「回工位干活」，同步网格与精灵避免花名册误报「未回工位」 */
  private ensureAgentAtDeskForJob(agentId: string) {
    const d = this.desks.get(agentId);
    if (!d || d.inBanter) return;
    if (d.gx === d.homeGx && d.gy === d.homeGy) return;

    if (d.moving) {
      this.tweens.killTweensOf(d.avatar);
      d.moving = false;
    }
    d.idleBobTween?.stop();
    d.idleBobTween = undefined;
    this.clearDeskNavVisual(d);

    this.setBlocked(d.gx, d.gy, false);
    d.pendingGx = undefined;
    d.pendingGy = undefined;
    d.gx = d.homeGx;
    d.gy = d.homeGy;

    const p = isoToScreen(d.homeGx, d.homeGy);
    const ax = p.x - 42;
    const ay = p.y + 6;
    d.avatar.setPosition(ax, ay);
    d.x = ax;
    d.y = ay;
    this.setBlocked(d.homeGx, d.homeGy, true);

    d.statusIcon.setPosition(d.avatar.x + 16, d.avatar.y - 2);
    d.statusText.setPosition(d.avatar.x - 12, d.avatar.y - 18);
    d.label.setPosition(d.avatar.x - 12, d.avatar.y + 76);
    d.avatar.setDepth(d.avatar.y + 999);
    d.statusIcon.setDepth(d.avatar.y + 1000);
    d.label.setDepth(d.avatar.y + 1001);
    d.statusText.setDepth(d.avatar.y + 1002);
    if (d.hit) d.hit.setPosition(d.avatar.x - 12, d.avatar.y + 4);
    d.breakReturnAfterAt = undefined;
    d.idleBobTween = this.startDeskIdleBob(d);
    d.statusIcon.setTexture(statusKey(d.status));
    this.redrawSelectionRing();
  }

  private setupRooms() {
    // 与工区同一等距地图：公共服务带在楼层下方（不占右上角 HUD 条）
    this.roomGrid = [
      { id: "meeting", title: "会议室", locked: false, gx: 3, gy: 29, gw: 6, gh: 4, doorGx: 5, doorGy: 32, capacity: 6 },
      { id: "cafe", title: "咖啡室", locked: false, gx: 10, gy: 29, gw: 5, gh: 4, doorGx: 12, doorGy: 32, capacity: 4 },
      { id: "cafe2", title: "茶室", locked: false, gx: 16, gy: 29, gw: 4, gh: 4, doorGx: 18, doorGy: 32, capacity: 3 },
      { id: "restroom", title: "卫生间", locked: false, gx: 21, gy: 29, gw: 3, gh: 3, doorGx: 22, doorGy: 31, capacity: 2 },
      { id: "gym", title: "健身室", locked: true, gx: 25, gy: 29, gw: 5, gh: 4, doorGx: 27, doorGy: 32, capacity: 3 },
      { id: "arcade", title: "游戏机室", locked: true, gx: 31, gy: 29, gw: 5, gh: 4, doorGx: 33, doorGy: 32, capacity: 3 },
      { id: "pool", title: "桌球室", locked: true, gx: 37, gy: 29, gw: 4, gh: 4, doorGx: 39, doorGy: 32, capacity: 2 },
      { id: "library", title: "图书室", locked: false, gx: 42, gy: 29, gw: 4, gh: 4, doorGx: 44, doorGy: 32, capacity: 3 },
      { id: "crossdress", title: "女装大佬室", locked: false, gx: 47, gy: 29, gw: 6, gh: 3, doorGx: 50, doorGy: 28, capacity: 4, allowedDepts: ["programming", "art_audio"] }
    ];

    for (const room of this.roomGrid) {
      this.renderIsoRoom(room);
      const cx = isoToScreen(room.gx + Math.floor(room.gw / 2), room.gy);
      this.add
        .text(cx.x - 28, cx.y - 26, room.title, {
          fontFamily: "monospace",
          fontSize: "12px",
          color: room.locked ? "#6a7190" : "#ffd66e"
        })
        .setDepth(cx.y + 800);

      const dp = isoToScreen(room.doorGx, room.doorGy);
      const hit = this.add.rectangle(dp.x, dp.y + 12, 56, 40, 0x000000, 0);
      hit.setDepth(dp.y + 2500);
      hit.setInteractive({ useHandCursor: true });
      hit.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        if ((window as any).__STUDIO_MODAL_OPEN__) return;
        if (this.shouldIgnoreGameObjectTap(pointer)) return;
        void this.onIsoRoomClick(room);
      });
    }
  }

  private isAgentInsideRoomBounds(d: Desk, room: IsoRoomDef): boolean {
    return d.gx >= room.gx && d.gx < room.gx + room.gw && d.gy >= room.gy && d.gy < room.gy + room.gh;
  }

  private isGridInsideRoom(room: IsoRoomDef, gx: number, gy: number): boolean {
    return gx >= room.gx && gx < room.gx + room.gw && gy >= room.gy && gy < room.gy + room.gh;
  }

  /** 已在房内或已预约进入该房（移动中） */
  private isAgentCommittedToRoom(d: Desk, room: IsoRoomDef): boolean {
    if (this.isAgentInsideRoomBounds(d, room)) return true;
    if (d.pendingGx != null && d.pendingGy != null) {
      return this.isGridInsideRoom(room, d.pendingGx, d.pendingGy);
    }
    return false;
  }

  private countAgentsInRoom(room: IsoRoomDef): number {
    let n = 0;
    for (const d of this.desks.values()) {
      if (this.isAgentCommittedToRoom(d, room)) n++;
    }
    return n;
  }

  private isCellTakenByAgent(gx: number, gy: number, exceptAgentId?: string): boolean {
    for (const d of this.desks.values()) {
      if (d.agentId === exceptAgentId) continue;
      if (d.gx === gx && d.gy === gy) return true;
      if (d.pendingGx === gx && d.pendingGy === gy) return true;
    }
    return false;
  }

  private roomStandCandidates(room: IsoRoomDef): Array<{ gx: number; gy: number }> {
    const c: Array<{ gx: number; gy: number }> = [];
    for (let y = room.gy; y < room.gy + room.gh; y++) {
      for (let x = room.gx; x < room.gx + room.gw; x++) {
        if (x === room.doorGx && y === room.doorGy) continue;
        c.push({ gx: x, gy: y });
      }
    }
    const distDoor = (p: { gx: number; gy: number }) => Math.abs(p.gx - room.doorGx) + Math.abs(p.gy - room.doorGy);
    c.sort((a, b) => distDoor(a) - distDoor(b));
    return c;
  }

  /** 房间内空位（按容量与格子占用）；满员返回 null */
  private findFreeRoomStand(room: IsoRoomDef, exceptAgentId: string): { gx: number; gy: number } | null {
    if (room.locked) return null;
    const self = this.desks.get(exceptAgentId);
    const selfIn = self ? this.isAgentCommittedToRoom(self, room) : false;
    let occ = this.countAgentsInRoom(room);
    if (selfIn) occ--;
    if (occ >= room.capacity) return null;
    for (const p of this.roomStandCandidates(room)) {
      if (self && self.gx === p.gx && self.gy === p.gy && !self.moving) continue;
      if (!this.isCellTakenByAgent(p.gx, p.gy, exceptAgentId)) {
        if (self) {
          self.pendingGx = p.gx;
          self.pendingGy = p.gy;
        }
        return p;
      }
    }
    return null;
  }

  private roomFullAngry(agentId: string, roomTitle: string) {
    const d = this.desks.get(agentId);
    if (!d) return;
    appendLog(`${agentLabel(agentId)} 想进${roomTitle}但已满，在外面生气`);
    this.showBubble(d, "怎么又满了…");
    d.statusIcon.setTexture("px_status_error");
    this.time.delayedCall(1500, () => {
      if (!d.moving && !d.inBanter) d.statusIcon.setTexture(statusKey(d.status));
    });
  }

  private canAgentEnterRoom(agentId: string, room: IsoRoomDef): boolean {
    const allow = room.allowedDepts;
    if (!allow || allow.length === 0) return true;
    return allow.includes(deptOf(agentId));
  }

  /** 有任务（非空闲）：应回工位，在外面摸鱼则进度卡住（示意） */
  private agentHasActiveWork(agentId: string): boolean {
    const s = this.state.agents[agentId]?.status ?? "idle";
    return s !== "idle";
  }

  private pickRandomRoamCell(d: Desk): { gx: number; gy: number } | null {
    for (let t = 0; t < 22; t++) {
      const gx = clamp(d.gx + (((Math.random() * 11) | 0) - 5), 0, this.gridW - 1);
      const gy = clamp(d.gy + (((Math.random() * 11) | 0) - 5), 0, this.gridH - 1);
      const k = this.key(gx, gy);
      if (this.staticBlocked.has(k)) continue;
      if (this.isCellTakenByAgent(gx, gy, d.agentId)) continue;
      return { gx, gy };
    }
    return null;
  }

  private warnOffDeskWorkers() {
    const now = this.time.now;
    for (const d of this.desks.values()) {
      if (d.moving || d.inBanter) continue;
      if (!this.agentHasActiveWork(d.agentId)) continue;
      const atHome = d.gx === d.homeGx && d.gy === d.homeGy;
      if (atHome) continue;
      if ((d.lastOffDeskWarnAt ?? 0) + 10_000 > now) continue;
      d.lastOffDeskWarnAt = now;
      appendLog(`${agentLabel(d.agentId)} 未回工位，任务进度卡住（示意）`);
      this.showBubble(d, "得回工位才能推进…");
    }
  }

  private tickBanter() {
    if (Math.random() > 0.42) return;
    const idle = Array.from(this.desks.values()).filter(
      (d) =>
        !d.moving &&
        !d.inBanter &&
        !this.agentHasActiveWork(d.agentId) &&
        (this.state.agents[d.agentId]?.status ?? "idle") === "idle"
    );
    if (idle.length < 2) return;
    const a = idle[(Math.random() * idle.length) | 0]!;
    const near = idle.filter((b) => {
      if (b.agentId === a.agentId) return false;
      return Math.abs(b.gx - a.gx) + Math.abs(b.gy - a.gy) <= 11;
    });
    if (near.length === 0) return;
    const b = near[(Math.random() * near.length) | 0]!;
    const linesA = ["你听说了吗…", "这需求谁写的", "咖啡机又坏了？", "中午吃啥", "老板在吗"];
    const linesB = ["别吧…", "真的假的", "服了", "摸会儿鱼先", "行行行"];
    a.inBanter = true;
    b.inBanter = true;
    const la = linesA[(Math.random() * linesA.length) | 0]!;
    const lb = linesB[(Math.random() * linesB.length) | 0]!;
    this.showBubble(a, la);
    a.statusIcon.setTexture("px_status_thinking");
    this.time.delayedCall(800, () => {
      this.showBubble(b, lb);
      b.statusIcon.setTexture("px_status_streaming");
    });
    this.time.delayedCall(2100, () => {
      a.statusIcon.setTexture(statusKey(a.status));
      b.statusIcon.setTexture(statusKey(b.status));
      a.inBanter = false;
      b.inBanter = false;
    });
  }

  private async onIsoRoomClick(room: IsoRoomDef) {
    if (room.locked) {
      appendLog(`房间未开放：${room.title}`);
      return;
    }
    const agentId = this.selectedAgentId;
    if (!agentId) {
      appendLog(`请先点选一个小人，再点房门进入：${room.title}`);
      return;
    }
    if (!this.canAgentEnterRoom(agentId, room)) {
      appendLog(`只有程序组和美术组会去：${room.title}`);
      return;
    }
    const selDesk = this.desks.get(agentId);
    if (!selDesk) return;
    if (selDesk.moving) {
      appendLog(`${agentLabel(agentId)} 正在移动，稍后再进房`);
      return;
    }

    const spot = this.findFreeRoomStand(room, agentId);
    if (!spot) {
      this.roomFullAngry(agentId, room.title);
      return;
    }
    this.moveAgentGrid(agentId, spot.gx, spot.gy);

    await fetch(`${this.studio.http}/api/emit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "room.enter",
        agentId,
        payload: { roomId: room.id, roomTitle: room.title }
      })
    }).catch(() => undefined);

    await fetch(`${this.studio.http}/api/emit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "agent.assign",
        agentId,
        payload: { task: `去${room.title}` }
      })
    }).catch(() => undefined);

    appendLog(`${agentId} → ${room.title}`);
  }

  private updateAgentRosterHud() {
    const el = document.getElementById("agentRoster");
    if (!el || this.zones.length === 0) return;
    const rows: string[] = [];
    const sorted = Array.from(this.desks.entries()).sort((a, b) => agentLabel(a[0]).localeCompare(agentLabel(b[0]), "zh-CN"));
    for (const [id, desk] of sorted) {
      const st = this.state.agents[id];
      const status = st?.status ?? "idle";
      const rid = st?.roomId ? String(st.roomId) : "";
      let where = rid ? (ROOM_ZONE_ZH[rid] ?? rid) : zoneTitleAt(desk.gx, desk.gy, this.zones);
      if (!rid && desk.moving) where = `${where}·移动`;
      if (!rid && this.agentHasActiveWork(id) && (desk.gx !== desk.homeGx || desk.gy !== desk.homeGy)) where = `${where}·未回工位`;
      const sum = (st?.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 36);
      let label = agentStatusZh(status);
      if (rid && status === "thinking") label = "活动";
      const rsCls =
        status === "thinking" || status === "streaming" || status === "tool"
          ? "run"
          : status === "blocked"
            ? "wait"
            : "";
      const safeTitle = sum.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      rows.push(
        `<div class="rosterRow"><span class="rn">${agentLabel(id)}</span><span class="rs ${rsCls}">${label}</span><span class="rw">${where}</span><span class="rt" title="${safeTitle}">${sum || "—"}</span></div>`
      );
    }
    el.innerHTML = `<div class="rosterHead"><span>角色</span><span>状态</span><span>位置</span><span>摘要</span></div>${rows.join("")}`;
  }

  private applyState() {
    for (const [agentId, desk] of this.desks) {
      const st = this.state.agents[agentId];
      const status = st?.status ?? "idle";
      desk.status = status;
      // 移动中 / 闲聊中不要被 WS 刷掉头顶图
      if (!desk.inBanter) {
        if (!desk.moving) desk.statusIcon.setTexture(statusKey(status));
        else desk.statusIcon.setTexture("px_status_thinking");
      }

      const summary = st?.summary ? String(st.summary) : "";
      if (summary && status !== "streaming" && this.time.now - (desk.lastBubbleAt ?? 0) > 450) {
        this.showBubble(desk, summary.slice(0, 60));
      }

      // 头顶状态条：让用户一眼看到"在干嘛"
      const showText = status !== "idle" && status !== "offline";
      if (!showText) {
        desk.statusText.setAlpha(0);
      } else {
        const sZh = agentStatusZh(status);
        const rawTask =
          status === "streaming"
            ? String(st?.streamDraft ?? "")
            : status === "blocked"
              ? String(st?.summary ?? "")
              : String(st?.summary ?? "");
        const t = rawTask.replace(/\s+/g, " ").trim();
        const snip = t ? t.slice(0, 14) : "";
        desk.statusText.setText(snip ? `${sZh} · ${snip}` : sZh);
        desk.statusText.setAlpha(0.95);
      }
    }
    this.updateAgentRosterHud();
    this.redrawSelectionRing();
  }

  private key(gx: number, gy: number) {
    return `${gx},${gy}`;
  }

  /** 仅小人占格（工位），不参与静态寻路阻挡 */
  private setBlocked(gx: number, gy: number, on: boolean) {
    if (gx < 0 || gy < 0 || gx >= this.gridW || gy >= this.gridH) return;
    const k = this.key(gx, gy);
    if (on) this.blocked.add(k);
    else this.blocked.delete(k);
  }

  /** 墙体、房间地毯等；同时写入 blocked 供「能否站人」判断 */
  private setStaticBlock(gx: number, gy: number, on: boolean) {
    if (gx < 0 || gy < 0 || gx >= this.gridW || gy >= this.gridH) return;
    const k = this.key(gx, gy);
    if (on) {
      this.staticBlocked.add(k);
      this.blocked.add(k);
    } else {
      this.staticBlocked.delete(k);
      this.blocked.delete(k);
    }
  }

  private isWalkable(gx: number, gy: number) {
    if (gx < 0 || gy < 0 || gx >= this.gridW || gy >= this.gridH) return false;
    return !this.blocked.has(this.key(gx, gy));
  }

  /** 4 邻格 BFS（等权）；原 A* 开放集未 decrease-key，复杂图上易找不到路 */
  private astar(start: { gx: number; gy: number }, goal: { gx: number; gy: number }) {
    const startKey = this.key(start.gx, start.gy);
    const goalKey = this.key(goal.gx, goal.gy);
    if (startKey === goalKey) return [];

    const decode = (k: string) => {
      const [x, y] = k.split(",").map((n) => Number(n));
      return { gx: x, gy: y };
    };

    const neighbors = (p: { gx: number; gy: number }) => [
      { gx: p.gx + 1, gy: p.gy },
      { gx: p.gx - 1, gy: p.gy },
      { gx: p.gx, gy: p.gy + 1 },
      { gx: p.gx, gy: p.gy - 1 }
    ];

    const queue: string[] = [startKey];
    const cameFrom = new Map<string, string>();
    const visited = new Set<string>([startKey]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === goalKey) {
        const path: Array<{ gx: number; gy: number }> = [];
        let cur = current;
        while (cur !== startKey) {
          path.push(decode(cur));
          cur = cameFrom.get(cur)!;
        }
        path.reverse();
        return path;
      }

      const cp = decode(current);
      for (const nb of neighbors(cp)) {
        if (!this.walkableForAstar(nb, startKey, goalKey)) continue;
        const nk = this.key(nb.gx, nb.gy);
        if (visited.has(nk)) continue;
        visited.add(nk);
        cameFrom.set(nk, current);
        queue.push(nk);
      }
    }
    return null;
  }

  /** A* 可穿过他人占格，只挡 staticBlocked（否则工区密集时几乎无路） */
  private walkableForAstar(nb: { gx: number; gy: number }, startKey: string, goalKey: string) {
    const nk = this.key(nb.gx, nb.gy);
    if (nk === startKey || nk === goalKey) return true;
    if (nb.gx < 0 || nb.gy < 0 || nb.gx >= this.gridW || nb.gy >= this.gridH) return false;
    return !this.staticBlocked.has(nk);
  }

  private renderIsoRoom(room: IsoRoomDef) {
    // Carpet tiles (interior)
    for (let x = room.gx; x < room.gx + room.gw; x++) {
      for (let y = room.gy; y < room.gy + room.gh; y++) {
        const p = isoToScreen(x, y);
        const img = this.add.image(p.x, p.y, room.locked ? "px_iso_floor" : "px_iso_carpet").setOrigin(0.5, 0);
        img.setDepth(p.y - 1500);
        // 未锁房间：室内可走，小人分站；锁房间仍挡室内（仅门线外示意）
        if (room.locked && !(x === room.doorGx && y === room.doorGy)) this.setStaticBlock(x, y, true);
      }
    }

    // Walls around perimeter (simple)
    const wallDepthBoost = 60;
    const placeWall = (gx: number, gy: number, isDoor: boolean) => {
      const p = isoToScreen(gx, gy);
      const key = isDoor ? "px_iso_door" : "px_iso_wall";
      const w = this.add.image(p.x, p.y - 18, key).setOrigin(0.5, 0);
      w.setDepth(p.y + wallDepthBoost);
      this.setStaticBlock(gx, gy, true);
    };

    for (let x = room.gx; x < room.gx + room.gw; x++) {
      placeWall(x, room.gy - 1, x === room.doorGx && room.gy - 1 === room.doorGy, false);
      placeWall(x, room.gy + room.gh, x === room.doorGx && room.gy + room.gh === room.doorGy, false);
    }
    for (let y = room.gy; y < room.gy + room.gh; y++) {
      placeWall(room.gx - 1, y, room.gx - 1 === room.doorGx && y === room.doorGy, false);
      placeWall(room.gx + room.gw, y, room.gx + room.gw === room.doorGx && y === room.doorGy, false);
    }

    // Door
    placeWall(room.doorGx, room.doorGy, true);
    this.setStaticBlock(room.doorGx, room.doorGy, false); // allow queueing at door

    // 门格四邻曾被地毯/外墙占满，在 4 邻寻路里门会变成「孤岛」→ 只能直线兜底。打通门外可走格。
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0]
    ] as const) {
      const nx = room.doorGx + dx;
      const ny = room.doorGy + dy;
      this.setStaticBlock(nx, ny, false);
    }
  }

  private tickWander() {
    void OFFICE_NAV_THREE_RULES.deskSlackThenPublicOnly;
    const now = this.time.now;
    const roamAgents = Array.from(this.desks.values()).filter((d) => !d.moving && !d.inBanter);
    if (roamAgents.length === 0) return;

    const atHome = (d: Desk) => d.gx === d.homeGx && d.gy === d.homeGy;

    const workersOffDesk = roamAgents.filter((d) => this.agentHasActiveWork(d.agentId) && !atHome(d));
    if (workersOffDesk.length) {
      const d = workersOffDesk[(Math.random() * workersOffDesk.length) | 0]!;
      if (this.moveAgentGrid(d.agentId, d.homeGx, d.homeGy)) d.lastWanderAt = now;
      return;
    }

    const toReturn = roamAgents.filter(
      (d) => !this.agentHasActiveWork(d.agentId) && !atHome(d) && d.breakReturnAfterAt != null && now >= d.breakReturnAfterAt
    );
    if (toReturn.length) {
      const d = toReturn[(Math.random() * toReturn.length) | 0]!;
      if (this.moveAgentGrid(d.agentId, d.homeGx, d.homeGy)) d.lastWanderAt = now;
      return;
    }

    const atDesk = roamAgents.filter(atHome);
    if (atDesk.length === 0) return;

    const eligibleBreak = atDesk.filter(
      (d) =>
        !d.moving &&
        !this.agentHasActiveWork(d.agentId) &&
        (d.lastBreakTripAt ?? 0) + OFFICE_NAV_THREE_RULES.minMsBetweenBreaks < now
    );
    if (eligibleBreak.length === 0) return;

    eligibleBreak.sort((a, b) => a.agentId.localeCompare(b.agentId));
    const pick = eligibleBreak[this.wanderRoundRobin % eligibleBreak.length]!;
    this.wanderRoundRobin++;

    if ((pick.lastWanderAt ?? 0) + 250 > now) return;

    if (Math.random() < 0.28) {
      const cell = this.pickRandomRoamCell(pick);
      if (cell && this.moveAgentGrid(pick.agentId, cell.gx, cell.gy)) {
        pick.lastWanderAt = now;
        pick.lastBreakTripAt = now;
        return;
      }
    }

    const rooms = [...this.roomGrid.filter((r) => !r.locked && this.canAgentEnterRoom(pick.agentId, r))].sort(() => Math.random() - 0.5);
    for (const room of rooms) {
      const spot = this.findFreeRoomStand(room, pick.agentId);
      if (!spot) continue;
      if (this.moveAgentGrid(pick.agentId, spot.gx, spot.gy)) {
        pick.lastWanderAt = now;
        pick.lastBreakTripAt = now;
        return;
      }
    }
  }

  private showBubble(desk: Desk, text: string) {
    if (desk.bubble) desk.bubble.destroy();
    const bubble = this.add.text(desk.avatar.x + 10, desk.avatar.y - 8, text, {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#0b1020",
      backgroundColor: "#e7ecff",
      padding: { left: 8, right: 8, top: 5, bottom: 5 }
    });
    bubble.setOrigin(0, 1);
    bubble.setAlpha(0.95);
    desk.bubble = bubble;
    desk.lastBubbleAt = this.time.now;

    this.tweens.add({
      targets: bubble,
      alpha: 0,
      duration: 1200,
      delay: 1600,
      onComplete: () => bubble.destroy()
    });
  }

  private async bootstrapTail() {
    const tail = await fetch(`${this.studio.http}/api/log-tail?n=200`).then((r) => r.json() as Promise<{ lines: string[] }>);
    // 必须按时间正序重放；reverse 会导致「旧 chunk 盖掉新 job.finished」，工位卡在「生成中」
    for (const line of tail.lines) {
      try {
        const ev = JSON.parse(line) as StudioEventEnvelope;
        this.state = reduceState(this.state, ev);
      } catch {
        // ignore
      }
    }
    this.applyState();
  }

  /** 服务端已无运行/排队任务时，清掉客户端误残留的「执行中/生成中」等（防漏收 WS） */
  private syncDeskStatusWithServerQueue() {
    if (!this.wsOnline) return;
    void fetch(`${this.studio.http}/api/queue`)
      .then((r) => r.json() as Promise<{ queue?: Array<{ agentId?: string; status?: string }>; running?: Array<{ agentId?: string }> }>)
      .then((q) => {
        const active = new Set<string>();
        for (const j of q.queue ?? []) {
          const st = String(j?.status ?? "");
          if (st === "queued" || st === "running") {
            const id = String(j?.agentId ?? "").trim();
            if (id) active.add(id);
          }
        }
        for (const j of q.running ?? []) {
          const id = String(j?.agentId ?? "").trim();
          if (id) active.add(id);
        }
        let changed = false;
        const nextAgents = { ...this.state.agents };
        for (const agentId of this.desks.keys()) {
          const st = nextAgents[agentId];
          if (!st) continue;
          if (!active.has(agentId) && ["streaming", "thinking", "tool", "blocked"].includes(st.status)) {
            nextAgents[agentId] = {
              ...st,
              status: "idle",
              jobId: undefined,
              streamDraft: undefined
            };
            changed = true;
          }
        }
        if (changed) {
          this.state = { ...this.state, agents: nextAgents };
          this.applyState();
        }
      })
      .catch(() => {});
  }

  private showWsBanner(show: boolean) {
    const el = document.getElementById("wsBanner");
    if (el) el.classList.toggle("hidden", !show);
    if (show) setText("wsStatus", "WS: 已断·重连中");
  }

  private connectWs() {
    const ws = new WebSocket(this.studio.ws);
    setText("wsStatus", "WS: connecting");
    this.showWsBanner(false);
    this.wsOnline = false;

    ws.onopen = () => {
      this.wsOnline = true;
      setText("wsStatus", "WS: online");
      this.showWsBanner(false);
      setSecretaryHud("已连接。按左侧流程推进；卡点时秘书会提示，详情在「通知」。");
      this.time.delayedCall(400, () => this.syncDeskStatusWithServerQueue());
    };
    ws.onclose = () => {
      this.wsOnline = false;
      setText("wsStatus", "WS: closed");
      this.showWsBanner(true);
      setSecretaryHud("WS 已断开：事件与秘书检测不可用，自动重连中…");
      // 自动重连
      this.time.delayedCall(3000, () => {
        if (!this.wsOnline) this.connectWs();
      });
    };
    ws.onerror = () => {
      this.wsOnline = false;
      setText("wsStatus", "WS: error");
      this.showWsBanner(true);
    };

    let lastPaint = 0;
    ws.onmessage = (msg) => {
      const text = String(msg.data ?? "");
      try {
        const ev = JSON.parse(text) as StudioEventEnvelope;
        this.recentEvents.unshift(ev);
        if (this.recentEvents.length > 260) this.recentEvents.length = 260;

        // --- 科普可视化：provider 归因 / 金币电费 / 秘书播报 ---
        if (ev.type === "job.started") {
          const jobId = (ev.payload as any)?.jobId as string | undefined;
          const providerId = (ev.payload as any)?.providerId as string | undefined;
          if (jobId) this.jobMeta.set(jobId, { agentId: ev.agentId, providerId });
          if (jobId) this.jobChars.set(jobId, 0);
        }

        if (ev.type === "llm.chunk") {
          const jobId = ev.correlationId;
          const meta = this.jobMeta.get(jobId);
          const t = (ev.payload as any)?.text;
          if (typeof t === "string") {
            this.jobChars.set(jobId, (this.jobChars.get(jobId) ?? 0) + t.length);
            const desk = ev.agentId ? this.desks.get(ev.agentId) : undefined;
            if (desk && meta?.providerId === "cloud" && Math.random() < 0.12) {
              const tokensEst = Math.floor((this.jobChars.get(jobId) ?? 0) / 4);
              const costEst = (tokensEst / 1000) * this.cloudPricingOutPer1k;
              this.floatFx(desk, `-¥${costEst.toFixed(3)}`, "#ffd66e");
            }
          }
        }

        if (ev.type === "job.failed") {
          window.dispatchEvent(new CustomEvent("studio-failures-refresh"));
          // 沙盘流水线日志
          if (ev.agentId) {
            const dept = deptNamesShort[deptOf(ev.agentId)] ?? deptOf(ev.agentId);
            const reason = (ev.payload as any)?.failureReason ?? (ev.payload as any)?.message ?? "";
            (window as any).__STUDIO_SANDBOX__?.appendPipeLog(`❌ ${dept} ${agentLabel(ev.agentId)} 任务失败${reason ? `：${String(reason).slice(0, 50)}` : ""}`);
            appendFeedCard("fail", reason ? String(reason).slice(0, 60) : "任务执行失败", agentLabel(ev.agentId));
          }
        }

        if (ev.type === "job.finished") {
          const jobId = (ev.payload as any)?.jobId as string | undefined;
          const meta = jobId ? this.jobMeta.get(jobId) : undefined;
          const chars = jobId ? (this.jobChars.get(jobId) ?? 0) : 0;
          const tokensEst = Math.floor(chars / 4);
          const providerId = meta?.providerId ?? "local";
          const costEst = providerId === "cloud" ? (tokensEst / 1000) * this.cloudPricingOutPer1k : 0;
          const agent = meta?.agentId ?? ev.agentId ?? "";
          const line = `秘书：${agent} 本轮约 tokens=${tokensEst}${providerId === "cloud" ? `，外包费≈¥${costEst.toFixed(3)}` : "（本地电费）"}`;
          this.pushNotify(line);
          const ok = (ev.payload as any)?.ok !== false;
          const pid = String((ev.payload as any)?.projectId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
          if (ok && pid) {
            const ph = (ev.payload as any)?.previewHtml as { saved?: boolean } | undefined;
            if (ph && ph.saved === false) {
              /* 程序 HTML 未落盘时不误导「已有可玩页」 */
            } else {
              const url = `${this.studio.http}/preview?projectId=${encodeURIComponent(pid)}`;
              const pathHint = `production/preview/${pid}/index.html`;
              this.pushNotify(`秘书：任务成功结束。可玩页 URL：${url} ；仓库：${pathHint} 。打开「显示器」可刷新 iframe。`);
              setSecretaryHud(`上一任务成功。预览 ${url}`);
            }
          } else if (!ok) {
            window.dispatchEvent(new CustomEvent("studio-failures-refresh"));
            const err = String((ev.payload as any)?.error ?? (ev.payload as any)?.failureReason ?? "").slice(0, 100);
            const key = jobId ? `jobfail:${jobId}` : "jobfail";
            this.pushSecretaryKeyed(key, `秘书：任务失败${err ? `：${err}` : ""}。请看左侧事件或「财务」。`, 50_000);
          }
          this.time.delayedCall(300, () => this.syncDeskStatusWithServerQueue());
          // 沙盘流水线日志
          if (ev.agentId) {
            const dept = deptNamesShort[deptOf(ev.agentId)] ?? deptOf(ev.agentId);
            (window as any).__STUDIO_SANDBOX__?.appendPipeLog(`✅ ${dept} ${agentLabel(ev.agentId)} → 产出 ${tokensEst} tokens`);
            appendFeedCard("done", `产出 ${tokensEst} tokens`, agentLabel(ev.agentId));
          }
        }

        if (ev.type === "change.detected") {
          const pid = String((ev.payload as any)?.projectId ?? "");
          const kinds = (ev.payload as any)?.kinds as string[] | undefined;
          const k = Array.isArray(kinds) ? kinds.join(",") : "";
          this.pushNotify(`秘书：项目 ${pid} 章程已偏离归档（${k}）→ 请打开「会议室」确认并归档`);
        }

        if (ev.type === "policy.decision" && (ev.payload as any)?.action === "producer_cascade") {
          const n = Number((ev.payload as any)?.enqueued ?? 0);
          const total = Number((ev.payload as any)?.totalSteps ?? 0);
          const pid = String((ev.payload as any)?.projectId ?? "");
          const seq = Boolean((ev.payload as any)?.sequential);
          if (seq && total > 0) {
            this.pushNotify(
              `秘书：制作人衔接已启动（严格串行共 ${total} 步：策划→程序→美术→QA），项目 ${pid}。上一步结束才入队下一步。`
            );
          } else {
            this.pushNotify(
              `秘书：制作人衔接已自动入队 ${n} 条（策划→程序→美术→QA）。项目 ${pid}。部门「通过」仍可额外派单。`
            );
          }
        }

        if (ev.type === "policy.decision" && (ev.payload as any)?.action === "preview_saved_from_job") {
          const pid = String((ev.payload as any)?.projectId ?? "");
          window.dispatchEvent(new CustomEvent("studio-preview-saved", { detail: { projectId: pid } }));
        }

        if (ev.type === "policy.decision" && (ev.payload as any)?.action === "preview_not_saved_from_job") {
          const pid = String((ev.payload as any)?.projectId ?? "");
          const r = String((ev.payload as any)?.reason ?? "");
          const reasonZh: Record<string, string> = {
            empty: "模型未输出可拼接的正文",
            too_short: "正文过短，未形成完整 HTML",
            invalid_html: "缺少完整 HTML（需含 </html> 等）",
            disk_error: "写入预览文件失败",
            bad_project_id: "项目 ID 无效",
            upstream_http: "上游接口返回错误",
            upstream_failed: "上游调用失败（网络/超时等）"
          };
          const rz = reasonZh[r] ?? r;
          this.pushNotify(`秘书：程序任务未把可玩 HTML 写入预览（${pid}）。原因：${rz}。可重试程序任务或设 STUDIO_LOG_PREVIEW=1 看服务端日志。`);
          setSecretaryHud(`预览未写入：${rz}`);
        }

        this.state = reduceState(this.state, ev);
        if (ev.type === "job.started" && ev.agentId) {
          this.ensureAgentAtDeskForJob(ev.agentId);
          const providerId = (ev.payload as any)?.providerId as string | undefined;
          const desk = this.desks.get(ev.agentId);
          if (desk && providerId) {
            if (providerId === "cloud") this.floatFx(desk, "-金币", "#ffd66e");
            else this.floatFx(desk, "电费", "#a7ff83");
          }
          // 沙盘流水线日志 + 动态卡片
          const dept = deptNamesShort[deptOf(ev.agentId)] ?? deptOf(ev.agentId);
          const task = typeof (ev.payload as any)?.task === "string" ? (ev.payload as any).task.slice(0, 40) : "";
          (window as any).__STUDIO_SANDBOX__?.appendPipeLog(`▶ ${dept} ${agentLabel(ev.agentId)} 开始${task ? `：${task}` : ""}`);
          appendFeedCard("start", task || "任务启动", agentLabel(ev.agentId));
          // 场景可视化
          this.showTaskBubble(ev.agentId, task || "执行中");
          // 传递动画（工作流串行：查上一个完成的 agent）
          const correlation = ev.correlationId;
          if (correlation) {
            const prevEv = this.recentEvents.find((e) => e.type === "job.finished" && e.correlationId === correlation);
            if (prevEv?.agentId && prevEv.agentId !== ev.agentId) {
              this.animateTaskTransfer(prevEv.agentId, ev.agentId);
            }
          }
        }
        // llm.chunk 每个 token 一条会刷屏；整段在 llm.message_done 写一条
        if (ev.type !== "heartbeat" && ev.type !== "llm.chunk") {
          if (ev.type === "llm.message_done") {
            const aid = ev.agentId ?? "";
            const who = aid ? agentLabel(aid) : "";
            const sum = aid ? String(this.state.agents[aid]?.summary ?? "").replace(/\s+/g, " ").trim() : "";
            const preview = sum.length > 220 ? `${sum.slice(0, 220)}…` : sum;
            appendLog(
              preview
                ? `【${studioEventTypeZh("llm.message_done")}】 · ${who} ${preview}`
                : `【${studioEventTypeZh("llm.message_done")}】 · ${who}`
            );

            // Auto-save to preview when the agent output contains a full HTML document.
            const htmlDoc = aid ? extractHtmlDocFromText(String(this.state.agents[aid]?.summary ?? "")) : null;
            const pid = String((window as any).__STUDIO_CURRENT_PROJECT__ ?? "project_1").replace(/[^a-zA-Z0-9_-]/g, "") || "project_1";
            if (htmlDoc) {
              void fetch(`${this.studio.http}/api/preview/save`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ html: htmlDoc, projectId: pid })
              })
                .then((r) => r.json())
                .then((r) => {
                  if (r?.ok) {
                    const url = `${this.studio.http}/preview?projectId=${encodeURIComponent(pid)}`;
                    this.pushNotify(`秘书：检测到完整 HTML，已自动保存到显示器（${pid}）。预览：${url}`);
                    setSecretaryHud(`已自动保存 HTML。预览 ${url}`);
                    window.dispatchEvent(new CustomEvent("studio-preview-saved", { detail: { projectId: pid } }));
                  } else {
                    this.pushNotify(`秘书：自动保存预览失败：${r?.error ?? "unknown"}`);
                  }
                })
                .catch((e) => this.pushNotify(`秘书：自动保存预览请求失败：${e instanceof Error ? e.message : String(e)}`));
            }
          } else {
            appendLog(formatStudioEventForLog(ev));
          }
        }
      } catch {
        // ignore
      }

      // throttle render updates
      const now = performance.now();
      if (now - lastPaint > 80) {
        lastPaint = now;
        this.applyState();
      }
    };
  }

  private deptStats(dept: Dept) {
    const agentIds = Array.from(this.desks.keys()).filter((id) => deptOf(id) === dept);
    const scope = new Set(agentIds);
    const evs = this.recentEvents.filter((e) => e.agentId && scope.has(e.agentId));
    const fs = evs.filter((e) => e.type === "fs.change");
    const outFiles = fs
      .map((e) => String((e.payload as any)?.path ?? ""))
      .filter(Boolean)
      .filter((p) => /\.(ts|tsx|js|jsx|css|html|md)$/i.test(p)).length;
    const chunks = evs.filter((e) => e.type === "llm.chunk").length;
    const errors = evs.filter((e) => e.type === "tool.end" && (e.payload as any)?.ok === false).length;
    const failedJobs = evs.filter((e) => e.type === "job.finished" && (e.payload as any)?.ok === false).length;
    const blocked = agentIds.filter((id) => {
      const st = this.state.agents[id]?.status;
      return st === "blocked" || st === "error";
    }).length;

    const output = `文件变更${outFiles} / 输出片段${chunks}`;
    const bugs = `${errors + failedJobs}`;
    const block = blocked > 0 ? `${blocked}人卡住` : "无";
    const summaryLines: string[] = [];
    summaryLines.push(`在岗：${agentIds.length} 人`);
    if (dept === "qa_release") {
      summaryLines.push("QA看板：建议关注失败任务、错误事件，并对关键变更做回归。");
    } else if (dept === "programming") {
      summaryLines.push("程序看板：建议将大任务拆分成可验收的小步，并在显示器里预览产出。");
    } else if (dept === "art_audio") {
      summaryLines.push("美术/音频看板：建议优先明确目标风格与验收标准，输出可预览样例。");
    } else {
      summaryLines.push("看板：关注队列积压、错误与阻塞，必要时请求用户介入决策。");
    }
    const summary = summaryLines.join("\n");
    const agentId = agentIds[0];
    return { output, bugs, block, summary, agentId };
  }

  private floatFx(desk: Desk, text: string, color: string) {
    const t = this.add.text(desk.x + 8, desk.y - 44, text, {
      fontFamily: "monospace",
      fontSize: "12px",
      color,
      backgroundColor: "#0b1020",
      padding: { left: 6, right: 6, top: 3, bottom: 3 }
    });
    t.setOrigin(0, 1);
    t.setDepth(desk.y + 400);
    this.tweens.add({
      targets: t,
      y: t.y - 18,
      alpha: 0,
      duration: 1000,
      onComplete: () => t.destroy()
    });
  }

  /** Agent 头顶任务摘要气泡（2秒渐隐） */
  private showTaskBubble(agentId: string, task: string) {
    const d = this.desks.get(agentId);
    if (!d) return;
    const label = task.length > 30 ? task.slice(0, 30) + "…" : task;
    const t = this.add.text(d.avatar.x + 16, d.avatar.y - 30, label, {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#e7ecff",
      backgroundColor: "rgba(11,16,32,0.9)",
      padding: { left: 6, right: 6, top: 3, bottom: 3 }
    });
    t.setOrigin(0.5, 1);
    t.setDepth(d.avatar.y + 1005);
    this.tweens.add({
      targets: t,
      y: t.y - 16,
      alpha: 0,
      delay: 1200,
      duration: 600,
      onComplete: () => t.destroy()
    });
  }

  /** 部门区域 KPI 气泡 */
  private deptBubbles = new Map<string, Phaser.GameObjects.Text>();
  updateDeptKpiBubbles(stats: Record<string, { output: number; active: number }>) {
    for (const [dept, s] of Object.entries(stats)) {
      const zone = this.zones.find((z) => z.id === dept);
      if (!zone) continue;
      const p = isoToScreen(zone.gx + zone.gw / 2, zone.gy - 0.5);
      let bub = this.deptBubbles.get(dept);
      if (!bub) {
        bub = this.add.text(p.x, p.y, "", {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#e7ecff",
          backgroundColor: "rgba(11,16,32,0.82)",
          padding: { left: 5, right: 5, top: 2, bottom: 2 }
        });
        bub.setOrigin(0.5, 0.5);
        bub.setDepth(p.y + 1200);
        this.deptBubbles.set(dept, bub);
      }
      bub.setText(`产出${s.output} 活跃${s.active}`);
      bub.setPosition(p.x, p.y);
      bub.setVisible(true);
    }
  }

  /** 任务传递光点动画（从 agentA 飞向 agentB） */
  private animateTaskTransfer(fromAgentId: string, toAgentId: string) {
    const a = this.desks.get(fromAgentId);
    const b = this.desks.get(toAgentId);
    if (!a || !b) return;
    const g = this.add.graphics();
    g.fillStyle(0x6ee7ff, 1);
    g.fillCircle(0, 0, 4);
    g.setPosition(a.avatar.x + 8, a.avatar.y - 10);
    g.setDepth(9999);
    this.tweens.add({
      targets: g,
      x: b.avatar.x + 8,
      y: b.avatar.y - 10,
      duration: 600,
      ease: "Quad.easeInOut",
      onUpdate: () => {
        g.clear();
        g.fillStyle(0x6ee7ff, 1);
        g.fillCircle(0, 0, 4);
        // 拖尾
        g.fillStyle(0x6ee7ff, 0.3);
        g.fillCircle(-3, 0, 3);
      },
      onComplete: () => g.destroy()
    });
  }

  private pushNotify(line: string) {
    this.notifyFeed.unshift(line);
    if (this.notifyFeed.length > 40) this.notifyFeed.length = 40;
    const el = document.getElementById("notifyList");
    if (!el) return;
    el.innerHTML = this.notifyFeed.map((l) => `<div class="logLine">${l}</div>`).join("");
  }

  private pushSecretaryKeyed(key: string, line: string, minGapMs: number) {
    const now = Date.now();
    if (now - (this.secretaryLastKeyed.get(key) ?? 0) < minGapMs) return;
    this.secretaryLastKeyed.set(key, now);
    this.pushNotify(line);
    setSecretaryHud(line.length > 168 ? `${line.slice(0, 165)}…` : line);
  }

  private async tickSecretary() {
    if (!document.getElementById("secretaryBannerText")) return;
    if (!this.wsOnline) {
      return;
    }
    for (const id of this.desks.keys()) {
      const st = this.state.agents[id];
      if (st?.status === "error") {
        setSecretaryHud(`卡点：${agentLabel(id)} 异常。请看左侧事件或财务失败原因。`);
        this.pushSecretaryKeyed(`err:${id}`, `秘书：${agentLabel(id)} 处于异常态，请查事件日志与上游错误。`, 70_000);
        return;
      }
    }
    for (const id of this.desks.keys()) {
      const st = this.state.agents[id];
      if (!st?.lastTs) continue;
      const status = st.status ?? "idle";
      if (!["streaming", "thinking", "tool", "blocked"].includes(status)) continue;
      const age = Date.now() - new Date(st.lastTs).getTime();
      if (age < 120_000 || age > 3_600_000) continue;
      const mins = Math.max(1, Math.round(age / 60_000));
      setSecretaryHud(`卡点：${agentLabel(id)} 已约 ${mins} 分钟「${agentStatusZh(status)}」。可检查模型、队列并发与设置。`);
      this.pushSecretaryKeyed(`stall:${id}`, `秘书：${agentLabel(id)} 长时间处于「${agentStatusZh(status)}」，请排查模型/队列/网络。`, 80_000);
      return;
    }
    try {
      const pr = await fetch(`${this.studio.http}/api/projects`).then((r) => r.json());
      const pid = String(pr?.currentProjectId ?? "project_1").replace(/[^a-zA-Z0-9_-]/g, "") || "project_1";
      const prev = await fetch(`${this.studio.http}/preview?projectId=${encodeURIComponent(pid)}`).then((r) => r.text());
      if (prev.includes("还没有预览内容")) {
        setSecretaryHud(`当前项目尚无保存的 HTML：打开「显示器」粘贴游戏页并点「保存到显示器」。`);
        this.pushSecretaryKeyed(
          `noprev:${pid}`,
          `秘书：项目 ${pid} 尚无预览文件。保存后可用 ${this.studio.http}/preview?projectId=${pid}`,
          130_000
        );
        return;
      }
    } catch {
      // ignore
    }
    try {
      const q = await fetch(`${this.studio.http}/api/queue`).then((r) => r.json() as Promise<{ queue: any[]; running: any[] }>);
      const nq = (q.queue ?? []).filter((j: any) => j?.status === "queued").length;
      const nr = (q.running ?? []).length;
      if (nq >= 5 && nr === 0) {
        setSecretaryHud(`队列积压 ${nq} 条且无运行中：可到「招聘→体检」调高并发槽位或检查上游模型。`);
        this.pushSecretaryKeyed("backlog", `秘书：队列 ${nq} 条在等、0 运行中，请检查 compute slots 与模型可用性。`, 95_000);
        return;
      }
    } catch {
      // ignore
    }
    setSecretaryHud("已连接。按左侧流程推进；成品在「显示器」保存后即可预览并查看通知里的路径说明。");
  }

  /** 沙盘看板数据刷新 */
  private async tickSandbox() {
    const sb = (window as any).__STUDIO_SANDBOX__;
    if (!sb) return;

    // --- 部门绩效 ---
    const deptStats: Record<string, { output: number; failed: number; active: number; idle: number; total: number }> = {};
    const deptOrder = ["leadership", "design", "programming", "art_audio", "narrative", "qa_release", "other"];
    for (const dept of deptOrder) {
      deptStats[dept] = { output: 0, failed: 0, active: 0, idle: 0, total: 0 };
    }
    for (const d of this.desks.values()) {
      const dept = deptOf(d.agentId);
      if (!deptStats[dept]) deptStats[dept] = { output: 0, failed: 0, active: 0, idle: 0, total: 0 };
      deptStats[dept]!.total += 1;
      const status = d.status;
      if (status === "idle" || status === "offline") deptStats[dept]!.idle += 1;
      else if (status === "streaming" || status === "thinking" || status === "tool") deptStats[dept]!.active += 1;
    }
    // 从 recentEvents 统计产出/失败
    const now = Date.now();
    const windowMs = 600_000; // 10分钟窗口
    for (const ev of this.recentEvents) {
      const ts = new Date(ev.ts).getTime();
      if (now - ts > windowMs) continue;
      if (ev.type === "job.finished" && ev.agentId) {
        const dept = deptOf(ev.agentId);
        if (!deptStats[dept]) continue;
        deptStats[dept]!.output += 1;
      }
      if (ev.type === "job.failed" && ev.agentId) {
        const dept = deptOf(ev.agentId);
        if (!deptStats[dept]) continue;
        deptStats[dept]!.failed += 1;
      }
    }
    sb.setDeptStats(deptStats);

    // --- 流水线 ---
    try {
      const q = await fetch(`${this.studio.http}/api/queue`).then((r) => r.json() as Promise<{ queue: any[]; running: any[] }>);
      const pipeCounts: Record<string, { running: number; queued: number }> = {};
      for (const dept of deptOrder) { pipeCounts[dept] = { running: 0, queued: 0 }; }
      for (const j of (q.running ?? [])) {
        const dept = deptOf(j?.agentId ?? "");
        if (pipeCounts[dept]) pipeCounts[dept]!.running += 1;
        else pipeCounts["programming"]!.running += 1;
      }
      for (const j of (q.queue ?? [])) {
        if (j?.status !== "queued") continue;
        const dept = deptOf(j?.agentId ?? "");
        if (pipeCounts[dept]) pipeCounts[dept]!.queued += 1;
        else pipeCounts["programming"]!.queued += 1;
      }
      sb.setPipeCounts(pipeCounts);
    } catch { /* ignore */ }

    // --- Sprint 进度 ---
    try {
      const pr = await fetch(`${this.studio.http}/api/projects`).then((r) => r.json());
      const pid = String(pr?.currentProjectId ?? "project_1");
      const ch = await fetch(`${this.studio.http}/api/charter?projectId=${encodeURIComponent(pid)}`).then((r) => r.json());
      if (ch?.ok && ch?.archived?.version) {
        sb.updateSandboxClock(`Sprint ${ch.archived.version} · 活跃中`);
        // 根据里程碑数估算进度
        const milestones = Array.isArray(ch?.draft?.milestones) ? ch.draft.milestones : [];
        const totalMilestones = Math.max(1, milestones.length);
        // 简单阶段推断
        const hasPreview = true; // 简化处理
        const execOk = pipeCounts && Object.values(pipeCounts as Record<string, { running: number }>).some((c: any) => c.running > 0);
        const phase = execOk ? 1 : 0; // 0=分配 1=执行 2=验收 3=复盘
        sb.setSprintPhase(phase);
        sb.setSprintProgress(phase * 2 + 1, 7);
        sb.setSprintMilestone(milestones[0] ?? "首包交付");
        sb.setSprintDeadline("本周五");
        const risks: string[] = [];
        for (const [dept, s] of Object.entries(deptStats)) {
          if (s.failed > 0) risks.push(`${deptNamesShort[dept] ?? dept}:${s.failed}次失败`);
        }
        sb.setSprintRisks(risks.length > 0 ? risks.join(" | ") : "当前无明显风险");
      } else {
        sb.updateSandboxClock("等待立项");
        sb.setSprintPhase(0);
        sb.setSprintProgress(0, 7);
        sb.setSprintMilestone("请先通过会议室立项");
      }
    } catch { /* ignore */ }
    sb.renderScoreboard();

    // 更新场景中的部门KPI气泡
    const bubbleStats: Record<string, { output: number; active: number }> = {};
    for (const [dept, s] of Object.entries(deptStats)) {
      bubbleStats[dept] = { output: s.output, active: s.active };
    }
    this.updateDeptKpiBubbles(bubbleStats);

    // 刷新全局状态栏
    try {
      const pr = await fetch(`${this.studio.http}/api/projects`).then((r) => r.json());
      const pid = String(pr?.currentProjectId ?? "project_1");
      const proj = (Array.isArray(pr?.projects) ? pr.projects : []).find((p: any) => p.id === pid);
      const pname = proj?.title ?? pid;
      const activeCount = Object.values(deptStats).reduce((s: number, d: any) => s + (d?.active ?? 0), 0);
      let costStr = "-";
      try {
        const fd = await fetch(`${this.studio.http}/api/finance/summary`).then((r) => r.json());
        costStr = typeof fd?.cost === "number" ? fd.cost.toFixed(3) : "-";
      } catch { /* ignore */ }
      updateTopBar(pname, activeCount, costStr, this.wsOnline);

      // 经营面板更新
      setText("mgBudget", `¥${costStr === "-" ? "12,500" : (parseFloat(costStr) * 500).toFixed(0)}`);
      const energyPct = Math.min(100, (activeCount > 0 ? 40 + activeCount * 12 : 50));
      setText("mgEnergy", `${energyPct}%`);
      const energyBar = document.getElementById("mgEnergyBar");
      if (energyBar) energyBar.style.width = `${energyPct}%`;
      const idleCount = Object.values(deptStats).reduce((s: number, d: any) => s + (d?.idle ?? 0), 0);
      const moralePct = Math.min(100, Math.max(30, 60 + idleCount * 8));
      setText("mgMorale", `${moralePct}%`);
      const moraleBar = document.getElementById("mgMoraleBar");
      if (moraleBar) moraleBar.style.width = `${moralePct}%`;
      // 风险预警
      const risks: string[] = [];
      for (const [dept, s] of Object.entries(deptStats)) {
        if (s.failed > 0) risks.push(`<div class="manageRiskCard danger">${deptNamesShort[dept] ?? dept}: ${s.failed}次失败</div>`);
        if (s.active === 0 && s.total > 0) risks.push(`<div class="manageRiskCard warn">${deptNamesShort[dept] ?? dept}: 无活跃Agent</div>`);
      }
      const riskEl = document.getElementById("mgRisks");
      if (riskEl) riskEl.innerHTML = risks.length > 0 ? risks.join("") : '<div class="manageRiskCard info">当前无风险</div>';
      setText("mgSprintInfo", `Sprint 1 · Day ${3 + activeCount}/7`);
    } catch { /* ignore */ }
  }

  shutdown() {
    window.removeEventListener("studio-preview-saved", this.onPreviewSavedListener);
  }

  /** 区分点击与拖拽画布：超过阈值则不应触发工位/房间/小地图等「点选」 */
  private pointerDragDistance(p: Phaser.Input.Pointer): number {
    return Math.hypot(p.x - p.downX, p.y - p.downY);
  }

  private pointerClientXY(p: Phaser.Input.Pointer): { x: number; y: number } | null {
    const e = p.event as MouseEvent | TouchEvent | undefined;
    if (!e) return null;
    if ("clientX" in e && typeof (e as MouseEvent).clientX === "number") {
      return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
    }
    const t = (e as TouchEvent).changedTouches?.[0] ?? (e as TouchEvent).touches?.[0];
    if (t) return { x: t.clientX, y: t.clientY };
    return null;
  }

  /**
   * 浏览器命中在 canvas 以外（HUD/抽屉/菜单等）时，不应起始平移/滚轮缩放画布。
   * 先按几何矩形判断（避免 #hud 设 pointer-events:none 时 elementFromPoint 仍落到下层 canvas 造成「穿透」）。
   */
  private isClientOverDomUi(clientX: number, clientY: number): boolean {
    const canvas = this.game.canvas;
    if (!canvas) return false;

    const inside = (node: HTMLElement | null) => {
      if (!node) return false;
      if (node.classList.contains("hidden")) return false;
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    };

    if (inside(document.getElementById("hud"))) return true;
    if (inside(document.getElementById("topRightBar"))) return true;
    if (inside(document.getElementById("menuBar"))) return true;
    if (inside(document.getElementById("drawer"))) return true;
    if (inside(document.getElementById("drawerMask"))) return true;

    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return false;
    if (el === canvas) return false;
    const gameEl = document.getElementById("game");
    if (gameEl && el === gameEl) return false;
    return true;
  }

  /** 点选工位/房间等：拖拽或松手落在 DOM 叠层上则忽略，避免穿透误选 */
  private shouldIgnoreGameObjectTap(pointer: Phaser.Input.Pointer, maxDragPx = 12): boolean {
    if (this.pointerDragDistance(pointer) > maxDragPx) return true;
    const c = this.pointerClientXY(pointer);
    if (c && this.isClientOverDomUi(c.x, c.y)) return true;
    return false;
  }

  private setupControls() {
    const cam = this.cameras.main;
    cam.setZoom(1);

    const endPan = () => {
      this.isPanning = false;
      this.panStart = undefined;
    };

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if ((window as any).__STUDIO_MODAL_OPEN__) return;
      const c = this.pointerClientXY(p);
      if (c && this.isClientOverDomUi(c.x, c.y)) return;
      // Avoid panning when clicking inside minimap viewport (handled separately)
      if (this.minimapCam) {
        const mm = this.minimapCam;
        const inMini = p.x >= mm.x && p.x <= mm.x + mm.width && p.y >= mm.y && p.y <= mm.y + mm.height;
        if (inMini) return;
      }

      this.isPanning = true;
      this.panStart = { x: p.x, y: p.y, camX: cam.scrollX, camY: cam.scrollY };
    });
    this.input.on("pointerup", endPan);
    this.input.on("pointerupoutside", endPan);
    this.game.events.on(Phaser.Core.Events.BLUR, endPan);
    if (this.game.canvas) {
      this.game.canvas.addEventListener(
        "mouseleave",
        () => {
          if (this.isPanning) endPan();
        },
        { passive: true }
      );
    }

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if ((window as any).__STUDIO_MODAL_OPEN__) return;
      if (!this.isPanning || !this.panStart) return;
      // 不在此用 p.isDown：触控板/部分浏览器在拖拽中会误报 false，导致拖动画布卡住
      const dx = (p.x - this.panStart.x) / cam.zoom;
      const dy = (p.y - this.panStart.y) / cam.zoom;
      cam.scrollX = this.panStart.camX - dx;
      cam.scrollY = this.panStart.camY - dy;
    });

    this.input.on(
      "wheel",
      (pointer: Phaser.Input.Pointer, _gx: unknown, _gy: unknown, dy: number) => {
        if ((window as any).__STUDIO_MODAL_OPEN__) return;
        const c = this.pointerClientXY(pointer);
        if (c && this.isClientOverDomUi(c.x, c.y)) return;
        const old = cam.zoom;
        const next = Phaser.Math.Clamp(old * (dy > 0 ? 0.92 : 1.08), 0.35, 2.4);
        cam.setZoom(next);
      },
      this
    );
  }

  private setupMinimap() {
    const main = this.cameras.main;
    const w = 240;
    const h = 160;
    const pad = 12;

    // Second camera renders the same scene, zoomed out (右上角)
    const mm = this.cameras.add(this.scale.width - w - pad, 40 + pad, w, h);
    mm.setBackgroundColor(0x080c18);
    mm.setZoom(0.18);
    mm.centerOn(main.midPoint.x, main.midPoint.y);
    this.minimapCam = mm;

    const overlay = this.add.graphics();
    overlay.setScrollFactor(0, 0);
    overlay.setDepth(9999);
    this.minimapOverlay = overlay;

    // 小地图部门色块（用于 overlay 绘制）
    const deptMiniColors: Record<string, { c: number }> = {
      leadership: { c: 0x6366f1 },
      design:     { c: 0x06b6d4 },
      programming:{ c: 0x10b981 },
      art_audio:  { c: 0xec4899 },
      narrative:  { c: 0xf59e0b },
      qa_release: { c: 0xef4444 },
      other:      { c: 0x94a3b8 },
    };

    this.events.on("postupdate", () => {
      // keep minimap centered roughly where main camera is
      mm.centerOn(main.midPoint.x, main.midPoint.y);
      const b = this.officePanBounds;

      // draw overlay
      overlay.clear();

      // 小地图边框
      overlay.lineStyle(1, 0x6366f1, 0.6);
      overlay.strokeRect(mm.x, mm.y, mm.width, mm.height);
      // 发光边框
      overlay.lineStyle(1, 0x06b6d4, 0.25);
      overlay.strokeRect(mm.x + 3, mm.y + 3, mm.width - 6, mm.height - 6);

      // 部门区域色块
      for (const z of this.zones) {
        const dc = deptMiniColors[z.id];
        if (!dc) continue;
        const nx1 = (z.gx * ISO.tileW) / b.width;
        const ny1 = (z.gy * ISO.tileH) / b.height;
        const nx2 = ((z.gx + z.gw) * ISO.tileW) / b.width;
        const ny2 = ((z.gy + z.gh) * ISO.tileH) / b.height;
        const rx = mm.x + nx1 * mm.width;
        const ry = mm.y + ny1 * mm.height;
        const rw = (nx2 - nx1) * mm.width;
        const rh = (ny2 - ny1) * mm.height;
        overlay.fillStyle(dc.c, 0.12);
        overlay.fillRect(rx, ry, rw, rh);
        overlay.lineStyle(1, dc.c, 0.25);
        overlay.strokeRect(rx, ry, rw, rh);
      }

      // Agent 位置点
      this.desks.forEach((d) => {
        const nx = (d.homeGx * ISO.tileW) / b.width;
        const ny = (d.homeGy * ISO.tileH) / b.height;
        const ax = mm.x + nx * mm.width;
        const ay = mm.y + ny * mm.height;
        const isSelected = d.agentId === this.selectedAgentId;
        const col = d.status === "idle" ? 0x6366f1 : d.status === "streaming" ? 0x10b981 : d.status === "error" ? 0xef4444 : 0xf59e0b;
        overlay.fillStyle(col, isSelected ? 1 : 0.6);
        overlay.fillCircle(ax, ay, isSelected ? 3 : 2);
      });

      // 视口矩形
      const vx = mm.x + (main.scrollX - b.x) / b.width * mm.width;
      const vy = mm.y + (main.scrollY - b.y) / b.height * mm.height;
      const vw = (main.width * main.zoom) / b.width * mm.width;
      const vh = (main.height * main.zoom) / b.height * mm.height;
      overlay.lineStyle(1.5, 0xffffff, 0.7);
      overlay.strokeRect(vx, vy, vw, vh);
    });

    // Click minimap to jump
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this.shouldIgnoreGameObjectTap(p, 14)) return;
      const inMini = p.x >= mm.x && p.x <= mm.x + mm.width && p.y >= mm.y && p.y <= mm.y + mm.height;
      if (!inMini) return;

      const nx = (p.x - mm.x) / mm.width;
      const ny = (p.y - mm.y) / mm.height;

      const worldX = b.x + nx * b.width;
      const worldY = b.y + ny * b.height;
      main.centerOn(worldX, worldY);
    });
  }
}

function setupMonitorUI(studioHttp: string) {
  const frame = document.getElementById("previewFrame") as HTMLIFrameElement | null;
  const html = document.getElementById("previewHtml") as HTMLTextAreaElement | null;
  const save = document.getElementById("savePreview") as HTMLButtonElement | null;
  const reload = document.getElementById("reloadPreview") as HTMLButtonElement | null;
  const out = document.getElementById("savePreviewOut") as HTMLDivElement | null;
  const projSel = document.getElementById("monitorProject") as HTMLSelectElement | null;
  const newProj = document.getElementById("monitorNewProject") as HTMLButtonElement | null;
  const urlInput = document.getElementById("monitorPreviewUrl") as HTMLInputElement | null;
  const copyUrlBtn = document.getElementById("copyPreviewUrl") as HTMLButtonElement | null;
  const openUrlBtn = document.getElementById("openPreviewUrl") as HTMLButtonElement | null;
  const kpiTokens = document.getElementById("kpiTokens2");
  const kpiReq = document.getElementById("kpiReq2");
  const kpiSlots = document.getElementById("kpiSlots2");
  const histBtn = document.getElementById("reloadPreviewHistory") as HTMLButtonElement | null;
  const histOut = document.getElementById("previewHistoryOut") as HTMLDivElement | null;
  const histList = document.getElementById("previewHistoryList") as HTMLDivElement | null;
  const failOut = document.getElementById("studioFailuresOut") as HTMLDivElement | null;
  const failList = document.getElementById("studioFailuresList") as HTMLDivElement | null;

  const getProjectId = () => String(projSel?.value ?? "").trim();
  const setCurrentProjectGlobal = (pid: string) => {
    (window as any).__STUDIO_CURRENT_PROJECT__ = pid;
  };
  const computePreviewUrl = (projectId: string, versionFile?: string) => {
    const base = `${studioHttp}/preview`;
    const pid = projectId ? `&projectId=${encodeURIComponent(projectId)}` : "";
    const v = versionFile ? `&v=${encodeURIComponent(versionFile)}` : "";
    return `${base}?t=${Date.now()}${pid}${v}`;
  };
  const setUrlUi = (url: string) => {
    if (!urlInput) return;
    // 去掉 t 的动态值，复制出来更稳定
    urlInput.value = url.replace(/([?&])t=\d+/, "$1t=0");
  };
  const setFrame = (projectId: string) => {
    if (!frame) return;
    const url = computePreviewUrl(projectId);
    frame.src = url;
    setUrlUi(url);
  };
  const setFrameToVersion = (projectId: string, file: string) => {
    if (!frame) return;
    const url = computePreviewUrl(projectId, file);
    frame.src = url;
    setUrlUi(url);
  };
  const loadFailures = async () => {
    if (!failList) return;
    if (failOut) failOut.textContent = "加载…";
    try {
      const r = await fetch(`${studioHttp}/api/studio/failures?limit=25`).then((x) => x.json());
      const rows = Array.isArray(r?.failures) ? r.failures : [];
      if (failOut) failOut.textContent = rows.length ? `最近 ${rows.length} 条` : "无";
      const esc = (s: string) =>
        String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/"/g, "&quot;");
      failList.innerHTML = rows.length
        ? rows
            .map((row: { ts?: string; type?: string; correlationId?: string; agentId?: string; payload?: Record<string, unknown> }) => {
              const cid = String(row.correlationId ?? "");
              const msg =
                row.type === "job.failed"
                  ? String((row.payload as { message?: string })?.message ?? "")
                  : String((row.payload as { error?: string })?.error ?? (row.payload as { failureReason?: string })?.failureReason ?? "");
              const line = `${String(row.ts ?? "").slice(11, 19)} ${row.type === "job.failed" ? "失败" : "结束失败"} ${msg ? esc(msg.slice(0, 72)) : ""}`;
              return `<div class="histRow" style="display:flex;gap:6px;align-items:flex-start;margin-bottom:6px;flex-wrap:wrap"><span style="flex:1;min-width:120px;font-size:12px">${line}</span><button type="button" class="segBtn" data-copy-cid="${esc(cid)}">复制 ID</button></div>`;
            })
            .join("")
        : `<div class="muted">暂无失败记录。</div>`;
      failList.querySelectorAll<HTMLButtonElement>("[data-copy-cid]").forEach((b) => {
        b.onclick = async () => {
          const t = String(b.getAttribute("data-copy-cid") ?? "");
          const ok = await copyText(t);
          if (failOut) failOut.textContent = ok ? "已复制 correlationId" : "复制失败";
        };
      });
    } catch (e) {
      if (failOut) failOut.textContent = `加载失败：${e instanceof Error ? e.message : String(e)}`;
    }
  };

  const loadHistory = async (projectId: string) => {
    if (!histList) return;
    if (histOut) histOut.textContent = "加载历史…";
    try {
      const r = await fetch(`${studioHttp}/api/preview/history?projectId=${encodeURIComponent(projectId)}`).then((x) => x.json());
      const files: string[] = Array.isArray(r?.files) ? r.files : [];
      const q = (s: string) => String(s).replace(/"/g, "&quot;");
      histList.innerHTML = files.length
        ? files
            .map(
              (f) =>
                `<div class="histRow" style="display:flex;gap:6px;align-items:center;margin-bottom:4px;flex-wrap:wrap"><button type="button" class="segBtn" data-preview-file="${q(f)}">${q(f)}</button><button type="button" class="segBtn" data-restore-file="${q(f)}">恢复为当前</button></div>`
            )
            .join("")
        : `<div class="muted">暂无历史（保存一次预览后会自动生成）。</div>`;
      if (histOut) histOut.textContent = files.length ? `共 ${files.length} 条` : "";
      histList.querySelectorAll<HTMLButtonElement>("[data-preview-file]").forEach((b) => {
        b.onclick = () => {
          const file = String(b.getAttribute("data-preview-file") ?? "");
          if (!file) return;
          setFrameToVersion(projectId, file);
        };
      });
      histList.querySelectorAll<HTMLButtonElement>("[data-restore-file]").forEach((b) => {
        b.onclick = async () => {
          const file = String(b.getAttribute("data-restore-file") ?? "");
          if (!file) return;
          if (!confirm(`将「${file}」写回当前 index.html 并作为默认预览？`)) return;
          try {
            const resp = await fetch(`${studioHttp}/api/preview/restore`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ projectId, file })
            }).then((x) => x.json());
            if (!resp?.ok) {
              if (histOut) histOut.textContent = `恢复失败：${String(resp?.error ?? "unknown")}`;
              return;
            }
            setFrame(projectId);
            if (histOut) histOut.textContent = "已恢复为当前版本";
            void loadHistory(projectId);
          } catch (e) {
            if (histOut) histOut.textContent = `恢复失败：${e instanceof Error ? e.message : String(e)}`;
          }
        };
      });
    } catch (e) {
      if (histOut) histOut.textContent = `历史加载失败：${e instanceof Error ? e.message : String(e)}`;
    }
  };

  const deleteProject = async (projectId: string) => {
    if (projectId === "project_1") {
      alert("不能删除默认项目 (project_1)");
      return;
    }
    if (!confirm(`确定删除项目 ${projectId}？该操作不可撤销。`)) return;
    try {
      const r = await fetch(`${studioHttp}/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      const data = await r.json() as any;
      if (data.ok) {
        void loadProjects();
      } else {
        alert(`删除失败：${data.error ?? "未知原因"}`);
      }
    } catch { /* ignore */ }
  };
  (window as any).__studioDeleteProject__ = deleteProject;

  const loadProjects = async () => {
    if (!projSel) return;
    const r = await fetch(`${studioHttp}/api/projects`).then((x) => x.json());
    const ps = Array.isArray(r?.projects) ? r.projects : [];
    const cur = String(r?.currentProjectId ?? "project_1");
    projSel.innerHTML = "";
    for (const p of ps) {
      const opt = document.createElement("option");
      opt.value = String(p?.id ?? "");
      opt.textContent = `${String(p?.title ?? p?.id ?? "")} (${String(p?.id ?? "")})`;
      projSel.appendChild(opt);
    }
    projSel.value = cur;
    setCurrentProjectGlobal(cur);
    setFrame(cur);
    void loadHistory(cur);
    // 项目删除按钮状态
    const delBtn = document.getElementById("monitorDeleteProject") as HTMLButtonElement | null;
    if (delBtn) delBtn.style.display = ps.length <= 1 ? "none" : "";
  };
  void loadProjects();
  void loadFailures();
  window.addEventListener("studio-failures-refresh", () => void loadFailures());

  const copyText = async (s: string) => {
    const t = String(s ?? "").trim();
    if (!t) return false;
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = t;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  };
  if (copyUrlBtn)
    copyUrlBtn.onclick = async () => {
      const u = String(urlInput?.value ?? "").trim();
      const ok = await copyText(u);
      if (out) out.textContent = ok ? "已复制链接" : "复制失败";
      if (!ok) appendLog("秘书：复制失败（浏览器权限限制），可手动选中链接复制。");
    };
  if (openUrlBtn)
    openUrlBtn.onclick = () => {
      const u = String(urlInput?.value ?? "").trim();
      if (!u) return;
      window.open(u, "_blank", "noopener,noreferrer");
    };

  window.addEventListener("studio-preview-saved", (ev) => {
    const raw = String((ev as CustomEvent<{ projectId?: string }>).detail?.projectId ?? "").trim();
    const pid = raw.replace(/[^a-zA-Z0-9_-]/g, "") || "";
    if (!pid || !projSel) return;
    const syncUi = async () => {
      let ok = Array.from(projSel!.options).some((o) => o.value === pid);
      if (!ok) {
        await loadProjects();
        ok = Array.from(projSel!.options).some((o) => o.value === pid);
      }
      if (!ok) return;
      projSel!.value = pid;
      try {
        await fetch(`${studioHttp}/api/projects/select`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: pid })
        });
      } catch {
        // ignore
      }
      setCurrentProjectGlobal(pid);
      setFrame(pid);
      void loadHistory(pid);
    };
    void syncUi();
  });

  if (projSel)
    projSel.onchange = async () => {
      const pid = getProjectId();
      if (!pid) return;
      try {
        await fetch(`${studioHttp}/api/projects/select`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: pid })
        });
      } catch {
        // ignore
      }
      setFrame(pid);
      setCurrentProjectGlobal(pid);
      void loadHistory(pid);
    };

  if (newProj)
    newProj.onclick = async () => {
      const title = prompt("新项目名称（可空）") ?? "";
      try {
        await fetch(`${studioHttp}/api/projects`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title })
        });
      } catch {
        // ignore
      }
      await loadProjects();
    };

  const refreshKpis = async () => {
    try {
      const s = await fetch(`${studioHttp}/api/settings`).then((r) => r.json());
      if (kpiSlots) kpiSlots.textContent = `并发:${s?.settings?.computeSlots ?? "-"}`;
    } catch {
      // ignore
    }
    try {
      const f = await fetch(`${studioHttp}/api/finance/summary?range=today`).then((r) => r.json());
      if (kpiTokens) kpiTokens.textContent = `tokens:${f?.tokensEstimated ?? "-"}`;
      if (kpiReq) kpiReq.textContent = `请求:${f?.requests ?? "-"}`;
    } catch {
      // ignore
    }
  };
  setInterval(() => void refreshKpis(), 2500);
  void refreshKpis();

  if (reload)
    reload.onclick = () => {
      if (!frame) return;
      setFrame(getProjectId());
    };

  if (save)
    save.onclick = async () => {
      if (!html || !out) return;
      const normalized = normalizePreviewHtmlInput(html.value);
      if (normalized.hint) appendLog(`秘书：${normalized.hint}`);
      const len = normalized.html.length;
      if (len < 20) {
        out.textContent = `保存失败：html_too_short（当前 ${len} 字）。请粘贴完整 HTML（含 <!doctype html> 或 <html>）。`;
        appendLog(`秘书：${out.textContent}`);
        setSecretaryHud("显示器保存失败：HTML 太短或未粘贴完整文档。");
        return;
      }
      out.textContent = "保存中...";
      const resp = await fetch(`${studioHttp}/api/preview/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ html: normalized.html, projectId: getProjectId() })
      }).then((r) => r.json());
      out.textContent = resp?.ok ? "已保存" : `保存失败：${resp?.error ?? "unknown"}`;
      if (resp?.ok && frame) {
        const pid = String(resp?.projectId ?? getProjectId()).replace(/[^a-zA-Z0-9_-]/g, "") || getProjectId();
        setFrame(pid);
        setCurrentProjectGlobal(pid);
        void loadHistory(pid);
        window.dispatchEvent(new CustomEvent("studio-preview-saved", { detail: { projectId: pid } }));
      }
    };

  if (histBtn)
    histBtn.onclick = () => {
      const pid = getProjectId();
      if (!pid) return;
      void loadHistory(pid);
    };

  (window as any).__STUDIO_OPEN_MONITOR__ = () => Drawer.open("monitor");
}

function setupDeptMonitorUI(studioHttp: string) {
  const deptTitle = document.getElementById("deptTitle");
  const deptSummary = document.getElementById("deptSummary");
  const outKpi = document.getElementById("deptKpiOutput");
  const bugKpi = document.getElementById("deptKpiBugs");
  const blockKpi = document.getElementById("deptKpiBlock");
  const btnApprove = document.getElementById("deptApprove") as HTMLButtonElement | null;
  const btnReject = document.getElementById("deptReject") as HTMLButtonElement | null;
  const btnRedo = document.getElementById("deptRedo") as HTMLButtonElement | null;
  const actionOut = document.getElementById("deptActionOut");

  const deptName: Record<string, string> = {
    leadership: "领导/制作",
    design: "策划/设计",
    programming: "程序/工程",
    art_audio: "美术/音频",
    narrative: "叙事/本地化",
    qa_release: "QA/发布/平台",
    other: "其他"
  };

  const setText = (el: HTMLElement | null, s: string) => {
    if (el) el.textContent = s;
  };

  let currentDept: string = "programming";
  let currentAgentId: string | null = null;
  let currentProjectId: string = "project_1";

  const refreshProject = async () => {
    try {
      const r = await fetch(`${studioHttp}/api/projects`).then((x) => x.json());
      currentProjectId = String(r?.currentProjectId ?? currentProjectId);
    } catch {
      // ignore
    }
  };

  (window as any).__STUDIO_OPEN_DEPT__ = (deptId: string, meta?: any) => {
    currentDept = deptId;
    currentAgentId = meta?.agentId ?? null;
    Drawer.open("dept");
    setText(deptTitle, `部门产出：${deptName[deptId] ?? deptId}`);
    if (deptSummary) deptSummary.textContent = "加载中...";
    void refreshProject();
  };

  const doAction = async (kind: "approve" | "reject" | "redo") => {
    if (!actionOut) return;
    actionOut.textContent = "已派单...";
    // target agent: prefer selected dept agent, else producer
    const agentId = currentAgentId ?? "producer";
    const r = await fetch(`${studioHttp}/api/dept/workorder/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deptId: currentDept, action: kind, agentId, projectId: currentProjectId, workgroupId: currentProjectId })
    }).then((x) => x.json());
    actionOut.textContent = r?.ok ? `已派单给 ${agentId}（${currentProjectId}）` : `派单失败：${r?.error ?? "unknown"}`;
  };

  if (btnApprove) btnApprove.onclick = () => void doAction("approve");
  if (btnReject) btnReject.onclick = () => void doAction("reject");
  if (btnRedo) btnRedo.onclick = () => void doAction("redo");

  // Render function is fed by scene via global hook
  (window as any).__STUDIO_SET_DEPT_STATS__ = (deptId: string, stats: { output: string; bugs: string; block: string; summary: string; agentId?: string }) => {
    if (deptId !== currentDept) return;
    setText(outKpi, `产出:${stats.output}`);
    setText(bugKpi, `问题:${stats.bugs}`);
    setText(blockKpi, `卡点:${stats.block}`);
    if (deptSummary) deptSummary.textContent = stats.summary;
    if (stats.agentId) currentAgentId = stats.agentId;
  };
}

// ======== 沙盘看板 UI ========
function setupSandboxUI() {
  // Tab 切换
  const sandboxTabs = document.querySelectorAll<HTMLButtonElement>("[data-sandbox-tab]");
  const goSandboxTab = (tab: "scoreboard" | "pipeline" | "sprint" | "workflow" | "orchestrator") => {
    sandboxTabs.forEach((x) => x.classList.toggle("isActive", x.getAttribute("data-sandbox-tab") === tab));
    document.querySelectorAll<HTMLElement>(".sandboxTab").forEach((p) => {
      p.classList.toggle("isActive", p.id === `sandboxTab_${tab}`);
    });
  };
  sandboxTabs.forEach((b) => {
    b.onclick = () => {
      const key = b.getAttribute("data-sandbox-tab") as "scoreboard" | "pipeline" | "sprint" | "workflow" | "orchestrator" | null;
      if (key) goSandboxTab(key);
    };
  });
  goSandboxTab("scoreboard");

  // --- 排行数据（由 OfficeScene 写入） ---
  const deptColors: Record<string, string> = {
    leadership: "#818cf8", design: "#22d3ee", programming: "#34d399",
    art_audio: "#f472b6", narrative: "#fbbf24", qa_release: "#f87171", other: "#94a3b8"
  };
  const deptNames: Record<string, string> = {
    leadership: "领导/制作", design: "策划/设计", programming: "程序/工程",
    art_audio: "美术/音频", narrative: "叙事/本地化", qa_release: "QA/发布", other: "综合/支持"
  };

  const scoreBody = document.getElementById("scoreboardBody");
  const scoreUpdated = document.getElementById("scoreboardUpdated");

  let deptStats: Record<string, { output: number; failed: number; active: number; idle: number; total: number }> = {};

  const renderScoreboard = () => {
    if (!scoreBody) return;
    const entries = Object.entries(deptStats).map(([id, s]) => {
      const passRate = s.output + s.failed > 0 ? Math.round((s.output / (s.output + s.failed)) * 100) : 100;
      const loadRate = s.total > 0 ? Math.round((s.active / s.total) * 100) : 0;
      const score = Math.round(passRate * 0.5 + loadRate * 0.3 + s.output * 10 - s.failed * 5);
      return { id, s, passRate, loadRate, score };
    });
    entries.sort((a, b) => b.score - a.score);

    scoreBody.innerHTML = entries
      .map((e, i) => {
        const rankCls = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
        const pCls = e.passRate >= 80 ? "good" : e.passRate >= 50 ? "warn" : "bad";
        const lCls = e.loadRate >= 60 ? "good" : e.loadRate >= 30 ? "warn" : "bad";
        const color = deptColors[e.id] ?? "#94a3b8";
        return `<div class="scoreRow" style="border-left:3px solid ${color}">
          <span class="scoreRank ${rankCls}">${i + 1}</span>
          <span class="scoreName"><span class="scoreDeptDot" style="background:${color}"></span>${deptNames[e.id] ?? e.id}</span>
          <span class="scoreVal">${e.s.output}</span>
          <span class="scoreVal ${pCls}">${e.passRate}%</span>
          <span class="scoreVal ${lCls}">${e.loadRate}%</span>
          <span class="scoreVal" style="font-weight:700;color:${color}">${Math.max(0, e.score)}</span>
        </div>`;
      })
      .join("");

    if (scoreUpdated) {
      scoreUpdated.textContent = `更新于 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    }
  };

  // 流水线数据写入
  const setPipeCounts = (counts: Record<string, { running: number; queued: number }>) => {
    let maxBacklog = 0;
    let bottleneck = "";
    for (const [dept, c] of Object.entries(counts)) {
      const el = document.getElementById(`pipeCount_${dept}`);
      if (el) el.textContent = String(c.running + c.queued);
      const sub = document.querySelector(`[data-stage="${dept}"] .pipelineSub`) as HTMLElement | null;
      if (sub) sub.textContent = `运行中 ${c.running} · 排队 ${c.queued}`;
      // 更新计数样式
      if (el) {
        el.classList.toggle("busy", c.running > 0);
        el.classList.toggle("stuck", c.queued > 2);
      }
      const stage = document.querySelector(`[data-stage="${dept}"]`) as HTMLElement | null;
      if (stage) stage.classList.toggle("activeStage", c.running > 0);
      // 找瓶颈
      const backlog = c.running + c.queued * 1.5;
      if (backlog > maxBacklog) { maxBacklog = backlog; bottleneck = deptNames[dept] ?? dept; }
    }
    // 高亮瓶颈
    document.querySelectorAll(".pipelineStage").forEach((s) => s.classList.remove("bottleneck"));
    if (bottleneck && maxBacklog > 0) {
      const originDept = Object.entries(deptNames).find(([, n]) => n === bottleneck)?.[0];
      if (originDept) {
        const stage = document.querySelector(`[data-stage="${originDept}"]`) as HTMLElement | null;
        if (stage) stage.classList.add("bottleneck");
      }
    }
    const bnEl = document.getElementById("pipelineBottleneck");
    if (bnEl) bnEl.textContent = bottleneck || "无瓶颈";
  };

  // 流水线流动日志
  const pipeLog = document.getElementById("pipelineFlowLog");
  const appendPipeLog = (line: string) => {
    if (!pipeLog) return;
    const div = document.createElement("div");
    div.textContent = line;
    div.style.cssText = "padding:2px 0;border-bottom:1px dashed rgba(255,255,255,0.05);font-size:11px";
    pipeLog.prepend(div);
    while (pipeLog.childElementCount > 20) pipeLog.removeChild(pipeLog.lastElementChild!);
  };

  // Sprint UI
  const setSprintPhase = (phase: number) => {
    const phases = ["phasePlan", "phaseExec", "phaseReview", "phaseRetro"];
    phases.forEach((p, i) => {
      const el = document.getElementById(p);
      if (!el) return;
      el.classList.remove("active", "done");
      if (i < phase) el.classList.add("done");
      else if (i === phase) el.classList.add("active");
    });
  };
  const setSprintProgress = (day: number, total: number) => {
    const fill = document.getElementById("sprintProgressFill");
    if (fill) fill.style.width = `${Math.min(100, (day / total) * 100)}%`;
    const label = document.getElementById("sprintDayLabel");
    if (label) label.textContent = `Day ${day} / ${total}`;
  };
  const setSprintMilestone = (text: string) => {
    const el = document.getElementById("sprintMilestone");
    if (el) el.textContent = text || "尚未设定里程碑";
  };
  const setSprintRisks = (text: string) => {
    const el = document.getElementById("sprintRisks");
    if (el) el.textContent = text || "暂无风险";
  };
  const setSprintDeadline = (text: string) => {
    const el = document.getElementById("sprintDeadline");
    if (el) el.textContent = `截止: ${text || "--"}`;
  };
  const updateSandboxClock = (text: string) => {
    const el = document.getElementById("sandboxClock");
    if (el) el.textContent = text;
  };

  // 暴露到 window，供 OfficeScene 调用
  (window as any).__STUDIO_SANDBOX__ = {
    setDeptStats: (stats: typeof deptStats) => { deptStats = stats; renderScoreboard(); },
    setPipeCounts,
    appendPipeLog,
    setSprintPhase,
    setSprintProgress,
    setSprintMilestone,
    setSprintRisks,
    setSprintDeadline,
    updateSandboxClock,
    renderScoreboard,
  };

  // ----- 工作流 UI -----
  const wfTemplateSel = document.getElementById("wfTemplateSelect") as HTMLSelectElement | null;
  const wfLaunchBtn = document.getElementById("wfLaunch") as HTMLButtonElement | null;
  const wfLaunchOut = document.getElementById("wfLaunchOut") as HTMLDivElement | null;
  const wfRunsList = document.getElementById("wfRunsList") as HTMLDivElement | null;
  const wfRunDetail = document.getElementById("wfRunDetail") as HTMLDivElement | null;

  const studioHttp = getStudioBase().http;
  let wfTemplates: Array<{ id: string; name: string; steps: Array<{ agentId: string; task: string; approvalNeeded: boolean }>; type: string }> = [];
  let wfPollTimer: ReturnType<typeof setInterval> | null = null;

  const loadTemplates = async () => {
    try {
      const r = await fetch(`${studioHttp}/api/workflow/templates`).then((x) => x.json());
      wfTemplates = Array.isArray(r?.templates) ? r.templates : [];
      if (wfTemplateSel) {
        wfTemplateSel.innerHTML = wfTemplates.map((t) => `<option value="${t.id}">${t.name} (${t.type === "serial" ? "串行" : "并行"}, ${t.steps.length}步)</option>`).join("");
      }
    } catch { /* ignore */ }
  };
  void loadTemplates();

  const refreshWorkflows = async () => {
    try {
      const r = await fetch(`${studioHttp}/api/workflow/runs`).then((x) => x.json());
      const runs: any[] = Array.isArray(r?.runs) ? r.runs : [];
      if (!wfRunsList) return;
      if (runs.length === 0) { wfRunsList.innerHTML = '<div class="muted">暂无工作流运行实例</div>'; return; }
      const statusEmoji: Record<string, string> = { active: "▶", completed: "✅", cancelled: "✕" };
      wfRunsList.innerHTML = runs.map((run, i) => {
        const tpl = wfTemplates.find((t) => t.id === run.templateId);
        const emoji = statusEmoji[run.status] ?? "❓";
        const doneCount = run.steps?.filter((s: any) => s.status === "approved" || s.status === "skipped").length ?? 0;
        return `<div class="card" style="cursor:pointer;border-left:3px solid ${run.status === 'active' ? 'var(--accent-green)' : run.status === 'completed' ? 'var(--accent-cyan)' : 'var(--muted)'}" onclick="(window as any).__studioShowWfRun__('${run.id}')">
          <div class="cardTop">
            <span class="cardTitle">${emoji} ${tpl?.name ?? run.templateId}</span>
            <span class="tag">${run.status}</span>
          </div>
          <div class="cardBody" style="font-size:11px">步骤 ${doneCount}/${run.totalSteps} · 项目 ${run.projectId} · ${new Date(run.startedAt).toLocaleTimeString("zh-CN", {hour:"2-digit",minute:"2-digit"})}</div>
        </div>`;
      }).join("");
    } catch { /* ignore */ }
  };
  wfPollTimer = setInterval(() => void refreshWorkflows(), 5000);
  void refreshWorkflows();

  const showWfRun = (runId: string) => {
    void (async () => {
      try {
        const r = await fetch(`${studioHttp}/api/workflow/runs`).then((x) => x.json());
        const runs: any[] = Array.isArray(r?.runs) ? r.runs : [];
        const run = runs.find((x: any) => x.id === runId);
        if (!run || !wfRunDetail) return;
        const deptNames: Record<string, string> = { leadership: "领导", design: "策划", programming: "程序", art_audio: "美术", narrative: "叙事", qa_release: "QA" };
        const statusLabels: Record<string, string> = { pending: "等待", running: "执行中", approved: "已通过", rejected: "已驳回", skipped: "已跳过" };
        const statusColors: Record<string, string> = { pending: "muted", running: "warn", approved: "good", rejected: "bad", skipped: "muted" };
        wfRunDetail.innerHTML = run.steps.map((s: any) => {
          const cls = statusColors[s.status] ?? "muted";
          const canApprove = s.approvalNeeded && s.status === "running";
          return `<div class="scoreRow" style="border-left:3px solid var(--accent-indigo);align-items:flex-start;flex-wrap:wrap">
            <span style="flex:1;min-width:120px"><strong>${deptNames[s.dept] ?? s.dept}</strong> → ${s.agentId}</span>
            <span style="font-size:11px;color:var(--muted)">${(s.task ?? "").slice(0, 40)}</span>
            <span class="agentPopupTag ${cls}">${statusLabels[s.status] ?? s.status}</span>
            ${canApprove ? `<div style="width:100%;display:flex;gap:4px;margin-top:4px">
              <button class="segBtn" style="font-size:10px;padding:2px 8px;border-color:rgba(16,185,129,0.4)" onclick="(window as any).__studioApproveWf__('${runId}','${s.id}')">通过</button>
              <button class="segBtn" style="font-size:10px;padding:2px 8px;border-color:rgba(239,68,68,0.4)" onclick="(window as any).__studioApproveWf__('${runId}','${s.id}',false)">驳回</button>
            </div>` : ""}
          </div>`;
        }).join("");
      } catch { /* ignore */ }
    })();
  };
  const approveStep = async (runId: string, stepId: string, approve: boolean = true) => {
    try {
      await fetch(`${studioHttp}/api/workflow/runs/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, stepId, approve }) });
      void refreshWorkflows();
      void showWfRun(runId);
    } catch { /* ignore */ }
  };
  (window as any).__studioShowWfRun__ = showWfRun;
  (window as any).__studioApproveWf__ = approveStep;

  if (wfLaunchBtn) wfLaunchBtn.onclick = async () => {
    const templateId = wfTemplateSel?.value ?? "";
    if (!templateId) { if (wfLaunchOut) wfLaunchOut.textContent = "请选择模板"; return; }
    if (wfLaunchOut) wfLaunchOut.textContent = "启动中...";
    try {
      const r = await fetch(`${studioHttp}/api/workflow/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ templateId }) });
      const data = await r.json() as any;
      if (wfLaunchOut) wfLaunchOut.textContent = data.ok ? `已启动 #${data.run?.id?.slice?.(0, 8) ?? "?"} (${data.run?.steps ?? 0} 步)` : `失败：${data.error ?? ""}`;
      void refreshWorkflows();
    } catch { if (wfLaunchOut) wfLaunchOut.textContent = "请求失败"; }
  };
}

// ======== 拖拽流水线编排器 ========
function setupOrchestrator() {
  const orchCanvas = document.getElementById("orchCanvas") as HTMLDivElement | null;
  const orchSvg = document.getElementById("orchSvg") as unknown as SVGElement | null;
  const orchProps = document.getElementById("orchPropsContent") as HTMLDivElement | null;
  const orchAgents = document.getElementById("orchAgents") as HTMLDivElement | null;
  const orchActionOut = document.getElementById("orchActionOut") as HTMLDivElement | null;
  const orchSaveBtn = document.getElementById("orchSave") as HTMLButtonElement | null;
  const orchExecBtn = document.getElementById("orchExecute") as HTMLButtonElement | null;

  if (!orchCanvas || !orchSvg) return;

  const studioHttp = getStudioBase().http;

  type OrchNode = {
    id: string;
    type: "agent" | "start" | "end" | "condition" | "approval";
    agentId?: string;
    label: string;
    x: number; y: number;
    el?: HTMLDivElement;
    outDot?: HTMLDivElement;
    inDot?: HTMLDivElement;
  };
  type OrchEdge = { from: string; to: string; condition?: string };

  let nodes: OrchNode[] = [];
  let edges: OrchEdge[] = [];
  let selectedNodeId: string | null = null;
  let dragNode: { id: string; sx: number; sy: number; nx: number; ny: number } | null = null;
  let connectFrom: string | null = null;
  let nodeCounter = 0;

  // 生成唯一 ID
  const nextId = () => `n${++nodeCounter}_${Math.random().toString(36).slice(2, 7)}`;

  // 颜色
  const typeColor: Record<string, string> = { start: "#10b981", end: "#06b6d4", condition: "#f59e0b", approval: "#ec4899", agent: "#6366f1" };

  // 渲染
  const render = () => {
    orchCanvas.innerHTML = "";
    for (const n of nodes) {
      const el = document.createElement("div");
      el.className = `orchCanvasNode ${n.type}`;
      el.textContent = n.label;
      el.style.left = `${n.x}px`;
      el.style.top = `${n.y}px`;
      el.title = n.agentId ? `${n.label} (${n.agentId})` : n.label;

      // 输出连接点（底部）
      if (n.type !== "end") {
        const outDot = document.createElement("div");
        outDot.className = "orchCanvasConnect out";
        outDot.title = "拖连线向外";
        outDot.addEventListener("mousedown", (ev) => { ev.stopPropagation(); connectFrom = n.id; });
        el.appendChild(outDot);
        n.outDot = outDot;
      }
      // 输入连接点（顶部）
      if (n.type !== "start") {
        const inDot = document.createElement("div");
        inDot.className = "orchCanvasConnect in";
        el.appendChild(inDot);
        n.inDot = inDot;
      }

      // 拖拽移动
      el.addEventListener("mousedown", (ev) => {
        if (ev.target !== el && ev.target !== el.firstChild) return;
        ev.preventDefault();
        if (ev.button !== 0) return;
        selectedNodeId = n.id;
        selectNode(n);
        dragNode = { id: n.id, sx: ev.clientX, sy: ev.clientY, nx: n.x, ny: n.y };
      });

      // 双击编辑
      el.addEventListener("dblclick", () => {
        selectedNodeId = n.id;
        selectNode(n);
      });

      // 右键删除
      el.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        nodes = nodes.filter((x) => x.id !== n.id);
        edges = edges.filter((e) => e.from !== n.id && e.to !== n.id);
        render();
      });

      orchCanvas.appendChild(el);
      n.el = el;
    }
    drawEdges();
  };

  // SVG 连线
  const drawEdges = () => {
    orchSvg.innerHTML = "";
    for (const e of edges) {
      const fn = nodes.find((n) => n.id === e.from);
      const tn = nodes.find((n) => n.id === e.to);
      if (!fn?.outDot || !tn?.inDot) continue;
      const fr = fn.outDot.getBoundingClientRect();
      const tr = tn.inDot.getBoundingClientRect();
      const cr = orchCanvas.getBoundingClientRect();
      const x1 = fr.left + fr.width / 2 - cr.left;
      const y1 = fr.top + fr.height / 2 - cr.top;
      const x2 = tr.left + tr.width / 2 - cr.left;
      const y2 = tr.top + tr.height / 2 - cr.top;

      const midY = (y1 + y2) / 2;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const d = `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
      line.setAttribute("d", d);
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "rgba(99,102,241,0.5)");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("marker-end", "url(#arrowhead)");
      // 箭头定义
      if (!orchSvg.querySelector("#arrowhead")) {
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.setAttribute("id", "arrowhead");
        marker.setAttribute("markerWidth", "8");
        marker.setAttribute("markerHeight", "6");
        marker.setAttribute("refX", "8");
        marker.setAttribute("refY", "3");
        marker.setAttribute("orient", "auto");
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("points", "0 0, 8 3, 0 6");
        poly.setAttribute("fill", "rgba(99,102,241,0.6)");
        marker.appendChild(poly);
        defs.appendChild(marker);
        orchSvg.appendChild(defs);
      }
      orchSvg.appendChild(line);
    }
  };

  // 创建节点
  const addNode = (type: OrchNode["type"], label: string, agentId?: string, x?: number, y?: number) => {
    const id = nextId();
    const col = typeColor[type];
    const n: OrchNode = { id, type, agentId, label: col ? `[${label}]` : label, x: x ?? 40 + Math.random() * 160, y: y ?? 30 + Math.random() * 120 };
    nodes.push(n);
    render();
    return n;
  };

  // 节点属性面板
  const selectNode = (n: OrchNode) => {
    if (!orchProps) return;
    orchProps.innerHTML = `
      <div class="agentPopupRow"><span class="agentPopupLabel">类型</span><span class="agentPopupValue">${n.type}</span></div>
      <div class="agentPopupRow"><span class="agentPopupLabel">标签</span><span class="agentPopupValue">${n.label}</span></div>
      ${n.agentId ? `<div class="agentPopupRow"><span class="agentPopupLabel">Agent</span><span class="agentPopupValue">${n.agentId}</span></div>` : ""}
      <div class="agentPopupRow"><span class="agentPopupLabel">位置</span><span class="agentPopupValue">(${Math.round(n.x)}, ${Math.round(n.y)})</span></div>
      <div class="hr"></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${n.type==="agent"?"Agent节点：拖入Agent卡片创建":"工具节点：位于侧边栏"}</div>
    `;
    for (const node of nodes) {
      if (node.el) node.el.classList.toggle("selected", node.id === n.id);
    }
  };

  // 全局鼠标事件
  window.addEventListener("mousemove", (ev) => {
    if (dragNode) {
      const dx = ev.clientX - dragNode.sx;
      const dy = ev.clientY - dragNode.sy;
      const n = nodes.find((x) => x.id === dragNode!.id);
      if (n) { n.x = Math.max(0, dragNode.nx + dx); n.y = Math.max(0, dragNode.ny + dy); }
      render();
    }
  });
  window.addEventListener("mouseup", (ev) => {
    if (connectFrom && orchCanvas) {
      // 检测鼠标下方是否有输入连接点
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const dot = el?.closest?.(".orchCanvasConnect.in");
      if (dot) {
        const parentNode = dot.closest(".orchCanvasNode") as HTMLElement | null;
        const targetId = parentNode ? nodes.find((n) => n.el === parentNode)?.id : undefined;
        if (targetId && targetId !== connectFrom) {
          edges = edges.filter((e) => !(e.from === connectFrom && e.to === targetId));
          edges.push({ from: connectFrom!, to: targetId });
        }
      }
      connectFrom = null;
      render();
    }
    dragNode = null;
  });

  // 清除选中
  if (orchCanvas) orchCanvas.addEventListener("click", (ev) => {
    if (ev.target === orchCanvas) {
      selectedNodeId = null;
      for (const n of nodes) { if (n.el) n.el.classList.remove("selected"); }
      if (orchProps) orchProps.innerHTML = '<div class="cardBody muted">点击画布中节点查看属性</div>';
    }
  });

  // 序列化
  const toTemplateJson = () => {
    const steps = nodes
      .filter((n) => n.type === "agent")
      .map((n) => ({ id: n.id, agentId: n.agentId ?? "", task: n.label, dept: deptOf(n.agentId ?? ""), priority: 0, approvalNeeded: nodes.some((nn) => nn.type === "approval" && edges.some((e) => e.from === n.id && e.to === nn.id)), timeoutMinutes: 20 }));
    return { name: "自定义流程", type: "serial" as const, steps };
  };

  // 保存
  if (orchSaveBtn) orchSaveBtn.onclick = async () => {
    const tpl = toTemplateJson();
    try {
      const r = await fetch(`${studioHttp}/api/workflow/templates/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template: tpl }) });
      const d = await r.json() as any;
      if (orchActionOut) orchActionOut.textContent = d.ok ? "已保存" : `失败：${d.error ?? ""}`;
    } catch { if (orchActionOut) orchActionOut.textContent = "保存失败"; }
  };

  // 执行
  if (orchExecBtn) orchExecBtn.onclick = async () => {
    const tpl = toTemplateJson();
    if (tpl.steps.length === 0) { if (orchActionOut) orchActionOut.textContent = "至少需要一个Agent节点"; return; }
    try {
      const r = await fetch(`${studioHttp}/api/workflow/runs/custom`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template: tpl }) });
      const d = await r.json() as any;
      if (orchActionOut) orchActionOut.textContent = d.ok ? `已启动 ${d.run?.id?.slice(0, 8)} (${tpl.steps.length}步)` : `失败：${d.error ?? ""}`;
    } catch { if (orchActionOut) orchActionOut.textContent = "执行失败"; }
  };

  // 侧边栏拖入
  if (orchAgents) {
    window.__orchOnDragOver = () => {}; // allow drop
    window.__orchOnDrop = (ev: DragEvent) => {
      ev.preventDefault();
      const nodeType = ev.dataTransfer?.getData("text/node-type");
      const agentId = ev.dataTransfer?.getData("text/agent-id");
      const label = ev.dataTransfer?.getData("text/plain") ?? "";
      if (!label) return;
      const cr = orchCanvas!.getBoundingClientRect();
      const x = ev.clientX - cr.left - 50;
      const y = ev.clientY - cr.top - 15;
      if (nodeType && !agentId) {
        addNode(nodeType as OrchNode["type"], label.replace(/[^一-龥a-zA-Z]/g, ""), undefined, x, y);
      } else if (agentId) {
        addNode("agent", label, agentId, x, y);
      }
    };
  }

  // 填充 Agent 列表
  const populateAgents = async () => {
    try {
      const r = await fetch(`${studioHttp}/api/agents`).then((x) => x.json());
      const list = Array.isArray(r?.agents) ? r.agents : [];
      const oa = orchAgents;
      if (!oa) return;
      const hired = list.filter((a: any) => a.id);
      oa.innerHTML = hired.slice(0, 20).map((a: any) =>
        `<div class="orchNodeCard" data-agent-id="${a.id}" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${agentLabel(a.id)}');event.dataTransfer.setData('text/agent-id','${a.id}');"
          style="border-left: 3px solid ${deptColorsShort[deptOf(a.id)] ?? '#6366f1'}">
          <strong>${agentLabel(a.id)}</strong>
          <span style="font-size:10px;color:var(--muted);float:right">${deptOf(a.id)}</span>
        </div>`
      ).join("");
    } catch { /* ignore */ }
  };
  void populateAgents();

  // 工具节点拖拽事件
  document.querySelectorAll<HTMLElement>(".orchTools .orchNodeCard").forEach((card) => {
    card.addEventListener("dragstart", (ev) => {
      const nodeType = card.getAttribute("data-node-type") ?? "";
      ev.dataTransfer?.setData("text/plain", card.textContent?.trim() ?? nodeType);
      ev.dataTransfer?.setData("text/node-type", nodeType);
    });
  });

  // 暴露到 window
  (window as any).__orchNodes = () => nodes;
  (window as any).__orchEdges = () => edges;

  // 默认初始节点
  addNode("start", "起点", undefined, 30, 100);
  addNode("end", "终点", undefined, 200, 100);
}

setupOrchestrator();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#0b1020",
  scene: [OfficeScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
});

// HUD settings button / modal wiring (non-Phaser UI)
setupSettingsUI(getStudioBase().http);
setupPolicyUI(getStudioBase().http);
setupMeetingUI(getStudioBase().http);
setupMonitorUI(getStudioBase().http);
setupDeptMonitorUI(getStudioBase().http);
setupSandboxUI();

