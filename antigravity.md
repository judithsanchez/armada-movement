# Salsa Rhythm Learning Hub - Agent Guidelines (AGENTS.md)

This document outlines the strict technical constraints, architectural rules, and developer workflow constraints for the Salsa Rhythm Learning Hub. Refer to this as the absolute source of truth for all coding tasks.

---

## 1. Technical Stack & Environment
- **Environment**: Mobile-First, Static, Serverless (hosted on GitHub Pages).
- **Core Stack**: React + Vite (migrating incrementally to TypeScript).
- **Styling**: Vanilla CSS (HSL variables, glassmorphism, mobile dynamic layout `100dvh`).
- **Gated Dev Environment**: All developer-only panels and calibration tools must be strictly gated by the environment check:
  `import.meta.env.VITE_DEV_MODE === 'true'` (or `process.env.NODE_ENV !== 'production'`).
  *Dev code and calibration panels must be completely stripped or bypassed in production builds.*

---

## 2. Sync Engine & Stopwatch Core
Do **NOT** use YouTube's `getCurrentTime()` directly for visual updates or tap-scoring; it polls too slowly (~4Hz) and introduces visual latency.

1. **Stopwatch Core**:
   - On play status `1` (Playing), capture `player.getCurrentTime()` once.
   - Start a high-precision clock using `performance.now()`.
   - All visual pulses, UI triggers, and scoring must read from this stopwatch.
2. **Drift Correction**:
   - Run a background interval check every **2 seconds**.
   - If drift between stopwatch and YouTube playhead > 100ms, snap stopwatch to API.
3. **Playback Rate**: stopwatch delta = real delta * `player.getPlaybackRate()`.
4. **Seeking**: Hard reset of the sync engine (pause stopwatch, await new timestamp, resume).

---

## 3. Dev Timestamp Calibrator Tool (New Feature Spec)
To resolve MIR alignment issues where the "1" downbeat is out of phase, use a section-based visual calibration deck:

1. **Timeline Slides & Sliders**:
   - The song is divided into named parts (Intro, Verse, Chorus, Montuno, Mambo, Outro, etc.) using free-form text inputs.
   - Boundaries of each section are defined by interactive timeline range sliders.
   - **Single-Focus Mode**: Only **one section can be active (unlocked) at a time**. All other sections' sliders and inputs are visually dimmed and disabled to prevent cross-contamination.
2. **Pure Listening State**:
   - When calibrating inside the Dev Calibrator, **all visual beat pulses (1-8 circles) and metronome sounds are completely hidden and muted**.
   - The developer relies entirely on ears to hear the rhythm and tap the downbeats.
3. **Isolated Normalization (Grid Shift)**:
   - Taps on the "TAP ON 1" button are corrected by a configurable reaction delay setting (default: `200ms`).
   - The tool calculates the median offset and modularly shifts *only* the beats within that section's boundaries.
   - **No Cascading**: Every section is an independent timing island. Calibrating one section *never* shifts or affects neighboring sections (essential for handling complex breaks and phase shifts).
4. **Immediate Persistence**:
   - A dedicated "Save Section" button on the active slide immediately writes that section's boundaries and aligned beats back to disk via local Express API (`/api/save-beatmap`). Do *not* wait for the whole song to be completed.

---

## 4. TypeScript Type Safety
To prevent timing regressions and type mismatches, enforce the following type contracts for all beat-map manipulations:
- **`Beat`**: `{ timestamp: number; beat: number; }` (Beat is 1-8 for Salsa, 1-4 for Bachata).
- **`Section`**: `{ name: string; startTimestamp: number; focus: string; emoji: string; }`.
- **`BreakEvent` (Breaks)**: `{ id: string; startTimestamp: number; endTimestamp: number; label: string; action: 'freeze' | 'mute'; }`.
- **`SongMetadata`**: `{ songTitle: string; artist: string; danceStyle: 'salsa' | 'bachata'; youtubeId: string; bpm: number; introStart?: number; introEnd?: number; }`.
- **`BeatmapSchema`**: Contains `id`, `schemaVersion` ("1.1"), `metadata`, `sections`, `events` (using `"breaks"` key for implementation), and `beats`.

---

## 5. Mobile Safeguards
- **Visibility API**: Minimize/hide pauses both video and stopwatch. Hard-reset sync anchors on resume.
- **iOS Inline Play**: YouTube config must set `playsinline: 1` to prevent iPhone QuickTime hijack.
- **Accidental Tap Shield**: YouTube iframe must be covered by a transparent `<div>` with `pointer-events: auto` to absorb accidental user taps. All playback operations must use custom control bars.

---

## 6. Git Hygiene & AI Agent Guidelines
- **TDD (Test-Driven Development)**: Utilize TDD for all core calculations (scoring, timing filters, and grid shift mathematics). Write unit tests *before* writing execution code.
- **Git Hygiene**:
  - **Branching Policy**: All work must be performed on dedicated feature branches. Branch names must strictly mention the issue number and title in lowercase separated by hyphens, following the pattern: `issue-[number]-[hyphenated-issue-title]` (e.g., `issue-3-typescript-environment-setup`).
  - Keep test scripts and XML dumps ignored.
  - Allow production beatmaps under `/public/songs/` to be committed by ensuring `.gitignore` unignores them explicitly:
    ```git
    *.json
    !public/songs/*.json
    ```
- **Documentation Lock**: **DO NOT** edit documentation (`README.md`, `salsa_rhythm_prd_mvp.md`, `dev_tool_prd.md`, or this `AGENTS.md`) during the step-by-step feature coding loops. You may ONLY update documentation at the very end of a fully completed and verified task.

---

## 7. Link Rot & Copyright Defenses
- **Weekly Check Workflow**: Maintain a `.github/workflows/link-rot-check.yml` GitHub Action.
- **"Report Broken Audio" Link**: Embed the pre-formatted report link at the bottom of standard user control panels. Ensure it pre-fills the issue title with `Broken Audio: [SongTitle]` and the body with metadata.

---

## 8. Rekordbox XML ETL Pipeline
- **Script Location**: Keep parser utilities localized in the `/scripts` directory (e.g., `scripts/rekordbox-etl.ts`).
- **Standard Beatmap Output**: Ensure it directly maps Rekordbox cues to the new type contracts (`BeatmapSchema`) and outputs valid, human-readable JSON files into `public/songs/`.

---

## 9. Production Bundler Stripping
- **Zero Leakage**: All dev-only calibrator components must be loaded dynamically via conditional lazy loading using `import.meta.env.VITE_DEV_MODE === 'true'`.
- **Tree-Shaking Validation**: During `vite build`, verify that the resulting static JS bundles do not contain any dev calibration UI templates or tap-matching calculations.

