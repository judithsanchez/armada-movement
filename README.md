# Salsa Rhythm Learning Hub

An interactive, serverless ear-training tool and rhythm game designed for Salsa and Bachata dancers, hosted on GitHub Pages.

---

## ⚠️ CRITICAL DEVELOPER & AI DIRECTIVES (STRICT ENFORCEMENT)

### 1. Package Management & Locking Rules
* **Exclusively `pnpm`**: We use `pnpm` exclusively for managing package dependencies.
* **Strict Version Locking**: Version ranges are strictly fixed. Auto-updates of packages are **strictly forbidden** under any circumstance.
* **Explicit Upgrade/Add Commands Only**: Under no circumstance should `pnpm install`, `pnpm run dev`, `pnpm run build`, or `pnpm run test` automatically update any package. Any addition, upgrade, or version change of dependencies must be done through an **explicit, manual, and separate command** (e.g. `pnpm add [package]@[exact-version]`).
* **Human Approval Before Package Mutation**: AI agents must stop and notify the user before running dependency installs, package-manager commands, dev-server commands, or build/test commands that may download packages, rewrite `pnpm-lock.yaml`, modify `package.json`, mutate `node_modules`, or otherwise change dependency state. Agents must provide the exact command for the user to run or explicitly approve.
* **Do not use npm or yarn**.

### 2. Development Workflow Rules
* **TDD (Test-Driven Development)**: All core logic (sync math, scoring engines, combo calculations) must be built and validated via Test-Driven Development (TDD) using **Vitest**.
* **Feature Branching Policy**: All work must be performed on dedicated feature branches. Branch names must strictly mention the issue number and title in lowercase separated by hyphens, following the pattern: `issue-[number]-[hyphenated-issue-title]` (e.g. `issue-3-typescript-environment-setup`). Merge exclusively via Pull Requests.
* **Documentation Rule**: AI agents (including Antigravity, Codex, etc.) are strictly prohibited from touching or editing documentation files (`README.md`, `salsa_rhythm_prd_mvp.md`) during the step-by-step feature coding loop. Documentation files are ONLY allowed to be modified or expanded at the very end of a fully completed and tested task before a final commit is prepared, or when explicitly requested by the user.
* **Git Hygiene**: Keep `*.json` test maps or Rekordbox XML dumps uncommitted. Verify they are caught by `.gitignore`.

---

## Repository Architecture & Branching
* **Primary Branch**: `main` (the production-ready, stable branch deployed to GitHub Pages).
* **Branching Convention**: `issue-[number]-[hyphenated-title]` (strictly enforced).
* **Deployments**: Pushes or merges to the `main` branch trigger automated compilation and static deployment.

---

## Configured GitHub Actions
1. **GitHub Pages Deployment Action**: Automated build-and-deploy pipeline that compiles React static production assets from the `main` branch and publishes them directly to the live GitHub Pages hosting environment.
2. **Weekly Link Rot & Embed Compliance Action**: Scheduled weekly cron check workflow. It parses the `youtubeId` fields of all beatmap files in `public/songs/*.json`, checks the YouTube Data API to verify that the video remains audible, live, and embed-eligible, and opens high-priority GitHub issues for any dead links.

---

## Technical Stack
* **Frontend**: React + Vite (Javascript template) + Vanilla CSS (variables, keyframe animations, glassmorphism)
* **Hosting**: GitHub Pages
* **Sync Engine**: Internal dead-reckoning stopwatch hook (`useSyncEngine.js`) synced to the YouTube IFrame API
* **Analysis Pipeline**: Python 3.12 (`librosa`, `aubio`, `madmom`) for beat-mapping research and percussion stem isolation


---

## Commands

### Setup

#### 1. Frontend & Core Environment
```bash
pnpm install
```

#### 2. Ingestion Pipeline & Audio Analysis (Python 3.9+ & FFmpeg)
To use the **Developer Ingestion Console** for uploading and automatically analyzing new tracks via our advanced Salsa-AI signal-processing engine, you must install the system audio decoders and the Python Signal Processing stack:

1. **Install FFmpeg (System audio decoder)**:
   * **macOS (via Homebrew)**: `brew install ffmpeg`
   * **Windows**: Download and add FFmpeg to your system PATH.
   * **Linux (Ubuntu/Debian)**: `sudo apt update && sudo apt install ffmpeg`

2. **Install Python Packages**:
   ```bash
   pip3 install -r requirements.txt
   ```
*(FFmpeg is strictly required by the `librosa` decoding backend to decompress and load compressed formats like MP3/MP4 natively on your system.)*

### Run Locally (Dev Server)
```bash
pnpm dev
```

### Build Production Bundle
```bash
pnpm build
```

### Run Unit Tests
```bash
pnpm test
```
