import React, { useState, useEffect, useRef } from "react";
import { useSyncEngine } from "./hooks/useSyncEngine";
import { Play, Pause, RotateCcw, Music } from "lucide-react";

// ==========================================================================
// Piecewise-Linear Warping Helper Algorithms
// ==========================================================================

const applyWarpToBeats = (originalBeats, activeAnchors) => {
  if (activeAnchors.length === 0) {
    return JSON.parse(JSON.stringify(originalBeats));
  }

  return originalBeats.map((b, idx) => {
    let warpedTime = b.timestamp;
    
    // Find bounding anchors
    let leftAnchor = null;
    let rightAnchor = null;

    for (let a of activeAnchors) {
      if (a.beatIndex <= idx) {
        leftAnchor = a;
      } else if (a.beatIndex > idx && !rightAnchor) {
        rightAnchor = a;
      }
    }

    if (leftAnchor && rightAnchor) {
      // Case 1: Piecewise linear interpolation between left and right anchors
      const oLeft = leftAnchor.originalTime;
      const oRight = rightAnchor.originalTime;
      const tLeft = leftAnchor.tappedTime;
      const tRight = rightAnchor.tappedTime;
      
      const dO = oRight - oLeft;
      const dT = tRight - tLeft;
      
      if (dO > 0) {
        warpedTime = tLeft + ((b.timestamp - oLeft) / dO) * dT;
      } else {
        warpedTime = tLeft;
      }
    } else if (leftAnchor) {
      // Case 2: Extrapolation after the last anchor (constant offset)
      const offset = leftAnchor.tappedTime - leftAnchor.originalTime;
      warpedTime = b.timestamp + offset;
    } else if (rightAnchor) {
      // Case 3: Extrapolation before the first anchor (constant offset)
      const offset = rightAnchor.tappedTime - rightAnchor.originalTime;
      warpedTime = b.timestamp + offset;
    }

    // Piecewise modular re-indexing (forces the anchored beats to count 1)
    let newBeatNum = b.beat;
    if (leftAnchor) {
      newBeatNum = ((idx - leftAnchor.beatIndex) % 8 + 8) % 8 + 1;
    } else if (rightAnchor) {
      newBeatNum = ((idx - rightAnchor.beatIndex) % 8 + 8) % 8 + 1;
    }

    return {
      timestamp: parseFloat(Math.max(0, warpedTime).toFixed(3)),
      beat: newBeatNum
    };
  });
};

const applyWarpToSections = (originalSections, originalBeats, warpedBeats) => {
  if (!originalSections || originalSections.length === 0) return [];
  if (warpedBeats.length === 0) return JSON.parse(JSON.stringify(originalSections));

  return originalSections.map((sec) => {
    const sOld = sec.startTimestamp;
    
    // Find bounding original beats
    let leftIdx = 0;
    let rightIdx = originalBeats.length - 1;

    for (let i = 0; i < originalBeats.length; i++) {
      if (originalBeats[i].timestamp <= sOld) {
        leftIdx = i;
      } else {
        rightIdx = i;
        break;
      }
    }

    const oLeft = originalBeats[leftIdx].timestamp;
    const oRight = originalBeats[rightIdx].timestamp;
    const wLeft = warpedBeats[leftIdx].timestamp;
    const wRight = warpedBeats[rightIdx].timestamp;

    let sNew = wLeft;
    const dO = oRight - oLeft;
    
    if (dO > 0) {
      const dT = wRight - wLeft;
      sNew = wLeft + ((sOld - oLeft) / dO) * dT;
    } else {
      sNew = wLeft;
    }

    return {
      ...sec,
      startTimestamp: parseFloat(Math.max(0, sNew).toFixed(3))
    };
  });
};

export default function App() {
  const [songData, setSongData] = useState(null);
  
  // Media states
  const [player, setPlayer] = useState(null);
  const [playerState, setPlayerState] = useState(-1); 
  const [useLocalAudio, setUseLocalAudio] = useState(false); // default to YouTube Player mode
  const [localPlaying, setLocalPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [apiReady, setApiReady] = useState(false);

  // Creator Diagnostic & Calibration states
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [originalSongData, setOriginalSongData] = useState(null);
  const [calibratedSongData, setCalibratedSongData] = useState(null);
  const [calibrationStats, setCalibrationStats] = useState(null);
  const [anchors, setAnchors] = useState([]);
  const [rawTaps, setRawTaps] = useState([]);       // raw clock times when user pressed button
  const [estimatedDelay, setEstimatedDelay] = useState(null); // ms — auto-computed reaction delay
  const [userDelaySetting, setUserDelaySetting] = useState(220); // ms — user-adjustable reaction delay
  const [toastMessage, setToastMessage] = useState(null);

  const playerRef = useRef(null);
  const localAudioRef = useRef(null);
  const headerClicksRef = useRef(0);

  // Helper to show modern fading glass toast notifications
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // Compute median human reaction delay from raw taps vs nearest original beat-1
  const computeReactionDelay = (taps, originalBeats) => {
    if (!taps || taps.length < 2 || !originalBeats) return null;
    const beat1Times = originalBeats.filter(b => b.beat === 1).map(b => b.timestamp);
    const delays = taps.map(tapTime => {
      // Find the nearest beat-1 that comes BEFORE the tap (tap is always after hearing)
      let bestDelay = null;
      let bestDiff = Infinity;
      for (const bt of beat1Times) {
        const diff = tapTime - bt;
        if (diff > 0 && diff < 2000 && diff < bestDiff) { // reaction window 0–2000ms
          bestDiff = diff;
          bestDelay = diff;
        }
      }
      return bestDelay;
    }).filter(d => d !== null);

    if (delays.length === 0) return null;
    const sorted = [...delays].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]; // median in seconds
  };

  // 1. Fetch song beatmap JSON generated by our advanced Salsa analyser
  useEffect(() => {
    fetch("/songs/66HCBysrJS8.json")
      .then((res) => {
        if (!res.ok) throw new Error("Catalog load failed");
        return res.json();
      })
      .then((data) => {
        setSongData(data);
        setOriginalSongData(JSON.parse(JSON.stringify(data)));
        setCalibratedSongData(JSON.parse(JSON.stringify(data)));
        console.log("[App] Loaded advanced beatmap successfully for:", data.metadata.songTitle);
      })
      .catch((err) => {
        console.error("[App] Failed to load song beatmap JSON:", err);
      });
  }, []);

  // 2. Load the YouTube Player API script dynamically in background
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      setApiReady(true);
      return;
    }

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName("script")[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      setApiReady(true);
      console.log("[App] YouTube Player API loaded.");
    };
  }, []);

  // 3. Construct YouTube Player when API is ready
  useEffect(() => {
    if (!apiReady || !songData || player || useLocalAudio) return;

    try {
      const ytPlayer = new window.YT.Player("yt-player", {
        videoId: songData.metadata.youtubeId,
        playerVars: {
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          showinfo: 0,
          enablejsapi: 1
        },
        events: {
          onReady: (event) => {
            setPlayer(event.target);
            console.log("[App] YouTube Player Ready.");
          },
          onStateChange: (event) => {
            setPlayerState(event.data);
          }
        }
      });
      playerRef.current = ytPlayer;
    } catch (err) {
      console.error("[App] Error constructing YouTube Player: ", err);
    }

    return () => {
      if (playerRef.current && typeof playerRef.current.destroy === "function") {
        playerRef.current.destroy();
        setPlayer(null);
      }
    };
  }, [apiReady, songData, useLocalAudio]);

  // 4. Hook into the high-precision sync engine (supplying local audio ref, toggle parameter)
  const { currentTime, currentBeat, activeSection, synchronizeAnchors } = useSyncEngine(
    player,
    calibratedSongData || songData,
    localAudioRef,
    useLocalAudio,
    0, // zero AV latency offset
    0  // zero static grid count shift
  );

  // 5. Sync rate changes to local audio element directly
  useEffect(() => {
    if (useLocalAudio && localAudioRef.current) {
      localAudioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, useLocalAudio]);

  // 6. Touch Controller click handlers
  const handlePlayToggle = () => {
    try {
      if (useLocalAudio) {
        const audio = localAudioRef.current;
        if (!audio) return;
        
        if (audio.paused) {
          audio.play();
          setLocalPlaying(true);
        } else {
          audio.pause();
          setLocalPlaying(false);
        }
      } else {
        if (!player) return;
        if (playerState === 1) {
          player.pauseVideo();
        } else {
          player.playVideo();
        }
      }
      setTimeout(synchronizeAnchors, 50);
    } catch (err) {
      console.warn("PlayToggle error: ", err);
    }
  };

  const handleRewind = () => {
    try {
      if (useLocalAudio) {
        const audio = localAudioRef.current;
        if (!audio) return;
        
        let target = audio.currentTime - 10;
        if (target < 0) target = 0;
        audio.currentTime = target;
        console.log(`[Local Audio] Rewinding to: ${target.toFixed(2)}s`);
      } else {
        if (!player) return;
        const current = player.getCurrentTime();
        let target = current - 10;
        if (target < 0) target = 0;
        player.seekTo(target, true);
        console.log(`[YouTube] Rewinding to: ${target.toFixed(2)}s`);
      }
      setTimeout(synchronizeAnchors, 100);
    } catch (err) {
      console.warn("Rewind error: ", err);
    }
  };

  const handleSpeedChange = (rate) => {
    setPlaybackRate(rate);
    try {
      if (useLocalAudio) {
        const audio = localAudioRef.current;
        if (audio) {
          audio.playbackRate = rate;
        }
      } else {
        if (player) {
          player.setPlaybackRate(rate);
        }
      }
      setTimeout(synchronizeAnchors, 50);
    } catch (err) {
      console.warn("SpeedChange error: ", err);
    }
  };

  // Toggle modes dynamically
  const toggleSourceMode = (mode) => {
    try {
      if (useLocalAudio && localAudioRef.current) {
        localAudioRef.current.pause();
        setLocalPlaying(false);
      } else if (player) {
        player.pauseVideo();
      }
    } catch (e) {}

    setUseLocalAudio(mode === "local");
    setTimeout(synchronizeAnchors, 100);
  };

  const getContainerClass = () => {
    if (!activeSection) return "";
    const name = activeSection.name.toLowerCase();
    if (name.includes("intro")) return "active-intro";
    if (name.includes("verse") || name.includes("groove")) return "active-verse";
    if (name.includes("chorus") || name.includes("montuno") || name.includes("mambo")) return "active-montuno";
    return "";
  };

  const getSectionColorStyles = () => {
    if (!activeSection) return {};
    const name = activeSection.name.toLowerCase();
    if (name.includes("intro")) return { background: "hsl(var(--salsa-intro-bg))", border: "1px solid hsl(var(--salsa-intro-accent) / 0.15)" };
    if (name.includes("verse") || name.includes("groove")) return { background: "hsl(var(--salsa-verse-bg))", border: "1px solid hsl(var(--salsa-verse-accent) / 0.15)" };
    if (name.includes("chorus") || name.includes("montuno") || name.includes("mambo")) return { background: "hsl(var(--salsa-montuno-bg))", border: "1px solid hsl(var(--salsa-montuno-accent) / 0.15)" };
    return {};
  };

  const isActuallyPlaying = useLocalAudio ? localPlaying : playerState === 1;

  // ==========================================================================
  // Creator Multi-Anchor & Permanent save Click Handlers
  // ==========================================================================
  
  const handleTapOnOne = () => {
    if (!isActuallyPlaying) {
      showToast("⚠️ Play the audio to calibrate downbeat!");
      return;
    }

    const tapTime = currentTime;
    const baseSong = originalSongData || songData;
    if (!baseSong || !baseSong.beats || baseSong.beats.length === 0) return;

    // 1. Record the raw tap timestamp FIRST — this is the ground truth
    const newRawTaps = [...rawTaps, tapTime];
    setRawTaps(newRawTaps);

    // 2. Auto-update reaction delay estimate (live, after each tap)
    const delay = computeReactionDelay(newRawTaps, baseSong.beats);
    setEstimatedDelay(delay);

    const delayMs = delay ? Math.round(delay * 1000) : '?';
    showToast(`🎯 Tap #${newRawTaps.length} recorded!`);
  };

  const handleNormalizeBeatmap = () => {
    const baseSong = originalSongData || songData;
    if (!baseSong) return;

    if (rawTaps.length === 0) {
      showToast("⚠️ Record at least 1 tap to run normalization!");
      return;
    }

    const delay = userDelaySetting / 1000; // in seconds

    // 1. Single Tap mode: Global Grid Shift
    if (rawTaps.length === 1) {
      const tapTime = rawTaps[0];
      const correctedTime = tapTime - delay;

      const beat1Times = baseSong.beats
        .map((b, idx) => ({ ...b, originalIndex: idx }))
        .filter(b => b.beat === 1);

      let bestBeat1 = null;
      let minDiff = Infinity;

      for (const b1 of beat1Times) {
        const diff = Math.abs(correctedTime - b1.timestamp);
        if (diff < minDiff) {
          minDiff = diff;
          bestBeat1 = b1;
        }
      }

      if (!bestBeat1) {
        showToast("⚠️ Could not match tap to any downbeat.");
        return;
      }

      const shift = correctedTime - bestBeat1.timestamp;

      // Apply global shift
      const shiftedBeats = baseSong.beats.map(b => ({
        ...b,
        timestamp: parseFloat(Math.max(0, b.timestamp + shift).toFixed(3))
      }));
      const shiftedSections = baseSong.sections.map(sec => ({
        ...sec,
        startTimestamp: parseFloat(Math.max(0, sec.startTimestamp + shift).toFixed(3))
      }));

      setAnchors([{
        beatIndex: bestBeat1.originalIndex,
        originalTime: bestBeat1.timestamp,
        tappedTime: correctedTime
      }]);

      setCalibratedSongData({
        ...baseSong,
        beats: shiftedBeats,
        sections: shiftedSections
      });

      setCalibrationStats({
        totalTaps: 1,
        matchedTaps: 1,
        outliersCount: 0,
        estimatedDelayMs: userDelaySetting,
        medianDiffMs: Math.round(shift * 1000)
      });

      showToast(`✅ Global grid shifted by ${Math.round(shift * 1000)}ms!`);
      return;
    }

    // 2. Multi-Tap mode: Piecewise-Linear Warping with Outlier Rejection
    // Compute corrected tap times
    const correctedTaps = rawTaps.map(t => t - delay);

    // Match each corrected tap to the nearest beat-1 in original song data
    const beat1Times = baseSong.beats
      .map((b, idx) => ({ ...b, originalIndex: idx }))
      .filter(b => b.beat === 1);

    const matchedPairs = [];
    correctedTaps.forEach(ct => {
      let bestBeat1 = null;
      let minDiff = Infinity;

      for (const b1 of beat1Times) {
        const diff = Math.abs(ct - b1.timestamp);
        if (diff < minDiff) {
          minDiff = diff;
          bestBeat1 = b1;
        }
      }

      if (bestBeat1 && minDiff < 0.400) { // must be within 400ms of a beat-1
        matchedPairs.push({
          correctedTime: ct,
          originalTime: bestBeat1.timestamp,
          beatIndex: bestBeat1.originalIndex,
          diff: ct - bestBeat1.timestamp
        });
      }
    });

    if (matchedPairs.length === 0) {
      showToast("⚠️ No taps could be matched to downbeats. Try tapping more precisely.");
      return;
    }

    // Outlier Rejection (Median timing difference based filtering)
    const diffs = matchedPairs.map(p => p.diff);
    const sortedDiffs = [...diffs].sort((a, b) => a - b);
    const medianDiff = sortedDiffs[Math.floor(sortedDiffs.length / 2)];

    // Filter out any tap whose diff deviates from the median diff by more than 150ms
    const cleanPairs = matchedPairs.filter(p => Math.abs(p.diff - medianDiff) <= 0.150);
    const outlierCount = matchedPairs.length - cleanPairs.length;

    if (cleanPairs.length === 0) {
      showToast("⚠️ All taps were classified as outliers. Please try again.");
      return;
    }

    // Create clean warp anchors
    const anchorsMap = {};
    cleanPairs.forEach(p => {
      if (!anchorsMap[p.beatIndex]) {
        anchorsMap[p.beatIndex] = {
          beatIndex: p.beatIndex,
          originalTime: p.originalTime,
          tappedTimesList: []
        };
      }
      anchorsMap[p.beatIndex].tappedTimesList.push(p.correctedTime);
    });

    const cleanAnchors = Object.values(anchorsMap).map(a => {
      const avgTappedTime = a.tappedTimesList.reduce((sum, val) => sum + val, 0) / a.tappedTimesList.length;
      return {
        beatIndex: a.beatIndex,
        originalTime: a.originalTime,
        tappedTime: avgTappedTime
      };
    }).sort((a, b) => a.beatIndex - b.beatIndex);

    let finalAnchors = cleanAnchors;

    // Tier 3: Dense Smooth Warp (If > 20 anchors, apply a Moving-Average filter to cancel timing jitter)
    if (cleanAnchors.length > 20) {
      finalAnchors = cleanAnchors.map((anchor, idx) => {
        const radius = 2; // window of 5 anchors
        let sumOffset = 0;
        let count = 0;
        for (let i = -radius; i <= radius; i++) {
          const n = cleanAnchors[idx + i];
          if (n) {
            sumOffset += (n.tappedTime - n.originalTime);
            count++;
          }
        }
        const avgOffset = sumOffset / count;
        return {
          ...anchor,
          tappedTime: anchor.originalTime + avgOffset
        };
      });
    }

    setAnchors(finalAnchors);

    // Apply Piecewise-Linear Warping
    const shiftedBeats = applyWarpToBeats(baseSong.beats, finalAnchors);
    const shiftedSections = applyWarpToSections(baseSong.sections, baseSong.beats, shiftedBeats);

    setCalibratedSongData({
      ...baseSong,
      sections: shiftedSections,
      beats: shiftedBeats
    });

    // Update UI Stats & Show Toast
    setCalibrationStats({
      totalTaps: rawTaps.length,
      matchedTaps: cleanPairs.length,
      outliersCount: outlierCount,
      estimatedDelayMs: userDelaySetting,
      medianDiffMs: Math.round(medianDiff * 1000)
    });

    showToast(`✅ Normalized! ${cleanPairs.length}/${rawTaps.length} taps matched. Outliers: ${outlierCount}`);
  };  const handleResetCalibration = () => {
    if (originalSongData) {
      setCalibratedSongData(JSON.parse(JSON.stringify(originalSongData)));
    }
    setAnchors([]);
    setRawTaps([]);
    setEstimatedDelay(null);
    setCalibrationStats(null);
    localStorage.removeItem("armada_raw_taps");
    showToast("🔄 Reset all anchors and taps. Restored original raw grid.");
  };

  // Skip audio to ~30s so user can bypass the difficult intro
  const handleSkipIntro = () => {
    try {
      if (useLocalAudio && localAudioRef.current) {
        localAudioRef.current.currentTime = 30;
      } else if (player) {
        player.seekTo(30, true);
      }
      showToast("⏩ Skipped to 0:30 — intro bypassed!");
      setTimeout(synchronizeAnchors, 100);
    } catch (e) {
      console.warn("Skip intro error:", e);
    }
  };

  const handleCopyCalibratedJson = () => {
    const dataToExport = calibratedSongData || songData;
    if (!dataToExport) return;
    
    try {
      const jsonStr = JSON.stringify(dataToExport, null, 2);
      navigator.clipboard.writeText(jsonStr)
        .then(() => {
          showToast("📋 Copied calibrated JSON to clipboard!");
        })
        .catch(err => {
          console.error("Failed to copy JSON: ", err);
          showToast("❌ Copy failed. Check console.");
        });
    } catch (e) {
      console.error(e);
      showToast("❌ Error converting to JSON.");
    }
  };

  const handleDownloadCalibratedJson = () => {
    const dataToExport = calibratedSongData || songData;
    if (!dataToExport) return;

    try {
      const youtubeId = dataToExport.metadata.youtubeId || "beatmap";
      const filename = `${youtubeId}_calibrated.json`;
      const jsonStr = JSON.stringify(dataToExport, null, 2);
      
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      showToast(`💾 Downloaded ${filename} successfully!`);
    } catch (e) {
      console.error("Download failed: ", e);
      showToast("❌ Download failed. Check console.");
    }
  };

  const handleSaveToDisk = () => {
    const dataToSave = calibratedSongData || songData;
    if (!dataToSave) return;

    // Build full tapCalibration block so we can analyse it later
    const reactionDelayMs = estimatedDelay ? Math.round(estimatedDelay * 1000) : null;
    const correctedTaps = rawTaps.map(t =>
      parseFloat(Math.max(0, t - (estimatedDelay || 0)).toFixed(3))
    );

    // Match each corrected tap to the nearest beat-1 in the ORIGINAL beatmap
    const baseSong = originalSongData || songData;
    const beat1Times = baseSong
      ? baseSong.beats.filter(b => b.beat === 1).map(b => b.timestamp)
      : [];

    const matchedAnchors = correctedTaps.map(ct => {
      let best = null;
      let bestDiff = Infinity;
      for (const bt of beat1Times) {
        const diff = Math.abs(ct - bt);
        if (diff < bestDiff) { bestDiff = diff; best = bt; }
      }
      return { correctedTapTime: ct, matchedBeat1: best, diffMs: Math.round(bestDiff * 1000) };
    });

    const payload = {
      ...dataToSave,
      tapCalibration: {
        recordedAt: new Date().toISOString(),
        tapCount: rawTaps.length,
        rawTaps: rawTaps.map(t => parseFloat(t.toFixed(3))),
        reactionDelayMs,
        correctedTaps,
        matchedAnchors
      }
    };

    showToast("💾 Saving permanently to disk...");

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
          setOriginalSongData(JSON.parse(JSON.stringify(dataToSave)));
          showToast(`✅ Saved! ${rawTaps.length} taps recorded. Delay: ${reactionDelayMs ?? '?'}ms`);
        } else {
          throw new Error(result.error);
        }
      })
      .catch(err => {
        console.error("Save to disk failed:", err);
        showToast("❌ Save to disk failed. Check console.");
      });
  };

  const handleHeaderClick = () => {
    headerClicksRef.current += 1;
    if (headerClicksRef.current >= 5) {
      setShowDiagnostic(prev => !prev);
      headerClicksRef.current = 0;
      showToast(showDiagnostic ? "🔒 Dev Panel Locked!" : "🛠️ Developer Panel Toggled!");
    }
  };

  // Check URL parameters for ?dev=true to auto-unlock dev features
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("dev") === "true") {
      setShowDiagnostic(true);
      showToast("🛠️ Developer Mode Unlocked via URL!");
    }
  }, []);

  // Backup taps to LocalStorage to protect the creator's job!
  useEffect(() => {
    if (rawTaps.length > 0) {
      localStorage.setItem("armada_raw_taps", JSON.stringify(rawTaps));
    }
  }, [rawTaps]);

  // Restore taps from LocalStorage on initial load
  useEffect(() => {
    const backup = localStorage.getItem("armada_raw_taps");
    if (backup) {
      try {
        const parsed = JSON.parse(backup);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRawTaps(parsed);
          // Wait briefly for songData to load, then normalize to recreate anchors/calibrationStats!
          setTimeout(() => {
            handleNormalizeBeatmap();
            showToast(`⚡ Restored ${parsed.length} taps from local backup!`);
          }, 600);
        }
      } catch (e) {
        console.warn("Restore backup failed:", e);
      }
    }
  }, [originalSongData]);

  // Auto-Normalization Debounce: Automatically runs the normalization engine in the background
  // whenever the user pauses the playback, the song ends, or stops tapping for 2 seconds.
  useEffect(() => {
    if (rawTaps.length === 0) return;

    // 1. If paused, run normalization instantly
    if (!isActuallyPlaying) {
      handleNormalizeBeatmap();
      return;
    }

    // 2. If playing, run normalization after 2 seconds of no new taps (idle-debounce)
    const timer = setTimeout(() => {
      handleNormalizeBeatmap();
    }, 2000);

    return () => clearTimeout(timer);
  }, [rawTaps, isActuallyPlaying]);

  return (
    <div className="app-container" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 1. Header Section */}
      <header className="header glass-panel" onClick={handleHeaderClick} style={{ cursor: "pointer" }} title="Click 5 times for Developer Panel">
        <h1 className="song-title">
          {songData ? songData.metadata.songTitle : "Salsa Rhythm Hub"}
        </h1>
        <p className="song-artist">
          {songData ? `${songData.metadata.artist} — ${songData.metadata.danceStyle.toUpperCase()} On1` : "Ear-Training Visualizer"}
        </p>
      </header>

      {/* 2. Dynamic Source Selector (Developer Only) */}
      {showDiagnostic && (
        <div className="source-switcher">
          <button
            className={`source-btn ${useLocalAudio ? "active" : ""}`}
            onClick={() => toggleSourceMode("local")}
          >
            <Music size={16} />
            <span>Local MP3 (Auto-Fallback)</span>
          </button>
          <button
            className={`source-btn ${!useLocalAudio ? "active" : ""}`}
            onClick={() => toggleSourceMode("youtube")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ minWidth: "16px" }}><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17z"/><path d="m10 15 5-3-5-3v6z" fill="currentColor"/></svg>
            <span>YouTube Player</span>
          </button>
        </div>
      )}


      {/* 5. Media Player Display */}
      {useLocalAudio ? (
        /* Local Audio Fallback Card */
        <div className="audio-card" onClick={handlePlayToggle} style={{ cursor: "pointer" }}>
          <audio
            ref={localAudioRef}
            src="/songs/66HCBysrJS8.mp3"
            style={{ display: "none" }}
            onPlay={() => setLocalPlaying(true)}
            onPause={() => setLocalPlaying(false)}
            onEnded={() => setLocalPlaying(false)}
          />
          <div className={`vinyl-record ${isActuallyPlaying ? "spinning" : ""}`}>
            <div className="vinyl-center"></div>
          </div>
          <div style={{ marginTop: "16px", fontSize: "0.85rem", fontWeight: "600", color: "#a1a1aa" }}>
            {isActuallyPlaying ? "💿 Spinning Pobre Diablo locally..." : "💿 Local MP3 Mode Ready"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "4px" }}>
            No YouTube API connection required
          </div>
        </div>
      ) : (
        /* YouTube Embed IFrame */
        <div className="video-wrapper">
          <div id="yt-player"></div>
          <div className="touch-shield" onClick={handlePlayToggle}></div>
        </div>
      )}

      {/* 6. Section Banner */}
      <div 
        className={`section-banner ${getContainerClass()}`} 
        style={getSectionColorStyles()}
      >
        {activeSection && activeSection.emoji ? (
          <>
            <span className="banner-emoji">{activeSection.emoji}</span>
            <span>
              {activeSection.name} {activeSection.focus ? `(Focus: ${activeSection.focus.toUpperCase()})` : ""}
            </span>
          </>
        ) : (
          <span>
            {isActuallyPlaying ? "🎶 Listen to the Salsa swing..." : "⏸️ Press Play to start ear-training"}
          </span>
        )}
      </div>

      {/* 7. Beats Pulse Tracker (8 neon counts) */}
      <div className="glass-panel" style={{ padding: "20px 10px" }}>
        <div className="beats-container">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((beatNum) => {
            const canLight = beatNum === 1 || beatNum === 3 || beatNum === 5;
            const isActive = canLight && currentBeat && currentBeat.beat === beatNum;
            const isGold = beatNum === 1 || beatNum === 5;
            return (
              <div key={beatNum} className={`beat-circle${isActive ? (isGold ? " accent-gold" : " accent-cyan") : ""}`}>
                <span>{beatNum}</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#6b7280", padding: "0 8px" }}>
          <span>Elapsed Time: {currentTime.toFixed(3)}s</span>
          <span>Tempo: {songData ? songData.metadata.bpm : 0} BPM</span>
        </div>
      </div>

      {/* 7.5. Public Tapping Deck (Clean & Sleek for Tappers) */}
      <div className="glass-panel" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
        <button
          className="btn-diagnose-tap"
          onClick={handleTapOnOne}
          style={{ width: "100%", height: "80px", borderRadius: "16px", border: "3px solid #8b5cf6" }}
        >
          <span style={{ fontSize: "1.2rem", fontWeight: "800" }}>TAP ON "1"</span>
          <span style={{ fontSize: "0.65rem", opacity: 0.8, fontWeight: "400" }}>Tap every time you hear count 1</span>
        </button>

        {rawTaps.length > 0 && (
          <button
            className="btn-diagnose-action primary"
            onClick={handleSaveToDisk}
            style={{
              width: "100%",
              minHeight: "44px",
              background: anchors.length > 0 ? "linear-gradient(135deg, #10b981, #059669)" : "rgba(255,255,255,0.05)",
              boxShadow: anchors.length > 0 ? "0 4px 12px rgba(16, 185, 129, 0.25)" : "none",
              border: anchors.length > 0 ? "none" : "1px solid rgba(255, 255, 255, 0.1)",
              color: anchors.length > 0 ? "#fff" : "#9ca3af",
              fontWeight: "800",
              textTransform: "uppercase",
              borderRadius: "12px",
              letterSpacing: "0.5px"
            }}
            title={anchors.length > 0 ? "Save the normalized beatmap permanently to disk" : "Taps are automatically compiled in the background"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {anchors.length > 0 ? "Save Calibration to Disk" : "Taps Recorded (Auto-Normalizing...)"}
          </button>
        )}
      </div>

      {/* 8. Custom bottom touch controls (Simplified Play/Pause Only) */}
      <div className="glass-panel" style={{ marginTop: "auto", padding: "16px" }}>
        <div className="controls-panel">
          <button className="btn-touch btn-play" onClick={handlePlayToggle} style={{ width: "100%", flex: "none" }}>
            {isActuallyPlaying ? (
              <>
                <Pause size={20} fill="#fff" />
                <span>Pause Song</span>
              </>
            ) : (
              <>
                <Play size={20} fill="#fff" />
                <span>Play Song</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 9. Floating Toast Notification */}
      {toastMessage && (
        <div className="toast-notification">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
