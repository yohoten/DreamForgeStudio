# aiGameGongfang Studio

[中文](../README.md) | [日本語](README.ja.md)

A multi-target workflow repo for **H5 web games** and **WeChat/Douyin mini games**, with a “studio” web UI that orchestrates multiple AI agents (roles/departments) into a controllable pipeline. Agents connect via an **OpenAI-compatible HTTP API** to local or self-hosted inference endpoints (e.g. Ollama / vLLM / LM Studio).

## Run

1) Install dependencies

```bash
npm install
```

2) Start (server + web, single command)

```bash
npm run dev
```

Default URL: `http://127.0.0.1:8787`

Or start them separately:

```bash
npm run dev:server
npm run dev:web
```

## Configuration (do not commit secrets)

- Copy `.env.example` to `.env` and fill in as needed
- Secrets/logs/local deps/build outputs are ignored by default via `.gitignore`

## Layout

- `apps/studio-web/`: studio frontend (isometric office + drawers)
- `apps/studio-server/`: studio backend (queue/event log/OpenAI-compatible proxy, etc.)
- `packages/shared/`: shared types and event definitions
- `openspec/`: specs/changes (OpenSpec workflow)
- `production/`: local runtime data (gitignored by default)

## License

Licensed under the **MIT License**. See `LICENSE`.

