# aiGameGongfang Studio

[中文](../README.md) | [English](README.en.md)

**H5（Web）ゲーム** と **WeChat / Douyin ミニゲーム** 向けのマルチターゲット・ワークフローリポジトリです。Web 上の “Studio” UI で複数の AI Agent（役割/部門）をパイプラインとして制御し、**OpenAI 互換 HTTP API** でローカル/自前推論エンドポイント（Ollama / vLLM / LM Studio など）へ接続します。

## 実行

1) 依存関係をインストール

```bash
npm install
```

2) 起動（server + web、1コマンド）

```bash
npm run dev
```

デフォルト URL：`http://127.0.0.1:8787`

個別に起動することもできます：

```bash
npm run dev:server
npm run dev:web
```

## 設定（秘密情報はコミットしない）

- `.env.example` を `.env` にコピーして必要に応じて設定
- 秘密情報/ログ/ローカル依存/ビルド生成物は `.gitignore` で既定無視

## 構成

- `apps/studio-web/`: Studio フロントエンド（等角オフィス + パネル）
- `apps/studio-server/`: Studio バックエンド（キュー/イベントログ/OpenAI 互換プロキシ等）
- `packages/shared/`: 共通型・イベント定義
- `openspec/`: 仕様/変更（OpenSpec ワークフロー）
- `production/`: ローカル実行データ（既定で gitignore）

## ライセンス

本プロジェクトは **MIT License** です。`LICENSE` を参照してください。

