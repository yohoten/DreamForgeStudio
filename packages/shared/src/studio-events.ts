export type StudioEventType =
  | "llm.chunk"
  | "llm.message_done"
  | "tool.start"
  | "tool.end"
  | "fs.change"
  | "agent.assign"
  | "policy.decision"
  | "meeting.started"
  | "meeting.decided"
  | "charter.draft_saved"
  | "charter.archived"
  | "change.detected"
  | "change.cleared"
  | "finance.reset"
  | "room.enter"
  | "room.leave"
  | "job.enqueued"
  | "job.started"
  | "job.failed"
  | "job.finished"
  | "job.cancelled"
  | "project.deleted"
  | "asset.image_saved"
  | "asset.spritesheet_saved"
  | "asset.pipeline_failed"
  | "workflow.launched"
  | "workflow.step_started"
  | "workflow.step_completed"
  | "workflow.completed"
  | "heartbeat";

/** `job.failed` 事件的 payload 约定（与服务端/UI 对齐） */
export type StudioJobFailedPayload = {
  jobId: string;
  stage: string;
  message: string;
  hint?: string;
  failureReason?: string;
  projectId?: string;
  workgroupId?: string;
};

export type StudioAgentStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "tool"
  | "blocked"
  | "error"
  | "offline";

export type StudioRoomId =
  | "meeting"
  | "cafe"
  | "arcade"
  | "gym"
  | "cosplay"
  | "restroom"
  | "pool";

export type StudioFsChangeKind = "add" | "change" | "unlink" | "addDir" | "unlinkDir";

export type StudioEventEnvelope<TType extends StudioEventType = StudioEventType> = {
  v: 1;
  ts: string; // ISO-8601
  type: TType;
  sessionId: string;
  correlationId: string;
  agentId?: string;
  payload: Record<string, unknown>;
};

export type StudioAgentState = {
  agentId: string;
  status: StudioAgentStatus;
  lastTs?: string;
  summary?: string;
  /** 流式模型输出累积；不写入 summary，避免花名册/气泡逐字刷新 */
  streamDraft?: string;
  roomId?: StudioRoomId;
  jobId?: string;
};

export type StudioState = {
  sessionId: string;
  agents: Record<string, StudioAgentState>;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(16).slice(2);
  return `${prefix}_${Date.now().toString(16)}_${rand}`;
}

export function reduceState(prev: StudioState, ev: StudioEventEnvelope): StudioState {
  const agentId = ev.agentId ?? "unknown";
  const before: StudioAgentState = prev.agents[agentId] ?? {
    agentId,
    status: "idle"
  };

  let next: StudioAgentState = { ...before, lastTs: ev.ts };

  switch (ev.type) {
    case "llm.chunk": {
      const piece = (ev.payload.text as string | undefined) ?? "";
      next = {
        ...next,
        status: "streaming",
        streamDraft: (before.streamDraft ?? "") + piece
      };
      break;
    }
    case "llm.message_done": {
      const draft = (before.streamDraft ?? "").trim();
      next = {
        ...next,
        status: "idle",
        streamDraft: undefined,
        summary: draft.length > 0 ? draft : next.summary
      };
      break;
    }
    case "tool.start": {
      next = { ...next, status: "tool", summary: (ev.payload.tool as string | undefined) ?? next.summary };
      break;
    }
    case "tool.end": {
      const ok = ev.payload.ok as boolean | undefined;
      next = { ...next, status: ok === false ? "error" : "idle" };
      break;
    }
    case "agent.assign": {
      next = {
        ...next,
        status: "thinking",
        streamDraft: undefined,
        summary: (ev.payload.task as string | undefined) ?? next.summary
      };
      break;
    }
    case "job.enqueued": {
      const task = ev.payload.task as string | undefined;
      if (before.status === "idle" || before.status === "blocked") {
        const t = task ? String(task).replace(/\s+/g, " ").trim().slice(0, 72) : "";
        next = {
          ...next,
          status: "blocked",
          streamDraft: undefined,
          summary: t ? `排队：${t}` : "队列等待中"
        };
      }
      break;
    }
    case "job.started": {
      const jobId = ev.payload.jobId as string | undefined;
      const task = ev.payload.task as string | undefined;
      next = {
        ...next,
        status: "thinking",
        jobId,
        streamDraft: undefined,
        summary: task ?? next.summary,
        // 队列任务视为回工位执行，避免仍显示「在会议室/咖啡」而实际在干活
        roomId: undefined
      };
      break;
    }
    case "job.failed": {
      const p = ev.payload as Partial<StudioJobFailedPayload>;
      const msg = String(p.message ?? "任务失败").replace(/\s+/g, " ").trim().slice(0, 120);
      next = {
        ...next,
        status: "error",
        jobId: p.jobId ?? before.jobId,
        streamDraft: undefined,
        summary: msg || "任务失败"
      };
      break;
    }
    case "job.finished": {
      const ok = (ev.payload as { ok?: boolean }).ok;
      if (ok === false) {
        const err = String((ev.payload as { error?: string }).error ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
        next = {
          ...next,
          status: "error",
          jobId: undefined,
          streamDraft: undefined,
          summary: err || "任务失败"
        };
        break;
      }
      const draft = (before.streamDraft ?? "").trim();
      next = {
        ...next,
        status: "idle",
        jobId: undefined,
        streamDraft: undefined,
        summary: draft.length > 0 ? draft : next.summary
      };
      break;
    }
    case "job.cancelled": {
      next = { ...next, status: "idle", jobId: undefined, streamDraft: undefined, summary: "任务已取消" };
      break;
    }
    case "room.enter": {
      const roomId = ev.payload.roomId as StudioRoomId | undefined;
      const roomTitle = ev.payload.roomTitle as string | undefined;
      next = { ...next, status: "thinking", roomId, summary: roomTitle ?? (roomId ? `进入 ${roomId}` : next.summary) };
      break;
    }
    case "room.leave": {
      next = { ...next, status: "idle", roomId: undefined };
      break;
    }
    case "fs.change": {
      // Keep current status; store a lightweight summary if idle.
      if (next.status === "idle") next = { ...next, summary: (ev.payload.path as string | undefined) ?? next.summary };
      break;
    }
    case "meeting.started":
    case "meeting.decided":
    case "charter.draft_saved":
    case "charter.archived":
    case "change.detected":
    case "change.cleared":
    case "policy.decision": {
      break;
    }
    case "asset.image_saved":
    case "asset.spritesheet_saved":
    case "asset.pipeline_failed": {
      break;
    }
    case "heartbeat": {
      // no-op
      break;
    }
  }

  return {
    ...prev,
    agents: {
      ...prev.agents,
      [agentId]: next
    }
  };
}
