import React, { useState, useEffect, useRef } from "react";
import { ArrowLeft, Play, Pause, RotateCcw, Save, Trash, Plus, Lock, Unlock, Zap, RefreshCw, VolumeX, ShieldAlert, Sparkles, Check } from "lucide-react";
import { AgnosticSong, Section as AgnosticSection, BeatCountType, CalibratedBeatmap } from "../types/schemas";

interface DevCalibratorProps {
  songData: any; // AgnosticSong typecast
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

export default function DevCalibrator({
  songData,
  originalSongData,
  calibratedSongData,
  setCalibratedSongData,
  setSongData,
  setOriginalSongData,
  breaks,
  setBreaks,
  currentTime,
  videoDuration,
  player,
  throttledSeek,
  userDelaySetting,
  setUserDelaySetting,
  onBackToCatalog,
  showToast
}: DevCalibratorProps) {
  const agnosticSong = (calibratedSongData || songData) as AgnosticSong;
  const youtubeId = agnosticSong?.youtubeId || "unknown";

  const [editorSections, setEditorSections] = useState<EditorSection[]>([]);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  
  // Continuous Tapping Log
  const [globalTapLog, setGlobalTapLog] = useState<number[]>(agnosticSong?.globalTapLog || []);
  
  // Visual animation trigger for tap button
  const [tapFlash, setTapFlash] = useState(false);

  // Tracks the currently loaded song ID to prevent re-initialization on state updates
  const loadedSongIdRef = useRef<string | null>(null);

  // Load and format sections on mount / song change
  useEffect(() => {
    if (agnosticSong && loadedSongIdRef.current !== youtubeId) {
      loadedSongIdRef.current = youtubeId;
      
      // 1. Setup sections (None by default for new songs)
      const sections: EditorSection[] = [];

      const activeSections = agnosticSong.calibratedBeatmap?.sections || [];
      const sorted = [...activeSections].sort((a, b) => a.startTimestamp - b.startTimestamp);
      
      const formatted: EditorSection[] = sorted.map((sec, idx) => {
        const start = sec.startTimestamp;
        const end = (typeof sec.endTimestamp === "number" && sec.endTimestamp > start) 
          ? sec.endTimestamp 
          : ((idx < sorted.length - 1) ? sorted[idx + 1].startTimestamp : videoDuration);
        return {
          id: sec.id || `sec-${idx}-${sec.name}`,
          name: sec.name,
          emoji: sec.emoji || "🎵",
          startTimestamp: start,
          endTimestamp: end,
          focusInstrument: sec.focusInstrument || "",
          beatCountType: sec.beatCountType || "salsa-8",
          displayCounts: sec.displayCounts !== false,
          localOffsetMs: sec.localOffsetMs || 0
        };
      });

      setEditorSections(formatted.length > 0 ? formatted : sections as EditorSection[]);
      setGlobalTapLog(agnosticSong.globalTapLog || []);
    }
  }, [songData, videoDuration, youtubeId]);

  // Apply visual grid shifts on section offsets & global taps dynamically
  const applyVisualGridShifts = (sectionsList: EditorSection[], tapLog: number[]) => {
    const baseSong = originalSongData || songData;
    if (!baseSong) return;

    // Start with original beats
    let processedBeats = JSON.parse(JSON.stringify(baseSong.beats || []));

    // Apply global phase shift if a tap exists
    if (tapLog.length > 0) {
      const delay = userDelaySetting / 1000;
      const firstTap = tapLog[0] - delay;
      const originalBeat1s = processedBeats.filter((b: any) => b.beat === 1);
      
      if (originalBeat1s.length > 0) {
        let bestBeat1 = originalBeat1s[0];
        let minDiff = Infinity;
        for (const b1 of originalBeat1s) {
          const diff = Math.abs(firstTap - b1.timestamp);
          if (diff < minDiff) {
            minDiff = diff;
            bestBeat1 = b1;
          }
        }
        const shift = firstTap - bestBeat1.timestamp;
        processedBeats = processedBeats.map((b: any) => ({
          ...b,
          timestamp: parseFloat(Math.max(0, b.timestamp + shift).toFixed(3))
        }));
      }
    }

    // Apply local section offsets
    processedBeats = processedBeats.map((b: any) => {
      // Find matching section boundary
      const sec = sectionsList.find(s => b.timestamp >= s.startTimestamp && b.timestamp <= s.endTimestamp);
      if (sec && sec.localOffsetMs) {
        const offsetSec = sec.localOffsetMs / 1000;
        return {
          ...b,
          timestamp: parseFloat(Math.max(sec.startTimestamp, Math.min(sec.endTimestamp, b.timestamp + offsetSec)).toFixed(3))
        };
      }
      return b;
    }).sort((a: any, b: any) => a.timestamp - b.timestamp);

    // Apply piecewise count-modulo re-indexing per section configuration
    processedBeats = processedBeats.map((b: any, idx: number) => {
      const sec = sectionsList.find(s => b.timestamp >= s.startTimestamp && b.timestamp <= s.endTimestamp);
      if (sec) {
        const beatStyle = sec.beatCountType;
        if (beatStyle === "bachata-4") {
          return { ...b, beat: ((idx % 4) + 1) };
        } else if (beatStyle === "swing-6") {
          return { ...b, beat: ((idx % 6) + 1) };
        } else if (beatStyle === "waltz-3") {
          return { ...b, beat: ((idx % 3) + 1) };
        } else if (beatStyle === "none") {
          return { ...b, beat: 0 };
        }
      }
      // default salsa-8
      return { ...b, beat: ((idx % 8) + 1) };
    });

    const updated = {
      ...(calibratedSongData || songData),
      beats: processedBeats,
      sections: sectionsList.map(s => ({
        id: s.id,
        name: s.name,
        emoji: s.emoji,
        startTimestamp: s.startTimestamp,
        endTimestamp: s.endTimestamp,
        focusInstrument: s.focusInstrument,
        beatCountType: s.beatCountType,
        displayCounts: s.displayCounts,
        localOffsetMs: s.localOffsetMs
      })),
      // Flat compatibility properties:
      metadata: {
        ...(calibratedSongData || songData).metadata,
        bpm: (calibratedSongData || songData).metadata?.bpm || 120
      }
    };

    setCalibratedSongData(updated);
  };

  // Sync section properties to memory
  const syncSections = (updatedList: EditorSection[]) => {
    setEditorSections(updatedList);
    applyVisualGridShifts(updatedList, globalTapLog);
  };

  // TAP ON 1 Action Logger
  const handleTap = () => {
    if (!player) return;
    
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 80);

    // If a section is focused, check bounds
    if (focusedSectionId) {
      const activeSec = editorSections.find(s => s.id === focusedSectionId);
      if (activeSec) {
        if (currentTime < activeSec.startTimestamp || currentTime > activeSec.endTimestamp) {
          showToast("⚠️ Tap ignored: playback is outside section boundaries!");
          return;
        }
      }
    }

    const updatedTaps = [...globalTapLog, currentTime].sort((a, b) => a - b);
    setGlobalTapLog(updatedTaps);
    applyVisualGridShifts(editorSections, updatedTaps);
  };

  // Global spacebar event handler for tapping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        handleTap();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedSectionId, currentTime, globalTapLog, editorSections]);

  const handleFocusSection = (secId: string) => {
    if (focusedSectionId === secId) {
      setFocusedSectionId(null);
    } else {
      setFocusedSectionId(secId);
      const sec = editorSections.find(s => s.id === secId);
      if (sec) {
        throttledSeek(sec.startTimestamp, true);
        showToast(`🔍 Focused on ${sec.name}.`);
      }
    }
  };

  // Draggable timeline boundary adjustment with contiguous two-way snapping
  const handleUpdateSectionTimes = (id: string, field: "startTimestamp" | "endTimestamp", value: number) => {
    const numericVal = parseFloat(value.toFixed(2));
    
    const secIdx = editorSections.findIndex(s => s.id === id);
    if (secIdx === -1) return;

    const updated = [...editorSections];
    const sec = { ...updated[secIdx] };

    if (field === "startTimestamp") {
      const minVal = 0;
      const maxVal = sec.endTimestamp;
      const boundedVal = Math.max(minVal, Math.min(maxVal, numericVal));
      sec.startTimestamp = boundedVal;

      // Snapping: update previous section's end if it exists
      if (secIdx > 0) {
        updated[secIdx - 1] = {
          ...updated[secIdx - 1],
          endTimestamp: boundedVal
        };
      }
    } else {
      const minVal = sec.startTimestamp;
      const maxVal = videoDuration;
      const boundedVal = Math.max(minVal, Math.min(maxVal, numericVal));
      sec.endTimestamp = boundedVal;

      // Snapping: update next section's start if it exists
      if (secIdx < updated.length - 1) {
        updated[secIdx + 1] = {
          ...updated[secIdx + 1],
          startTimestamp: boundedVal
        };
      }
    }

    updated[secIdx] = sec;

    const sorted = [...updated].sort((a, b) => a.startTimestamp - b.startTimestamp);
    syncSections(sorted);
    throttledSeek(numericVal, false);
  };

  const handleUpdateSectionField = (id: string, field: keyof EditorSection, value: any) => {
    const updated = editorSections.map(sec => {
      if (sec.id === id) {
        return { ...sec, [field]: value };
      }
      return sec;
    });
    syncSections(updated);
  };

  const handleAddNewSection = () => {
    if (!player) return;
    
    let defaultStart = 0;
    if (editorSections.length > 0) {
      // Snap to end of previous section
      const lastSec = editorSections[editorSections.length - 1];
      defaultStart = lastSec.endTimestamp;
    }

    if (defaultStart >= videoDuration) {
      defaultStart = Math.max(0, videoDuration - 10);
    }
    
    const newSec: EditorSection = {
      id: `sec-new-${Date.now()}`,
      name: "New Section",
      emoji: "🎵",
      startTimestamp: defaultStart,
      endTimestamp: Math.min(videoDuration, defaultStart + 10),
      focusInstrument: "",
      beatCountType: "salsa-8",
      displayCounts: true,
      localOffsetMs: 0
    };
    
    const updated = [...editorSections, newSec].sort((a, b) => a.startTimestamp - b.startTimestamp);
    syncSections(updated);
    showToast("➕ Added new section!");
  };

  const handleDeleteSection = (id: string) => {
    const updated = editorSections.filter(sec => sec.id !== id);
    syncSections(updated);
    if (focusedSectionId === id) setFocusedSectionId(null);
    showToast("🗑️ Section removed.");
  };

  const handleClearTaps = () => {
    setGlobalTapLog([]);
    applyVisualGridShifts(editorSections, []);
    showToast("🔄 Continuous taps cleared.");
  };

  // Full manual beatmap commit back to disk
  const handleFinalSaveToDisk = () => {
    const activeBeatmap = calibratedSongData || songData;
    const baseSong = originalSongData || songData;
    if (!activeBeatmap || !baseSong) return;

    const payload = {
      youtubeId: youtubeId,
      activeBeatmap: {
        ...activeBeatmap,
        isCalibrated: true,
        globalTapLog: globalTapLog,
        globalReactionDelayMs: userDelaySetting,
        calibratedBeatmap: {
          bpm: activeBeatmap.calibratedBeatmap?.bpm || activeBeatmap.metadata?.bpm || 120,
          beats: activeBeatmap.beats,
          sections: editorSections.map(s => ({
            id: s.id,
            name: s.name,
            emoji: s.emoji,
            startTimestamp: s.startTimestamp,
            endTimestamp: s.endTimestamp,
            focusInstrument: s.focusInstrument,
            beatCountType: s.beatCountType,
            displayCounts: s.displayCounts,
            localOffsetMs: s.localOffsetMs
          }))
        },
        breaks: breaks
      },
      originalBeatmap: {
        ...baseSong,
        breaks: breaks
      },
      calibration: {
        recordedAt: new Date().toISOString(),
        youtubeId: youtubeId,
        globalTapLog: globalTapLog,
        reactionDelayMs: userDelaySetting,
        sections: editorSections
      }
    };

    showToast("💾 Saving calibrated song permanently to disk...");

    fetch("/api/save-beatmap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(res => {
        if (!res.ok) throw new Error("Server write failed");
        return res.json();
      })
      .then(result => {
        if (result.success) {
          setOriginalSongData(JSON.parse(JSON.stringify(activeBeatmap)));
          setSongData(JSON.parse(JSON.stringify(activeBeatmap)));
          showToast("🎉 Calibrated song successfully saved and catalog updated!");
        } else {
          throw new Error(result.error);
        }
      })
      .catch(err => {
        console.error("Final save failed:", err);
        showToast("❌ Save to disk failed. Check console.");
      });
  };

  const activeFocusedSec = editorSections.find(s => s.id === focusedSectionId);

  return (
    <div className="glass-panel dev-calibrator-workbench" style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "20px", width: "100%", border: "1px solid rgba(139, 92, 246, 0.3)", background: "rgba(10, 5, 20, 0.75)", backdropFilter: "blur(12px)", borderRadius: "20px" }}>

      {/* Upper control header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "12px" }}>
        <span style={{ fontSize: "1rem", fontWeight: "900", color: "#c084fc", textTransform: "uppercase", letterSpacing: "1px", display: "flex", alignItems: "center", gap: "8px" }}>
          🛠️ Style-Agnostic Downbeat Workbench
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            onClick={handleFinalSaveToDisk}
            style={{
              background: "linear-gradient(135deg, #34d399, #059669)",
              border: "none",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: "8px",
              fontSize: "0.75rem",
              fontWeight: "900",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              boxShadow: "0 4px 10px rgba(52, 211, 153, 0.2)"
            }}
          >
            <Check size={14} /> Commit Song Calibration
          </button>
          <button 
            onClick={onBackToCatalog}
            style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", color: "#f87171", padding: "4px 12px", borderRadius: "8px", fontSize: "0.75rem", fontWeight: "700", cursor: "pointer", transition: "all 0.2s ease" }}
          >
            Exit Calibrator
          </button>
        </div>
      </div>

      {/* Global / Continuous Listening Deck (Only rendered if a section is focused) */}
      {focusedSectionId !== null && editorSections.length > 0 && (
        <div 
          className={`glass-panel listening-tapping-deck ${tapFlash ? "active-flash" : ""}`}
          style={{
            padding: "24px",
            background: "linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(99, 102, 241, 0.03) 100%)",
            border: "2px solid rgba(139, 92, 246, 0.4)",
            borderRadius: "16px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            alignItems: "center",
            boxShadow: tapFlash ? "0 0 40px rgba(139, 92, 246, 0.3)" : "none",
            transition: "all 0.1s ease"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(139, 92, 246, 0.15)", padding: "6px 14px", borderRadius: "20px", border: "1px solid rgba(139, 92, 246, 0.3)" }}>
            <span style={{ fontSize: "1.4rem" }}>{activeFocusedSec ? activeFocusedSec.emoji : "🎧"}</span>
            <span style={{ fontWeight: "800", color: "#fff", textTransform: "uppercase", fontSize: "0.85rem", letterSpacing: "0.5px" }}>
              {activeFocusedSec ? `Focusing: ${activeFocusedSec.name}` : "GLOBAL TAPPING CALIBRATION MODE"}
            </span>
          </div>

          {/* TAP ON 1 Button */}
          <button
            onClick={handleTap}
            style={{
              width: "100%",
              height: "100px",
              borderRadius: "18px",
              border: "3px solid #8b5cf6",
              background: tapFlash ? "linear-gradient(135deg, #a78bfa, #8b5cf6)" : "rgba(139, 92, 246, 0.1)",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              boxShadow: tapFlash ? "0 0 25px rgba(167, 139, 250, 0.4)" : "none",
              transition: "all 0.08s ease"
            }}
          >
            <span style={{ fontSize: "1.5rem", fontWeight: "900", color: tapFlash ? "#000" : "#fff", textTransform: "uppercase", letterSpacing: "1px" }}>TAP ON "1"</span>
            <span style={{ fontSize: "0.75rem", color: tapFlash ? "rgba(0,0,0,0.6)" : "#a78bfa" }}>
              (Or press Spacebar anywhere to log downbeats)
            </span>
          </button>

          {/* Taps count banner */}
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: "0.8rem", color: "#e5e7eb", fontWeight: "600" }}>
            <span>Taps logged: <strong style={{ color: "#34d399", fontSize: "0.95rem" }}>{globalTapLog.length}</strong></span>
            {globalTapLog.length > 0 && (
              <button 
                onClick={handleClearTaps}
                style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "4px" }}
              >
                <RotateCcw size={12} /> Clear Taps
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sections Manager Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.9rem", fontWeight: "800", color: "#38bdf8", textTransform: "uppercase", letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: "6px" }}>
          🏷️ Style-Agnostic Structural Sections
        </span>
        <button 
          onClick={handleAddNewSection} 
          disabled={focusedSectionId !== null}
          style={{ padding: "6px 14px", fontSize: "0.75rem", fontWeight: "700", background: focusedSectionId ? "rgba(255,255,255,0.02)" : "rgba(56, 189, 248, 0.15)", border: `1px solid ${focusedSectionId ? "rgba(255,255,255,0.05)" : "rgba(56, 189, 248, 0.3)"}`, color: focusedSectionId ? "#4b5563" : "#38bdf8", cursor: focusedSectionId ? "not-allowed" : "pointer", borderRadius: "8px", transition: "all 0.2s ease" }}
        >
          ➕ Add Section
        </button>
      </div>

      {/* Sections List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {editorSections.map((sec, idx) => {
          const isFocused = focusedSectionId === sec.id;
          const isAnyFocused = focusedSectionId !== null;
          const isDimmed = isAnyFocused && !isFocused;

          return (
            <div 
              key={sec.id} 
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                padding: "16px",
                borderRadius: "14px",
                border: isFocused ? "2px solid #8b5cf6" : "1px solid rgba(255,255,255,0.06)",
                background: isFocused ? "rgba(139, 92, 246, 0.04)" : "rgba(255,255,255,0.02)",
                opacity: isDimmed ? 0.35 : 1,
                pointerEvents: isDimmed ? "none" : "auto",
                boxShadow: isFocused ? "0 4px 20px rgba(139, 92, 246, 0.1)" : "none",
                transition: "all 0.3s ease"
              }}
            >
              {/* Header row */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <input 
                  type="text" 
                  value={sec.emoji}
                  onChange={(e) => handleUpdateSectionField(sec.id, "emoji", e.target.value)}
                  placeholder="Emoji"
                  disabled={isDimmed}
                  style={{ width: "38px", textAlign: "center", padding: "6px", fontSize: "0.9rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.3)", color: "#fff" }}
                />
                <input 
                  type="text" 
                  value={sec.name} 
                  onChange={(e) => handleUpdateSectionField(sec.id, "name", e.target.value)}
                  placeholder="e.g. Verse, Chorus, Montuno"
                  disabled={isDimmed}
                  style={{ flexGrow: 1, padding: "6px 12px", fontSize: "0.85rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.3)", color: "#fff", fontWeight: "bold" }}
                />
                
                {/* Focus toggle button */}
                <button
                  onClick={() => handleFocusSection(sec.id)}
                  style={{
                    background: isFocused ? "rgba(139, 92, 246, 0.25)" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${isFocused ? "rgba(139, 92, 246, 0.5)" : "rgba(255,255,255,0.1)"}`,
                    color: isFocused ? "#c084fc" : "#9ca3af",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    fontSize: "0.75rem",
                    fontWeight: "bold",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    transition: "all 0.2s ease"
                  }}
                  title={isFocused ? "Release section focus" : "Focus on this section to calibrate"}
                >
                  {isFocused ? <Lock size={12} /> : <Unlock size={12} />}
                  <span>{isFocused ? "Focused" : "Focus"}</span>
                </button>

                {/* Delete button */}
                {!isFocused && !isAnyFocused && sec.id !== "sec-default" && (
                  <button 
                    onClick={() => handleDeleteSection(sec.id)}
                    style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", color: "#f87171", padding: "6px", borderRadius: "8px", cursor: "pointer" }}
                    title="Delete section"
                  >
                    <Trash size={14} />
                  </button>
                )}
              </div>

              {/* Agnostic Configuration Block */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                <label style={{ fontSize: "0.7rem", color: "#9ca3af", fontWeight: "bold", textTransform: "uppercase" }}>Beat Count Modulo</label>
                <select
                  value={sec.beatCountType}
                  onChange={(e) => handleUpdateSectionField(sec.id, "beatCountType", e.target.value)}
                  disabled={isDimmed}
                  style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", color: "#fff", fontSize: "0.8rem", outline: "none" }}
                >
                  <option value="salsa-8">Salsa 8-Count (1-8)</option>
                  <option value="bachata-4">Bachata 4-Count (1-4)</option>
                  <option value="swing-6">Swing 6-Count (1-6)</option>
                  <option value="waltz-3">Waltz 3-Count (1-3)</option>
                  <option value="none">No Metronome / Free Time (none)</option>
                </select>
              </div>

              {/* Focus Instrument */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                <span style={{ fontSize: "0.75rem", color: "#9ca3af", width: "110px", flexShrink: 0 }}>Focus Instrument:</span>
                <input 
                  type="text" 
                  value={sec.focusInstrument} 
                  onChange={(e) => handleUpdateSectionField(sec.id, "focusInstrument", e.target.value)}
                  placeholder="e.g. Cowbell (Campana)"
                  disabled={isDimmed}
                  style={{ flexGrow: 1, padding: "5px 10px", fontSize: "0.75rem", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)", color: "#e5e7eb" }}
                />
              </div>


              {/* Sliders for boundaries */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
                {/* Start boundary */}
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#9ca3af" }}>
                    <span>Start Timestamp</span>
                    <strong style={{ color: "#38bdf8" }}>{sec.startTimestamp.toFixed(2)}s</strong>
                  </div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input 
                      type="range" 
                      min="0" 
                      max={videoDuration || 300} 
                      step="0.05" 
                      value={sec.startTimestamp}
                      disabled={isDimmed || sec.id === "sec-default"}
                      onChange={(e) => handleUpdateSectionTimes(sec.id, "startTimestamp", parseFloat(e.target.value))}
                      style={{ flexGrow: 1, accentColor: "#38bdf8" }}
                    />
                    <button 
                      className="btn-dev-sync" 
                      disabled={isDimmed || sec.id === "sec-default"}
                      onClick={() => { if (!player) return; handleUpdateSectionTimes(sec.id, "startTimestamp", player.getCurrentTime()); }}
                      style={{ padding: "4px 8px", fontSize: "0.7rem" }}
                    >
                      Mark
                    </button>
                  </div>
                </div>

                {/* End boundary */}
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#9ca3af" }}>
                    <span>End Timestamp</span>
                    <strong style={{ color: "#f43f5e" }}>{sec.endTimestamp.toFixed(2)}s</strong>
                  </div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input 
                      type="range" 
                      min="0" 
                      max={videoDuration || 300} 
                      step="0.05" 
                      value={sec.endTimestamp}
                      disabled={isDimmed || sec.id === "sec-default"}
                      onChange={(e) => handleUpdateSectionTimes(sec.id, "endTimestamp", parseFloat(e.target.value))}
                      style={{ flexGrow: 1, accentColor: "#f43f5e" }}
                    />
                    <button 
                      className="btn-dev-sync" 
                      disabled={isDimmed || sec.id === "sec-default"}
                      onClick={() => { if (!player) return; handleUpdateSectionTimes(sec.id, "endTimestamp", player.getCurrentTime()); }}
                      style={{ padding: "4px 8px", fontSize: "0.7rem" }}
                    >
                      Mark
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {editorSections.length === 0 && (
          <span style={{ fontSize: "0.8rem", color: "#6b7280", fontStyle: "italic", textAlign: "center", padding: "12px" }}>No sections defined yet. Click "Add Section" above!</span>
        )}
      </div>
    </div>
  );
}
