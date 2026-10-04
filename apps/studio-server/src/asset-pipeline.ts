import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, normalize, sep } from "node:path";

import sharp from "sharp";

const execFileAsync = promisify(execFile);

function safeProjectId(projectId: string): string {
  return String(projectId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function relFromRepo(repoRoot: string, abs: string): string {
  return normalize(relative(repoRoot, abs)).replace(/\\/g, "/");
}

function isUnderRepoRoot(repoRoot: string, absPath: string): boolean {
  const root = resolve(repoRoot);
  const target = resolve(absPath);
  return target === root || target.startsWith(root + sep) || target.startsWith(root + "/");
}

type GenOk = {
  ok: true;
  projectId: string;
  runId: string;
  files: string[];
  relPaths: string[];
};

type GenErr = { ok: false; error: string; status?: number };

/** OpenAI 兼容 images/generations：落盘为 0.png, 1.png, … */
export async function studioGenerateImages(opts: {
  repoRoot: string;
  projectId: string;
  prompt: string;
  n?: number;
  size?: string;
  imageBaseUrl: string;
  apiKey?: string;
  model?: string;
}): Promise<GenOk | GenErr> {
  const pid = safeProjectId(opts.projectId);
  if (!pid) return { ok: false, error: "bad_project_id" };
  const prompt = String(opts.prompt ?? "").trim();
  if (!prompt) return { ok: false, error: "empty_prompt" };

  const n = Math.max(1, Math.min(10, Math.floor(Number(opts.n ?? 1) || 1)));
  const size = String(opts.size ?? "1024x1024").trim() || "1024x1024";
  const model = String(opts.model ?? "dall-e-2").trim() || "dall-e-2";

  const base = opts.imageBaseUrl.endsWith("/") ? opts.imageBaseUrl : `${opts.imageBaseUrl}/`;
  const url = new URL("images/generations", base);

  const runId = `run_${Date.now().toString(16)}_${randomBytes(4).toString("hex")}`;
  const outDir = join(opts.repoRoot, "production", "preview", pid, "assets", "gen", runId);
  await mkdir(outDir, { recursive: true });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        prompt,
        n,
        size,
        response_format: "url"
      })
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const rawText = await res.text();
  if (!res.ok) {
    return { ok: false, error: rawText.slice(0, 800), status: res.status };
  }

  let parsed: { data?: Array<{ url?: string; b64_json?: string }> };
  try {
    parsed = JSON.parse(rawText) as { data?: Array<{ url?: string; b64_json?: string }> };
  } catch {
    return { ok: false, error: "bad_json_upstream" };
  }

  const data = Array.isArray(parsed.data) ? parsed.data : [];
  const files: string[] = [];
  const relPaths: string[] = [];

  let idx = 0;
  for (const item of data) {
    const u = typeof item?.url === "string" ? item.url : "";
    if (u) {
      const imgRes = await fetch(u);
      if (!imgRes.ok) return { ok: false, error: `download_failed_${imgRes.status}` };
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const name = `${idx}.png`;
      const abs = join(outDir, name);
      await writeFile(abs, buf);
      files.push(abs);
      relPaths.push(relFromRepo(opts.repoRoot, abs));
      idx += 1;
      continue;
    }
    const b64 = typeof item?.b64_json === "string" ? item.b64_json : "";
    if (b64) {
      const buf = Buffer.from(b64, "base64");
      const name = `${idx}.png`;
      const abs = join(outDir, name);
      await writeFile(abs, buf);
      files.push(abs);
      relPaths.push(relFromRepo(opts.repoRoot, abs));
      idx += 1;
    }
  }

  if (files.length === 0) return { ok: false, error: "no_images_in_response" };

  return { ok: true, projectId: pid, runId, files, relPaths };
}

export async function studioPackSpritesheet(opts: {
  repoRoot: string;
  projectId: string;
  runId: string;
  framePaths?: string[];
}): Promise<
  | { ok: true; projectId: string; runId: string; sheetRel: string; manifestRel: string }
  | { ok: false; error: string }
> {
  const pid = safeProjectId(opts.projectId);
  if (!pid) return { ok: false, error: "bad_project_id" };
  const runId = String(opts.runId ?? "").replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!runId) return { ok: false, error: "bad_run_id" };

  let paths: string[];
  if (opts.framePaths && opts.framePaths.length > 0) {
    paths = [];
    for (const p of opts.framePaths) {
      const abs = resolve(opts.repoRoot, p);
      if (!isUnderRepoRoot(opts.repoRoot, abs)) return { ok: false, error: "path_outside_repo" };
      if (!existsSync(abs)) return { ok: false, error: `missing:${p}` };
      paths.push(abs);
    }
    paths.sort((a, b) => a.localeCompare(b));
  } else {
    const dir = join(opts.repoRoot, "production", "preview", pid, "assets", "gen", runId);
    if (!existsSync(dir)) return { ok: false, error: "run_not_found" };
    const names = (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isFile() && /\.png$/i.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
    paths = names.map((n) => join(dir, n));
  }

  if (paths.length === 0) return { ok: false, error: "no_png_frames" };

  const metas = await Promise.all(
    paths.map(async (p) => {
      const m = await sharp(p).metadata();
      return { path: p, w: m.width ?? 0, h: m.height ?? 0 };
    })
  );

  const fw = metas[0]?.w ?? 0;
  const fh = metas[0]?.h ?? 0;
  if (fw < 8 || fh < 8) return { ok: false, error: "bad_frame_size" };

  const resized = await Promise.all(
    metas.map(async (m) => {
      if (m.w === fw && m.h === fh) return readFile(m.path);
      return sharp(m.path).resize(fw, fh, { fit: "fill" }).png().toBuffer();
    })
  );

  const n = resized.length;
  const cols = n;
  const rows = 1;
  const totalW = fw * cols;
  const totalH = fh * rows;

  const base = sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  });

  const composites: sharp.OverlayOptions[] = [];
  for (let i = 0; i < n; i++) {
    composites.push({ input: resized[i], left: i * fw, top: 0 });
  }

  const sheetBuf = await base.composite(composites).png().toBuffer();

  const outDir = join(opts.repoRoot, "production", "preview", pid, "assets", "gen", runId);
  await mkdir(outDir, { recursive: true });
  const sheetAbs = join(outDir, "sheet.png");
  await writeFile(sheetAbs, sheetBuf);

  const manifest = {
    version: 1,
    frameWidth: fw,
    frameHeight: fh,
    frameCount: n,
    cols,
    rows,
    sheet: "sheet.png",
    layout: "horizontal" as const
  };
  const manifestAbs = join(outDir, "manifest.json");
  await writeFile(manifestAbs, JSON.stringify(manifest, null, 2), "utf8");

  return {
    ok: true,
    projectId: pid,
    runId,
    sheetRel: relFromRepo(opts.repoRoot, sheetAbs),
    manifestRel: relFromRepo(opts.repoRoot, manifestAbs)
  };
}

async function ffmpegAvailable(ffmpegBin: string): Promise<boolean> {
  try {
    await execFileAsync(ffmpegBin, ["-version"], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

export async function studioTranscodeVideo(opts: {
  repoRoot: string;
  projectId: string;
  inputRel: string;
}): Promise<{
  ok: true;
  transcode: "done" | "skipped";
  outRel?: string;
  detail?: string;
}> {
  const pid = safeProjectId(opts.projectId);
  if (!pid) return { ok: true, transcode: "skipped", detail: "bad_project_id" };

  const inputAbs = resolve(opts.repoRoot, opts.inputRel);
  const root = resolve(opts.repoRoot);
  if (!isUnderRepoRoot(root, inputAbs) || !existsSync(inputAbs)) {
    return { ok: true, transcode: "skipped", detail: "bad_input" };
  }

  const ffmpegBin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  if (!(await ffmpegAvailable(ffmpegBin))) {
    return { ok: true, transcode: "skipped", detail: "ffmpeg_not_found" };
  }

  const outDir = join(root, "production", "preview", pid, "assets", "video");
  await mkdir(outDir, { recursive: true });
  const hash = createHash("sha256").update(opts.inputRel).digest("hex").slice(0, 12);
  const outAbs = join(outDir, `clip_${hash}.webm`);

  try {
    await execFileAsync(
      ffmpegBin,
      ["-y", "-i", inputAbs, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "35", "-an", outAbs],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (e) {
    return { ok: true, transcode: "skipped", detail: e instanceof Error ? e.message : String(e) };
  }

  const outRel = relFromRepo(root, outAbs);
  return { ok: true, transcode: "done", outRel };
}
