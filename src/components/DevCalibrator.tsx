import React, { useState, useEffect, useRef } from "react";
import {
  Check, RotateCcw, Trash2, Lock, Unlock, Scissors,
  Clock, Music, ChevronLeft, ChevronRight
} from "lucide-react";
import { AgnosticSong, BeatCountType } from "../types/schemas";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DevCalibratorProps {
  songData: any;
  originalSongData: any;
  calibratedSongData: any;
  setCalibratedSongData: (data: any) => void;
  setSongData: (data: any) => void;
  setOriginalSongData: (data: any) => void;
  breaks: any[];
  setBreaks: (breaks: any[]) => void;
  currentTime: number;
  videoDuration: number;
  player: any;
  throttledSeek: (time: number, immediate: boolean) => void;
  userDelaySetting: number;
  setUserDelaySetting: (delay: number) => void;
  onBackToCatalog: () => void;
  showToast: (msg: string) => void;
}

interface EditorSection {
  id: string;
  name: string;
  emoji: string;
  startTimestamp: number;
  endTimestamp: number;
  focusInstrument: string;
  beatCountType: BeatCountType;
  displayCounts: boolean;
  localOffsetMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTION_PALETTE = [
  { bg: "rgba(59,130,246,0.30)",  border: "#3b82f6", text: "#93c5fd" },
  { bg: "rgba(168,85,247,0.30)",  border: "#a855f7", text: "#d8b4fe" },
  { bg: "rgba(20,184,166,0.30)",  border: "#14b8a6", text: "#5eead4" },
  { bg: "rgba(236,72,153,0.30)",  border: "#ec4899", text: "#f9a8d4" },
  { bg: "rgba(251,146,60,0.30)",  border: "#fb923c", text: "#fdba74" },
  { bg: "rgba(34,197,94,0.30)",   border: "#22c55e", text: "#86efac" },
];

const BEAT_COUNT_OPTIONS: { value: BeatCountType; label: string }[] = [
  { value: "salsa-8",  label: "Salsa 8-Count (1–8)"   },
  { value: "bachata-4",label: "Bachata 4-Count (1–4)" },
  { value: "swing-6",  label: "Swing 6-Count (1–6)"   },
  { value: "waltz-3",  label: "Waltz 3-Count (1–3)"   },
  { value: "none",     label: "No Metronome / Free"    },
];

const formatTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function DevCalibrator({
  songData, originalSongData, calibratedSongData,
  setCalibratedSongData, setSongData, setOriginalSongData,
  breaks, setBreaks,
  currentTime, videoDuration,
  player, throttledSeek,
  userDelaySetting, setUserDelaySetting,
  onBackToCatalog, showToast,
}: DevCalibratorProps) {
  const agnosticSong = (calibratedSongData || songData) as AgnosticSong;
  const youtubeId    = agnosticSong?.youtubeId || "unknown";
  const duration     = videoDuration || 300;

  const [editorSections,  setEditorSections]  = useState<EditorSection[]>([]);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [globalTapLog,    setGlobalTapLog]    = useState<number[]>(agnosticSong?.globalTapLog || []);
  const [tapFlash,        setTapFlash]        = useState(false);

  const loadedSongIdRef = useRef<string | null>(null);
  const timelineRef     = useRef<HTMLDivElement>(null);

  // ── Load sections on song change ──────────────────────────────────────────
  useEffect(() => {
    if (agnosticSong && loadedSongIdRef.current !== youtubeId) {
      loadedSongIdRef.current = youtubeId;

      const activeSections = agnosticSong.calibratedBeatmap?.sections || [];
      const sorted = [...activeSections].sort((a, b) => a.startTimestamp - b.startTimestamp);

      const formatted: EditorSection[] = sorted.map((sec, idx) => {
        const start = sec.startTimestamp;
        const end =
          typeof sec.endTimestamp === "number" && sec.endTimestamp > start
            ? sec.endTimestamp
            : idx < sorted.length - 1
            ? sorted[idx + 1].startTimestamp
            : duration;
        return {
          id:              sec.id || `sec-${idx}-${sec.name}`,
          name:            sec.name,
          emoji:           sec.emoji || "🎵",
          startTimestamp:  start,
          endTimestamp:    end,
          focusInstrument: sec.focusInstrument || "",
          beatCountType:   sec.beatCountType   || "salsa-8",
          displayCounts:   sec.displayCounts   !== false,
          localOffsetMs:   sec.localOffsetMs   || 0,
        };
      });

      setEditorSections(formatted);
      setGlobalTapLog(agnosticSong.globalTapLog || []);
      setFocusedSectionId(null);
    }
  }, [songData, videoDuration, youtubeId]);

  // ── Beat grid application ─────────────────────────────────────────────────
  const applyVisualGridShifts = (sectionsList: EditorSection[], tapLog: number[]) => {
    const baseSong = originalSongData || songData;
    if (!baseSong) return;

    let processedBeats = JSON.parse(JSON.stringify(baseSong.beats || []));

    if (tapLog.length > 0) {
      const delay       = userDelaySetting / 1000;
      const firstTap    = tapLog[0] - delay;
      const beat1s      = processedBeats.filter((b: any) => b.beat === 1);
      if (beat1s.length > 0) {
        let best = beat1s[0], minDiff = Infinity;
        for (const b of beat1s) {
          const d = Math.abs(firstTap - b.timestamp);
          if (d < minDiff) { minDiff = d; best = b; }
        }
        const shift = firstTap - best.timestamp;
        processedBeats = processedBeats.map((b: any) => ({
          ...b, timestamp: parseFloat(Math.max(0, b.timestamp + shift).toFixed(3))
        }));
      }
    }

    processedBeats = processedBeats.map((b: any) => {
      const sec = sectionsList.find(s => b.timestamp >= s.startTimestamp && b.timestamp <= s.endTimestamp);
      if (sec?.localOffsetMs) {
        const off = sec.localOffsetMs / 1000;
        return {
          ...b,
          timestamp: parseFloat(
            Math.max(sec.startTimestamp, Math.min(sec.endTimestamp, b.timestamp + off)).toFixed(3)
          ),
        };
      }
      return b;
    }).sort((a: any, b: any) => a.timestamp - b.timestamp);

    processedBeats = processedBeats.map((b: any, idx: number) => {
      const sec = sectionsList.find(s => b.timestamp >= s.startTimestamp && b.timestamp <= s.endTimestamp);
      if (sec) {
        const style = sec.beatCountType;
        if (style === "bachata-4") return { ...b, beat: (idx % 4) + 1 };
        if (style === "swing-6")   return { ...b, beat: (idx % 6) + 1 };
        if (style === "waltz-3")   return { ...b, beat: (idx % 3) + 1 };
        if (style === "none")      return { ...b, beat: 0 };
      }
      return { ...b, beat: (idx % 8) + 1 };
    });

    setCalibratedSongData({
      ...(calibratedSongData || songData),
      beats: processedBeats,
      sections: sectionsList.map(s => ({
        id: s.id, name: s.name, emoji: s.emoji,
        startTimestamp: s.startTimestamp, endTimestamp: s.endTimestamp,
        focusInstrument: s.focusInstrument, beatCountType: s.beatCountType,
        displayCounts: s.displayCounts, localOffsetMs: s.localOffsetMs,
      })),
      metadata: {
        ...(calibratedSongData || songData).metadata,
        bpm: (calibratedSongData || songData).metadata?.bpm || 120,
      },
    });
  };

  const syncSections = (list: EditorSection[]) => {
    setEditorSections(list);
    applyVisualGridShifts(list, globalTapLog);
  };

  // ── Slice at playhead ─────────────────────────────────────────────────────
  const sliceAtPlayhead = () => {
    const sliceTime = parseFloat(currentTime.toFixed(3));

    // If no sections yet, initialise with a full-song section then slice
    let base = editorSections;
    if (base.length === 0) {
      base = [{
        id: `sec-${Date.now()}-full`,
        name: "Full Song",
        emoji: "🎵",
        startTimestamp: 0,
        endTimestamp: duration,
        focusInstrument: "",
        beatCountType: "salsa-8",
        displayCounts: true,
        localOffsetMs: 0,
      }];
    }

    const targetIdx = base.findIndex(
      s => sliceTime > s.startTimestamp + 0.5 && sliceTime < s.endTimestamp - 0.5
    );
    if (targetIdx === -1) {
      showToast("⚠️ Playhead too close to an existing boundary (min 0.5s gap).");
      return;
    }

    const target = base[targetIdx];
    const newSec: EditorSection = {
      id:              `sec-${Date.now()}`,
      name:            "New Section",
      emoji:           "🎵",
      startTimestamp:  sliceTime,
      endTimestamp:    target.endTimestamp,
      focusInstrument: target.focusInstrument,
      beatCountType:   target.beatCountType,
      displayCounts:   target.displayCounts,
      localOffsetMs:   0,
    };

    const updated = [...base];
    updated[targetIdx] = { ...target, endTimestamp: sliceTime };
    updated.splice(targetIdx + 1, 0, newSec);

    syncSections(updated);
    setFocusedSectionId(newSec.id);
    showToast(`✂️ Sliced at ${formatTime(sliceTime)}`);
  };

  // ── Boundary nudge ────────────────────────────────────────────────────────
  const nudgeBoundary = (sectionId: string, deltaMs: number, isStart: boolean) => {
    const sec = editorSections.find(s => s.id === sectionId);
    if (!sec) return;
    const delta     = deltaMs / 1000;
    const field     = isStart ? "startTimestamp" as const : "endTimestamp" as const;
    const current   = isStart ? sec.startTimestamp : sec.endTimestamp;
    handleUpdateSectionTimes(sectionId, field, current + delta);
  };

  // ── Contiguous boundary update ────────────────────────────────────────────
  const handleUpdateSectionTimes = (id: string, field: "startTimestamp" | "endTimestamp", value: number) => {
    const numericVal = parseFloat(value.toFixed(3));
    const secIdx     = editorSections.findIndex(s => s.id === id);
    if (secIdx === -1) return;

    const updated = [...editorSections];
    const sec     = { ...updated[secIdx] };

    if (field === "startTimestamp") {
      const bounded = Math.max(0, Math.min(sec.endTimestamp - 0.1, numericVal));
      sec.startTimestamp = bounded;
      if (secIdx > 0) updated[secIdx - 1] = { ...updated[secIdx - 1], endTimestamp: bounded };
    } else {
      const bounded = Math.max(sec.startTimestamp + 0.1, Math.min(duration, numericVal));
      sec.endTimestamp = bounded;
      if (secIdx < updated.length - 1) updated[secIdx + 1] = { ...updated[secIdx + 1], startTimestamp: bounded };
    }

    updated[secIdx] = sec;
    syncSections([...updated].sort((a, b) => a.startTimestamp - b.startTimestamp));
    throttledSeek(numericVal, false);
  };

  // ── Field update ──────────────────────────────────────────────────────────
  const handleUpdateSectionField = (id: string, field: keyof EditorSection, value: any) => {
    syncSections(editorSections.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  // ── Delete (maintains contiguity) ─────────────────────────────────────────
  const handleDeleteSection = (id: string) => {
    if (editorSections.length <= 1) {
      showToast("⚠️ Cannot delete the only section.");
      return;
    }
    const idx     = editorSections.findIndex(s => s.id === id);
    const updated = [...editorSections];

    if (idx > 0) {
      updated[idx - 1] = { ...updated[idx - 1], endTimestamp: updated[idx].endTimestamp };
    } else {
      updated[1] = { ...updated[1], startTimestamp: 0 };
    }

    updated.splice(idx, 1);
    syncSections(updated);
    if (focusedSectionId === id) setFocusedSectionId(updated[Math.max(0, idx - 1)]?.id ?? null);
    showToast("🗑️ Section removed.");
  };

  // ── TAP on 1 ─────────────────────────────────────────────────────────────
  const handleTap = () => {
    if (!player) return;
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 80);

    if (focusedSectionId) {
      const activeSec = editorSections.find(s => s.id === focusedSectionId);
      if (activeSec && (currentTime < activeSec.startTimestamp || currentTime > activeSec.endTimestamp)) {
        showToast("⚠️ Tap ignored: outside section boundaries!");
        return;
      }
    }

    const updated = [...globalTapLog, currentTime].sort((a, b) => a - b);
    setGlobalTapLog(updated);
    applyVisualGridShifts(editorSections, updated);
  };

  const handleClearTaps = () => {
    setGlobalTapLog([]);
    applyVisualGridShifts(editorSections, []);
    showToast("🔄 Taps cleared.");
  };

  // ── Keyboard hotkeys ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" ||
          (e.target as HTMLElement).tagName === "TEXTAREA" ||
          (e.target as HTMLElement).tagName === "SELECT") return;

      if (e.code === "Space") {
        e.preventDefault();
        handleTap();
      }
      if (e.key === "m" || e.key === "M" || e.key === "Enter") {
        e.preventDefault();
        sliceAtPlayhead();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentTime, editorSections, globalTapLog, focusedSectionId]);

  // ── Timeline click to seek ────────────────────────────────────────────────
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    const rect  = timelineRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    throttledSeek(ratio * duration, true);
  };

  // ── Final save ────────────────────────────────────────────────────────────
  const handleFinalSaveToDisk = () => {
    const activeBeatmap = calibratedSongData || songData;
    const baseSong      = originalSongData   || songData;
    if (!activeBeatmap || !baseSong) return;

    const payload = {
      youtubeId,
      activeBeatmap: {
        ...activeBeatmap,
        isCalibrated: true,
        globalTapLog,
        globalReactionDelayMs: userDelaySetting,
        calibratedBeatmap: {
          bpm: activeBeatmap.calibratedBeatmap?.bpm || activeBeatmap.metadata?.bpm || 120,
          beats: activeBeatmap.beats,
          sections: editorSections.map(s => ({
            id: s.id, name: s.name, emoji: s.emoji,
            startTimestamp: s.startTimestamp, endTimestamp: s.endTimestamp,
            focusInstrument: s.focusInstrument, beatCountType: s.beatCountType,
            displayCounts: s.displayCounts, localOffsetMs: s.localOffsetMs,
          })),
        },
        breaks,
      },
      originalBeatmap: { ...baseSong, breaks },
      calibration: {
        recordedAt:     new Date().toISOString(),
        youtubeId,
        globalTapLog,
        reactionDelayMs: userDelaySetting,
        sections:        editorSections,
      },
    };

    showToast("💾 Saving…");
    fetch("/api/save-beatmap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(r => { if (!r.ok) throw new Error("Server write failed"); return r.json(); })
      .then(result => {
        if (result.success) {
          setOriginalSongData(JSON.parse(JSON.stringify(activeBeatmap)));
          setSongData(JSON.parse(JSON.stringify(activeBeatmap)));
          showToast("🎉 Calibration committed to disk!");
        } else throw new Error(result.error);
      })
      .catch(err => {
        console.error("Final save failed:", err);
        showToast("❌ Save failed. Check console.");
      });
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeSec     = editorSections.find(s => s.id === focusedSectionId) ?? null;
  const playheadPct   = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isTapDeckOpen = focusedSectionId !== null && editorSections.length > 0;

  // ─────────────────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="glass-panel dev-calibrator-workbench"
      style={{
        display: "flex", flexDirection: "column", gap: "16px",
        padding: "20px", width: "100%",
        border: "1px solid rgba(139,92,246,0.3)",
        background: "rgba(9,9,11,0.85)",
        backdropFilter: "blur(12px)", borderRadius: "20px",
        fontFamily: "inherit",
      }}
    >

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <span style={{ fontSize: "0.95rem", fontWeight: 900, color: "#c084fc", textTransform: "uppercase", letterSpacing: "1px" }}>
          🛠️ Downbeat Workbench
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={handleFinalSaveToDisk}
            style={{
              background: "linear-gradient(135deg,#34d399,#059669)",
              border: "none", color: "#fff",
              padding: "6px 14px", borderRadius: "8px",
              fontSize: "0.75rem", fontWeight: 900, cursor: "pointer",
              display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            <Check size={13} /> Commit Calibration
          </button>
          <button
            onClick={onBackToCatalog}
            style={{
              background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)",
              color: "#f87171", padding: "6px 12px", borderRadius: "8px",
              fontSize: "0.75rem", fontWeight: 700, cursor: "pointer",
            }}
          >
            Exit
          </button>
        </div>
      </div>

      {/* ── Visual Timeline ── */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Song Timeline
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "#6b7280" }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <button
              onClick={sliceAtPlayhead}
              title="Hotkey: M or Enter"
              style={{
                display: "flex", alignItems: "center", gap: "5px",
                fontSize: "0.72rem", fontWeight: 700,
                background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.4)",
                color: "#a5b4fc", padding: "4px 10px", borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              <Scissors size={12} /> Slice here <kbd style={{ background: "rgba(255,255,255,0.08)", borderRadius: "3px", padding: "0 3px", fontSize: "0.65rem" }}>M</kbd>
            </button>
          </div>
        </div>

        {/* Timeline bar */}
        <div
          ref={timelineRef}
          onClick={handleTimelineClick}
          style={{
            position: "relative", height: "44px",
            borderRadius: "10px", overflow: "hidden",
            background: "#18181b", cursor: "crosshair",
            border: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
          }}
        >
          {/* Section blocks */}
          {editorSections.length === 0 ? (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              fontSize: "0.75rem", color: "#6b7280", fontStyle: "italic", pointerEvents: "none",
            }}>
              Press <strong style={{ color: "#a5b4fc", margin: "0 4px" }}>M</strong> or click "Slice here" to start sectioning
            </div>
          ) : (
            editorSections.map((sec, idx) => {
              const widthPct  = ((sec.endTimestamp - sec.startTimestamp) / duration) * 100;
              const leftPct   = (sec.startTimestamp / duration) * 100;
              const color     = SECTION_PALETTE[idx % SECTION_PALETTE.length];
              const isActive  = sec.id === focusedSectionId;
              return (
                <div
                  key={sec.id}
                  onClick={(e) => { e.stopPropagation(); setFocusedSectionId(isActive ? null : sec.id); if (!isActive) throttledSeek(sec.startTimestamp, true); }}
                  style={{
                    position: "absolute", top: 0, bottom: 0,
                    left: `${leftPct}%`, width: `${widthPct}%`,
                    background: color.bg,
                    borderRight: `2px solid ${color.border}`,
                    outline: isActive ? `2px solid ${color.border}` : "none",
                    outlineOffset: "-2px",
                    display: "flex", alignItems: "center",
                    padding: "0 6px", overflow: "hidden",
                    cursor: "pointer", transition: "outline 0.15s ease",
                    zIndex: isActive ? 2 : 1,
                  }}
                >
                  <span style={{
                    fontSize: "0.68rem", fontWeight: 700,
                    color: color.text, whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis",
                    textShadow: "0 1px 3px rgba(0,0,0,0.8)",
                  }}>
                    {sec.emoji} {sec.name}
                  </span>
                </div>
              );
            })
          )}

          {/* Playhead */}
          <div
            style={{
              position: "absolute", top: 0, bottom: 0,
              left: `${playheadPct}%`, width: "2px",
              background: "#ef4444", zIndex: 10, pointerEvents: "none",
              boxShadow: "0 0 8px rgba(239,68,68,0.7)",
            }}
          >
            <div style={{
              position: "absolute", top: 0, left: "50%",
              transform: "translateX(-50%)",
              width: "8px", height: "8px",
              background: "#ef4444", borderRadius: "50%",
            }} />
          </div>
        </div>

        {/* Section pills row */}
        {editorSections.length > 0 && (
          <div style={{ display: "flex", gap: "4px", marginTop: "6px", flexWrap: "wrap" }}>
            {editorSections.map((sec, idx) => {
              const color    = SECTION_PALETTE[idx % SECTION_PALETTE.length];
              const isActive = sec.id === focusedSectionId;
              return (
                <button
                  key={sec.id}
                  onClick={() => { setFocusedSectionId(isActive ? null : sec.id); if (!isActive) throttledSeek(sec.startTimestamp, true); }}
                  style={{
                    fontSize: "0.65rem", fontWeight: 700,
                    padding: "2px 8px", borderRadius: "20px",
                    background: isActive ? color.bg : "rgba(255,255,255,0.04)",
                    border: `1px solid ${isActive ? color.border : "rgba(255,255,255,0.08)"}`,
                    color: isActive ? color.text : "#6b7280",
                    cursor: "pointer", transition: "all 0.15s ease",
                  }}
                >
                  {sec.emoji} {sec.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Contextual Section Editor ── */}
      {activeSec ? (
        <div style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "14px", padding: "16px",
          display: "flex", flexDirection: "column", gap: "14px",
        }}>

          {/* Section name row */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="text"
              value={activeSec.emoji}
              onChange={(e) => handleUpdateSectionField(activeSec.id, "emoji", e.target.value)}
              style={{
                width: "36px", textAlign: "center", padding: "6px 4px",
                borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(0,0,0,0.3)", color: "#fff", fontSize: "1rem",
              }}
            />
            <input
              type="text"
              value={activeSec.name}
              onChange={(e) => handleUpdateSectionField(activeSec.id, "name", e.target.value)}
              placeholder="Section name…"
              style={{
                flexGrow: 1, padding: "7px 12px", borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(0,0,0,0.3)", color: "#fff",
                fontSize: "0.85rem", fontWeight: 700, outline: "none",
              }}
            />
            {/* Focus/Tap toggle */}
            <button
              onClick={() => setFocusedSectionId(focusedSectionId === activeSec.id ? null : activeSec.id)}
              title={isTapDeckOpen ? "Release to close tap deck" : "Open tap calibration deck"}
              style={{
                background: isTapDeckOpen ? "rgba(139,92,246,0.22)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${isTapDeckOpen ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.1)"}`,
                color: isTapDeckOpen ? "#c084fc" : "#9ca3af",
                padding: "6px 10px", borderRadius: "8px",
                fontSize: "0.7rem", fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", gap: "5px",
              }}
            >
              {isTapDeckOpen ? <Lock size={12} /> : <Unlock size={12} />}
              {isTapDeckOpen ? "Calibrating" : "Calibrate"}
            </button>
            {/* Delete */}
            <button
              onClick={() => handleDeleteSection(activeSec.id)}
              title="Delete section (extends neighbor)"
              style={{
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
                color: "#f87171", padding: "6px 8px", borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Start timestamp nudger */}
          <NudgerRow
            label="Start"
            value={activeSec.startTimestamp}
            color="#38bdf8"
            onNudge={(ms) => nudgeBoundary(activeSec.id, ms, true)}
            onMarkFromPlayhead={() => handleUpdateSectionTimes(activeSec.id, "startTimestamp", currentTime)}
            disabled={editorSections.findIndex(s => s.id === activeSec.id) === 0}
          />

          {/* End timestamp nudger */}
          <NudgerRow
            label="End"
            value={activeSec.endTimestamp}
            color="#f43f5e"
            onNudge={(ms) => nudgeBoundary(activeSec.id, ms, false)}
            onMarkFromPlayhead={() => handleUpdateSectionTimes(activeSec.id, "endTimestamp", currentTime)}
            disabled={false}
          />

          {/* Beat count modulo */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "0.68rem", color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px" }}>
              Beat Count Modulo
            </label>
            <select
              value={activeSec.beatCountType}
              onChange={(e) => handleUpdateSectionField(activeSec.id, "beatCountType", e.target.value)}
              style={{
                padding: "7px 10px", borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(0,0,0,0.35)", color: "#e5e7eb",
                fontSize: "0.8rem", outline: "none",
              }}
            >
              {BEAT_COUNT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Focus instrument */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "0.68rem", color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px" }}>
              Focus Instrument
            </label>
            <input
              type="text"
              value={activeSec.focusInstrument}
              onChange={(e) => handleUpdateSectionField(activeSec.id, "focusInstrument", e.target.value)}
              placeholder="e.g. Cowbell (Campana)"
              style={{
                padding: "7px 12px", borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(0,0,0,0.35)", color: "#e5e7eb",
                fontSize: "0.8rem", outline: "none",
              }}
            />
          </div>

          <p style={{ fontSize: "0.65rem", color: "#4b5563", textAlign: "center", margin: 0 }}>
            Nudging adjusts adjacent sections to keep the timeline contiguous.
          </p>
        </div>
      ) : (
        editorSections.length > 0 && (
          <div style={{ textAlign: "center", padding: "12px", fontSize: "0.78rem", color: "#6b7280", fontStyle: "italic" }}>
            Click a section in the timeline or a pill above to edit it.
          </div>
        )
      )}

      {/* ── Tap Deck ── */}
      {isTapDeckOpen && (
        <div
          className={tapFlash ? "active-flash" : ""}
          style={{
            padding: "20px 16px",
            background: "linear-gradient(135deg,rgba(139,92,246,0.08),rgba(99,102,241,0.03))",
            border: `2px solid ${tapFlash ? "#8b5cf6" : "rgba(139,92,246,0.35)"}`,
            borderRadius: "16px",
            display: "flex", flexDirection: "column", gap: "14px", alignItems: "center",
            boxShadow: tapFlash ? "0 0 36px rgba(139,92,246,0.28)" : "none",
            transition: "all 0.08s ease",
          }}
        >
          <div style={{
            fontSize: "0.7rem", fontWeight: 700, color: "#a78bfa",
            textTransform: "uppercase", letterSpacing: "0.5px",
          }}>
            🎧 Tap Calibration — {activeSec?.name}
          </div>

          <button
            onClick={handleTap}
            style={{
              width: "100%", height: "90px", borderRadius: "14px",
              border: `2px solid ${tapFlash ? "#a78bfa" : "#8b5cf6"}`,
              background: tapFlash ? "linear-gradient(135deg,#a78bfa,#8b5cf6)" : "rgba(139,92,246,0.1)",
              cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px",
              transition: "all 0.08s ease",
            }}
          >
            <span style={{ fontSize: "1.35rem", fontWeight: 900, color: tapFlash ? "#000" : "#fff", textTransform: "uppercase", letterSpacing: "1px" }}>
              TAP ON "1"
            </span>
            <span style={{ fontSize: "0.68rem", color: tapFlash ? "rgba(0,0,0,0.55)" : "#7c3aed" }}>
              Spacebar anywhere
            </span>
          </button>

          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: "0.75rem", color: "#d1d5db" }}>
            <span>Taps logged: <strong style={{ color: "#34d399" }}>{globalTapLog.length}</strong></span>
            {globalTapLog.length > 0 && (
              <button
                onClick={handleClearTaps}
                style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.7rem", display: "flex", alignItems: "center", gap: "4px" }}
              >
                <RotateCcw size={11} /> Clear
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ─── NudgerRow sub-component ─────────────────────────────────────────────────

interface NudgerRowProps {
  label: string;
  value: number;
  color: string;
  onNudge: (deltaMs: number) => void;
  onMarkFromPlayhead: () => void;
  disabled: boolean;
}

function NudgerRow({ label, value, color, onNudge, onMarkFromPlayhead, disabled }: NudgerRowProps) {
  const nudgeBtn = (ms: number, sign: -1 | 1) => {
    const label = sign < 0 ? `−${Math.abs(ms)}ms` : `+${ms}ms`;
    return (
      <button
        key={`${ms}${sign}`}
        onClick={() => !disabled && onNudge(sign * ms)}
        disabled={disabled}
        title={`${label}`}
        style={{
          padding: "4px 7px", borderRadius: "6px", fontSize: "0.66rem", fontWeight: 700,
          background: disabled ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.08)",
          color: disabled ? "#374151" : "#9ca3af",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "background 0.15s",
        }}
      >
        {sign < 0 ? "−" : "+"}{Math.abs(ms) >= 1000 ? `${Math.abs(ms)/1000}s` : `${Math.abs(ms)}ms`}
      </button>
    );
  };

  return (
    <div style={{
      background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "10px", padding: "10px 12px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <span style={{ fontSize: "0.68rem", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>
          {label} Timestamp
        </span>
        <span style={{ fontFamily: "monospace", fontSize: "0.75rem", fontWeight: 700, color }}>
          {value.toFixed(3)}s
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        {nudgeBtn(500, -1)}
        {nudgeBtn(100, -1)}
        {nudgeBtn(50,  -1)}
        <button
          onClick={onMarkFromPlayhead}
          title="Snap to current playhead position"
          style={{
            flexGrow: 1, padding: "4px 0", borderRadius: "6px",
            fontSize: "0.65rem", fontWeight: 700,
            background: `rgba(${color === "#38bdf8" ? "56,189,248" : "244,63,94"},0.12)`,
            border: `1px solid ${color}44`,
            color, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
          }}
        >
          <Clock size={10} /> Mark
        </button>
        {nudgeBtn(50,  +1)}
        {nudgeBtn(100, +1)}
        {nudgeBtn(500, +1)}
      </div>
    </div>
  );
}
