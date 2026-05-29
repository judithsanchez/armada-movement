import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useSyncEngine } from "./hooks/useSyncEngine";
import { ArrowLeft } from "lucide-react";
import { isDevMode } from "./config/env";

// Subcomponents
import SongSelector from "./components/SongSelector";
import ControlBar from "./components/ControlBar";
import AudioShield from "./components/AudioShield";
import Visualizer from "./components/Visualizer";
import GameCanvas from "./components/GameCanvas";
import RoadmapScrubber from "./components/RoadmapScrubber";
import CalibrationTapDeck from "./components/CalibrationTapDeck";
import DevCalibrationPanel from "./components/DevCalibrationPanel";

const DevCalibrator = lazy(() => {
  if (isDevMode) {
    return import("./components/DevCalibrator");
  } else {
    return Promise.resolve({ default: () => null });
  }
});

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

    let sNew;
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

const populateEditorSections = (sections, duration) => {
  if (!sections || sections.length === 0) return [];
  const sorted = [...sections].sort((a, b) => a.startTimestamp - b.startTimestamp);
  return sorted.map((sec, idx) => {
    const start = sec.startTimestamp;
    const end = (idx < sorted.length - 1) ? sorted[idx + 1].startTimestamp : duration;
    return {
      id: sec.id || `section-${idx}-${Date.now()}`,
      name: sec.name,
      startTimestamp: start,
      endTimestamp: end,
      focus: sec.focus || "",
      emoji: sec.emoji || "🎵"
    };
  });
};

const _convertToDatabaseSections = (editorSecs) => {
  return editorSecs.map(sec => ({
    name: sec.name,
    startTimestamp: parseFloat(parseFloat(sec.startTimestamp).toFixed(3)),
    focus: sec.focus || "",
    emoji: sec.emoji || "🎵"
  })).sort((a, b) => a.startTimestamp - b.startTimestamp);
};

export default function App() {
  const [songData, setSongData] = useState(null);
  const [editorSections, setEditorSections] = useState([]);
  const [activeEditingSectionId, setActiveEditingSectionId] = useState(null);
  
  // High-level Learning Mode vs Practice Mode state
  const [mode, setMode] = useState("learn"); // 'learn' or 'practice'

  // Media states
  const [player, setPlayer] = useState(null);
  const [playerState, setPlayerState] = useState(-1); 
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [apiReady, setApiReady] = useState(false);

  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [originalSongData, setOriginalSongData] = useState(null);
  const [calibratedSongData, setCalibratedSongData] = useState(null);
  const [calibrationStats, setCalibrationStats] = useState(null);
  const [anchors, setAnchors] = useState([]);
  const [rawTaps, setRawTaps] = useState([]);       // raw clock times when user pressed button
  const [estimatedDelay, setEstimatedDelay] = useState(null); // ms — auto-computed reaction delay
  const [userDelaySetting, setUserDelaySetting] = useState(220); // ms — user-adjustable reaction delay
  const [toastMessage, setToastMessage] = useState(null);

  // Song Selection States
  const [currentSong, setCurrentSong] = useState(null);
  const [loadingSong, setLoadingSong] = useState(false);
  const [introStart, setIntroStart] = useState(0.0);
  const [introEnd, setIntroEnd] = useState(0.0);
  const [videoDuration, setVideoDuration] = useState(300.0);
  const [breaks, setBreaks] = useState([]);
  const [tempBreakStart, setTempBreakStart] = useState("");
  const [tempBreakEnd, setTempBreakEnd] = useState("");

  const playerRef = useRef(null);
  const lastSeekTimeRef = useRef(0);
  const seekThrottleTimeoutRef = useRef(null);
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

  // Sync showDiagnostic to root container width
  useEffect(() => {
    const rootEl = document.getElementById("root");
    if (rootEl) {
      if (showDiagnostic) {
        rootEl.classList.add("dev-mode-active");
      } else {
        rootEl.classList.remove("dev-mode-active");
      }
    }
  }, [showDiagnostic]);

  const handleSelectSong = (song) => {
    setLoadingSong(true);
    
    // Clear all existing song-related state
    setSongData(null);
    setOriginalSongData(null);
    setCalibratedSongData(null);
    setAnchors([]);
    setRawTaps([]);
    setEstimatedDelay(null);
    setCalibrationStats(null);
    setBreaks([]);
    setEditorSections([]);
    setActiveEditingSectionId(null);
    setMode("learn"); // Reset to Learn Mode

    fetch(`songs/${song.youtubeId}.json`)
      .then((res) => {
        if (!res.ok) throw new Error("Beatmap load failed");
        return res.json();
      })
      .then((data) => {
        setSongData(data);
        setOriginalSongData(JSON.parse(JSON.stringify(data)));
        setCalibratedSongData(JSON.parse(JSON.stringify(data)));
        setIntroStart(data.metadata?.introStart || 0.0);
        setIntroEnd(data.metadata?.introEnd || 0.0);
        setBreaks(data.breaks || []);
        
        // Populate editor sections from LocalStorage or song JSON
        const youtubeId = song.youtubeId;
        const duration = data.metadata?.duration || 300.0;
        const backupSections = localStorage.getItem(`armada_sections_${youtubeId}`);
        if (backupSections) {
          try {
            const parsed = JSON.parse(backupSections);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setEditorSections(parsed);
              console.log("[App] Restored sections from LocalStorage backup.");
            } else {
              setEditorSections(populateEditorSections(data.sections, duration));
            }
          } catch {
            setEditorSections(populateEditorSections(data.sections, duration));
          }
        } else {
          setEditorSections(populateEditorSections(data.sections, duration));
        }

        setCurrentSong(song);
        setLoadingSong(false);

        // Restore backup taps if dev mode is active
        if (showDiagnostic) {
          const backup = localStorage.getItem(`armada_raw_taps_${youtubeId}`);
          if (backup) {
            try {
              const parsed = JSON.parse(backup);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setRawTaps(parsed);
                setTimeout(() => {
                  handleNormalizeBeatmapRef.current(true); // SILENT!
                }, 400);
              }
            } catch (e) {
              console.warn("Restore backup failed:", e);
            }
          }
        }

        console.log("[App] Loaded advanced beatmap successfully for:", data.metadata.songTitle);
      })
      .catch((err) => {
        console.error("[App] Failed to load song beatmap:", err);
        setLoadingSong(false);
        showToast("❌ Failed to load song beatmap.");
      });
  };

  const handleBackToCatalog = () => {
    // Stop the video player if playing
    if (player && typeof player.pauseVideo === "function") {
      try {
        player.pauseVideo();
      } catch (e) {
        console.warn("Pause error on back navigation:", e);
      }
    }
    
    setCurrentSong(null);
    setSongData(null);
    setOriginalSongData(null);
    setCalibratedSongData(null);
    setAnchors([]);
    setRawTaps([]);
    setEstimatedDelay(null);
    setCalibrationStats(null);
    setIntroStart(0.0);
    setIntroEnd(0.0);
    setBreaks([]);
    setEditorSections([]);
    setActiveEditingSectionId(null);
    setVideoDuration(300.0);
  };

  const throttledSeek = (timeSec, isFinal = false) => {
    if (!player || typeof player.seekTo !== "function") return;

    const numericVal = parseFloat(parseFloat(timeSec).toFixed(2));

    if (isFinal) {
      if (seekThrottleTimeoutRef.current) {
        clearTimeout(seekThrottleTimeoutRef.current);
        seekThrottleTimeoutRef.current = null;
      }
      try {
        player.seekTo(numericVal, true);
        console.log(`[YouTube Seek] Final seek to ${numericVal}s`);
      } catch (e) {
        console.warn("Final seek error:", e);
      }
      return;
    }

    const now = Date.now();
    if (now - lastSeekTimeRef.current > 150) {
      lastSeekTimeRef.current = now;
      try {
        // seek with allowSeekAhead = false to avoid slamming YouTube servers during active dragging
        player.seekTo(numericVal, false);
      } catch (e) {
        console.warn("Throttled seek error:", e);
      }
    } else {
      if (seekThrottleTimeoutRef.current) {
        clearTimeout(seekThrottleTimeoutRef.current);
      }
      seekThrottleTimeoutRef.current = setTimeout(() => {
        try {
          player.seekTo(numericVal, true);
        } catch (e) {
          console.warn("Debounced seek error:", e);
        }
      }, 150);
    }
  };

  const handleIntroStartChange = (val, isFinal = false) => {
    const numericVal = parseFloat(Math.max(0, Math.min(videoDuration, parseFloat(val))).toFixed(2));
    setIntroStart(numericVal);
    
    // Sync to active song metadata so that saving handles it
    if (songData && songData.metadata) {
      setSongData(prev => prev ? {
        ...prev,
        metadata: { ...prev.metadata, introStart: numericVal }
      } : null);
    }
    if (calibratedSongData && calibratedSongData.metadata) {
      setCalibratedSongData(prev => prev ? {
        ...prev,
        metadata: { ...prev.metadata, introStart: numericVal }
      } : null);
    }

    throttledSeek(numericVal, isFinal);
  };

  const handleIntroEndChange = (val, isFinal = false) => {
    const numericVal = parseFloat(Math.max(0, Math.min(videoDuration, parseFloat(val))).toFixed(2));
    setIntroEnd(numericVal);
    
    // Sync to active song metadata so that saving handles it
    if (songData && songData.metadata) {
      setSongData(prev => prev ? {
        ...prev,
        metadata: { ...prev.metadata, introEnd: numericVal }
      } : null);
    }
    if (calibratedSongData && calibratedSongData.metadata) {
      setCalibratedSongData(prev => prev ? {
        ...prev,
        metadata: { ...prev.metadata, introEnd: numericVal }
      } : null);
    }

    throttledSeek(numericVal, isFinal);
  };

  const handleMarkIntroStart = () => {
    if (!player) return;
    const currentPlayhead = parseFloat(player.getCurrentTime().toFixed(2));
    handleIntroStartChange(currentPlayhead, true);
    showToast(`🎯 Intro Start set to ${currentPlayhead}s!`);
  };

  const handleMarkIntroEnd = () => {
    if (!player) return;
    const currentPlayhead = parseFloat(player.getCurrentTime().toFixed(2));
    handleIntroEndChange(currentPlayhead, true);
    showToast(`🎯 Intro End set to ${currentPlayhead}s!`);
  };

  // Load the YouTube Player API script dynamically in background
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      setTimeout(() => setApiReady(true), 0);
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

  // Construct YouTube Player when API is ready
  useEffect(() => {
    if (!apiReady || !songData) return;

    // If an existing player exists, destroy it first
    if (playerRef.current) {
      try {
        if (typeof playerRef.current.destroy === "function") {
          playerRef.current.destroy();
        }
      } catch (e) {
        console.warn("[App] Error destroying old player in effect:", e);
      }
      playerRef.current = null;
      setPlayer(null);
    }

    console.log("[App] Constructing YouTube Player for:", songData.metadata.youtubeId);
    try {
      const ytPlayer = new window.YT.Player("yt-player", {
        videoId: songData.metadata.youtubeId,
        playerVars: {
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          enablejsapi: 1
        },
        events: {
          onReady: (event) => {
            setPlayer(event.target);
            playerRef.current = event.target;
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
      if (playerRef.current) {
        try {
          if (typeof playerRef.current.destroy === "function") {
            playerRef.current.destroy();
          }
        } catch (e) {
          console.warn("[App] Cleanup destroy error:", e);
        }
        playerRef.current = null;
        setPlayer(null);
      }
    };
  }, [apiReady, songData]);

  // Dynamic Duration Sync: query player's duration once ready
  useEffect(() => {
    if (player && typeof player.getDuration === "function") {
      try {
        const duration = player.getDuration();
        if (duration > 0) {
          setTimeout(() => {
            setVideoDuration(duration);
            console.log(`[App] Synced YouTube Video Duration: ${duration}s`);

            setEditorSections(prev => {
              if (prev.length === 0) return prev;
              return prev.map((sec, idx) => {
                if (idx === prev.length - 1) {
                  return { ...sec, endTimestamp: duration };
                }
                return sec;
              });
            });
          }, 0);
        }
      } catch (e) {
        console.warn("Error getting player duration:", e);
      }
    }
  }, [player, currentSong, playerState]);

  // Hook into the high-precision sync engine
  const { currentTime, currentBeat, activeSection, synchronizeAnchors } = useSyncEngine(
    player,
    calibratedSongData || songData,
    null,
    false,
    0, // zero AV latency offset
    0  // zero static grid count shift
  );

  // Touch Controller click handlers
  const handlePlayToggle = () => {
    try {
      if (!player) return;
      if (playerState === 1) {
        player.pauseVideo();
      } else {
        player.playVideo();
      }
      setTimeout(synchronizeAnchors, 50);
    } catch (err) {
      console.warn("PlayToggle error: ", err);
    }
  };

  const handleRewind = () => {
    try {
      if (!player) return;
      const current = player.getCurrentTime();
      let target = current - 10;
      if (target < 0) target = 0;
      player.seekTo(target, true);
      console.log(`[YouTube] Rewinding to: ${target.toFixed(2)}s`);
      setTimeout(synchronizeAnchors, 100);
    } catch (err) {
      console.warn("Rewind error: ", err);
    }
  };

  const handleSpeedChange = (rate) => {
    setPlaybackRate(rate);
    try {
      if (player) {
        player.setPlaybackRate(rate);
      }
      setTimeout(synchronizeAnchors, 50);
    } catch (err) {
      console.warn("SpeedChange error: ", err);
    }
  };

  // getContainerClass deleted (defined in Visualizer.jsx)

  const isActuallyPlaying = playerState === 1;

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

    // Record the raw tap timestamp FIRST
    const newRawTaps = [...rawTaps, tapTime];
    setRawTaps(newRawTaps);

    // Auto-update reaction delay estimate (live, after each tap)
    const delay = computeReactionDelay(newRawTaps, baseSong.beats);
    setEstimatedDelay(delay);

    showToast(`🎯 Tap #${newRawTaps.length} recorded!`);
  };

  const handleNormalizeBeatmap = (silent = false) => {
    const baseSong = originalSongData || songData;
    if (!baseSong) return;

    if (rawTaps.length === 0) {
      if (!silent) showToast("⚠️ Record at least 1 tap to run normalization!");
      return;
    }

    const delay = userDelaySetting / 1000; // in seconds

    // Compute global shift based on the first tap to align the baseline phase
    const firstTapCorrected = rawTaps[0] - delay;
    const originalBeat1Times = baseSong.beats
      .map((b, idx) => ({ ...b, originalIndex: idx }))
      .filter(b => b.beat === 1);

    if (originalBeat1Times.length === 0) return;

    let bestBeat1ForFirst = originalBeat1Times[0];
    let minDiffFirst = Infinity;
    for (const b1 of originalBeat1Times) {
      const diff = Math.abs(firstTapCorrected - b1.timestamp);
      if (diff < minDiffFirst) {
        minDiffFirst = diff;
        bestBeat1ForFirst = b1;
      }
    }
    const globalShift = firstTapCorrected - bestBeat1ForFirst.timestamp;

    // Apply global phase shift to all baseline beats to bring the grid in-phase with taps
    const shiftedBaseBeats = baseSong.beats.map(b => ({
      ...b,
      timestamp: parseFloat(Math.max(0, b.timestamp + globalShift).toFixed(3))
    }));
    const shiftedBaseSections = baseSong.sections.map(sec => ({
      ...sec,
      startTimestamp: parseFloat(Math.max(0, sec.startTimestamp + globalShift).toFixed(3))
    }));

    // If only 1 tap, we are done with global shift alignment
    if (rawTaps.length === 1) {
      setAnchors([{
        beatIndex: bestBeat1ForFirst.originalIndex,
        originalTime: bestBeat1ForFirst.timestamp,
        tappedTime: firstTapCorrected
      }]);

      setCalibratedSongData({
        ...baseSong,
        beats: shiftedBaseBeats,
        sections: shiftedBaseSections
      });

      setCalibrationStats({
        totalTaps: 1,
        matchedTaps: 1,
        outliersCount: 0,
        estimatedDelayMs: userDelaySetting,
        medianDiffMs: Math.round(globalShift * 1000)
      });

      if (!silent) showToast(`✅ Global grid shifted by ${Math.round(globalShift * 1000)}ms!`);
      return;
    }

    // Multi-Tap Mode: Piecewise-Linear Warping on the pre-aligned shifted grid
    const correctedTaps = rawTaps.map(t => t - delay);

    // Match each corrected tap to the nearest beat-1 in the pre-aligned grid
    const alignedBeat1Times = shiftedBaseBeats
      .map((b, idx) => ({ ...b, originalIndex: idx }))
      .filter(b => b.beat === 1);

    const matchedPairs = [];
    correctedTaps.forEach(ct => {
      let bestBeat1 = null;
      let minDiff = Infinity;

      for (const b1 of alignedBeat1Times) {
        const diff = Math.abs(ct - b1.timestamp);
        if (diff < minDiff) {
          minDiff = diff;
          bestBeat1 = b1;
        }
      }

      if (bestBeat1 && minDiff < 0.400) {
        matchedPairs.push({
          correctedTime: ct,
          originalTime: bestBeat1.timestamp,
          beatIndex: bestBeat1.originalIndex,
          diff: ct - bestBeat1.timestamp
        });
      }
    });

    if (matchedPairs.length === 0) {
      if (!silent) showToast("⚠️ No taps could be matched to downbeats. Try tapping more precisely.");
      return;
    }

    // Outlier Rejection based on median timing difference
    const diffs = matchedPairs.map(p => p.diff);
    const sortedDiffs = [...diffs].sort((a, b) => a - b);
    const medianDiff = sortedDiffs[Math.floor(sortedDiffs.length / 2)];

    // Filter out taps deviating by more than 150ms from median
    const cleanPairs = matchedPairs.filter(p => Math.abs(p.diff - medianDiff) <= 0.150);
    const outlierCount = matchedPairs.length - cleanPairs.length;

    if (cleanPairs.length === 0) {
      if (!silent) showToast("⚠️ All taps were classified as outliers. Please try again.");
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

    // Apply Dense Smooth Warp if > 20 anchors
    if (cleanAnchors.length > 20) {
      finalAnchors = cleanAnchors.map((anchor, idx) => {
        const radius = 2;
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

    // Apply Piecewise-Linear Warping on the pre-aligned grid!
    const warpedBeats = applyWarpToBeats(shiftedBaseBeats, finalAnchors);
    const warpedSections = applyWarpToSections(shiftedBaseSections, shiftedBaseBeats, warpedBeats);

    setCalibratedSongData({
      ...baseSong,
      sections: warpedSections,
      beats: warpedBeats
    });

    setCalibrationStats({
      totalTaps: rawTaps.length,
      matchedTaps: cleanPairs.length,
      outliersCount: outlierCount,
      estimatedDelayMs: userDelaySetting,
      medianDiffMs: Math.round((medianDiff + globalShift) * 1000)
    });

    if (!silent) {
      showToast(`✅ Normalized! ${cleanPairs.length}/${rawTaps.length} taps matched. Outliers: ${outlierCount}`);
    } else {
      console.log(`[Normalization] ${cleanPairs.length}/${rawTaps.length} taps matched. Outliers: ${outlierCount}`);
    }
  };

  const handleResetCalibration = () => {
    if (originalSongData) {
      setCalibratedSongData(JSON.parse(JSON.stringify(originalSongData)));
    }
    setAnchors([]);
    setRawTaps([]);
    setEstimatedDelay(null);
    setCalibrationStats(null);
    if (songData?.metadata?.youtubeId) {
      localStorage.removeItem(`armada_raw_taps_${songData.metadata.youtubeId}`);
    }
    showToast("🔄 Reset all anchors and taps. Restored original raw grid.");
  };

  const handleClearTaps = () => {
    setRawTaps([]);
    setAnchors([]);
    setCalibrationStats(null);
    setEstimatedDelay(null);
    if (songData?.metadata?.youtubeId) {
      localStorage.removeItem(`armada_raw_taps_${songData.metadata.youtubeId}`);
    }
    showToast("🔄 Taps cleared & visual shield lifted!");
  };

  // Skip audio to ~30s so user can bypass the difficult intro
  const handleSkipIntro = () => {
    try {
      if (player) {
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
    const activeBeatmap = calibratedSongData || songData;
    const baseSong = originalSongData || songData;
    if (!activeBeatmap || !baseSong) return;

    if (rawTaps.length < 50) {
      showToast("⚠️ At least 50 taps are required to save!");
      return;
    }

    const reactionDelayMs = userDelaySetting;
    const delaySec = userDelaySetting / 1000;
    const correctedTaps = rawTaps.map(t =>
      parseFloat(Math.max(0, t - delaySec).toFixed(3))
    );

    const beat1Times = baseSong.beats.filter(b => b.beat === 1).map(b => b.timestamp);

    const matchedAnchors = correctedTaps.map(ct => {
      let best = null;
      let bestDiff = Infinity;
      for (const bt of beat1Times) {
        const diff = Math.abs(ct - bt);
        if (diff < bestDiff) { bestDiff = diff; best = bt; }
      }
      return { correctedTapTime: ct, matchedBeat1: best, diffMs: Math.round(bestDiff * 1000) };
    });

    const calibration = {
      recordedAt: new Date().toISOString(),
      tapCount: rawTaps.length,
      rawTaps: rawTaps.map(t => parseFloat(t.toFixed(3))),
      reactionDelayMs,
      correctedTaps,
      matchedAnchors
    };

    const payload = {
      youtubeId: baseSong.metadata?.youtubeId || 'calibrated_song',
      activeBeatmap: {
        ...activeBeatmap,
        tapCalibration: calibration,
        breaks: breaks
      },
      originalBeatmap: {
        ...baseSong,
        breaks: breaks
      },
      calibration: calibration
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
          setOriginalSongData(JSON.parse(JSON.stringify(activeBeatmap)));
          // Clear active taps in-memory and in localStorage to unlock visual count pulsing!
          setRawTaps([]);
          setAnchors([]);
          setCalibrationStats(null);
          setEstimatedDelay(null);
          if (payload.youtubeId) {
            localStorage.removeItem(`armada_raw_taps_${payload.youtubeId}`);
          }
          showToast(`✅ Saved & cleared taps for Audition Mode!`);
        } else {
          throw new Error(result.error);
        }
      })
      .catch(err => {
        console.error("Save to disk failed:", err);
        showToast("❌ Save to disk failed. Check console.");
      });
  };

  const handleSaveMetadataAndBreaks = () => {
    const activeBeatmap = calibratedSongData || songData;
    const baseSong = originalSongData || songData;
    if (!activeBeatmap || !baseSong) return;

    // Keep existing calibration if any
    const calibration = activeBeatmap.tapCalibration || baseSong.tapCalibration || null;

    const payload = {
      youtubeId: baseSong.metadata?.youtubeId || 'calibrated_song',
      activeBeatmap: {
        ...activeBeatmap,
        metadata: {
          ...activeBeatmap.metadata,
          introStart,
          introEnd
        },
        breaks: breaks
      },
      originalBeatmap: {
        ...baseSong,
        metadata: {
          ...baseSong.metadata,
          introStart,
          introEnd
        },
        breaks: breaks
      },
      calibration: calibration
    };

    showToast("💾 Saving song boundaries & breaks to disk...");

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
          const updatedMap = JSON.parse(JSON.stringify(payload.activeBeatmap));
          setOriginalSongData(updatedMap);
          setSongData(updatedMap);
          setCalibratedSongData(updatedMap);
          showToast(`✅ Saved boundaries & breaks successfully!`);
        } else {
          throw new Error(result.error);
        }
      })
      .catch(err => {
        console.error("Save boundaries & breaks failed:", err);
        showToast("❌ Save failed. Check console.");
      });
  };

  // Backup sections to LocalStorage
  useEffect(() => {
    if (editorSections.length > 0 && songData?.metadata?.youtubeId) {
      localStorage.setItem(`armada_sections_${songData.metadata.youtubeId}`, JSON.stringify(editorSections));
    }
  }, [editorSections, songData]);

  const handleUpdateSectionTimes = (id, field, value) => {
    const numericVal = parseFloat(parseFloat(value).toFixed(2));
    
    setEditorSections(prev => {
      const list = prev.map(sec => ({ ...sec }));
      const idx = list.findIndex(sec => sec.id === id);
      if (idx === -1) return prev;
      
      if (field === "startTimestamp") {
        list[idx].startTimestamp = numericVal;
        if (idx > 0) {
          list[idx - 1].endTimestamp = numericVal;
        }
      } else if (field === "endTimestamp") {
        list[idx].endTimestamp = numericVal;
        if (idx < list.length - 1) {
          list[idx + 1].startTimestamp = numericVal;
        }
      }
      return list;
    });

    throttledSeek(numericVal, false);
  };

  const handleUpdateSectionName = (id, name) => {
    setEditorSections(prev => {
      return prev.map(sec => {
        if (sec.id === id) {
          return { ...sec, name };
        }
        return sec;
      });
    });
  };

  const handleAddNewSection = () => {
    if (!player) return;
    const currentPlayhead = parseFloat(player.getCurrentTime().toFixed(2));
    
    const newSec = {
      id: `section-${Date.now()}`,
      name: "New Section",
      startTimestamp: currentPlayhead,
      endTimestamp: parseFloat((currentPlayhead + 10).toFixed(2)),
      focus: "",
      emoji: "🎵"
    };
    
    const updated = [...editorSections, newSec].sort((a, b) => a.startTimestamp - b.startTimestamp);
    const duration = videoDuration;
    const contiguous = updated.map((sec, idx) => {
      const start = sec.startTimestamp;
      const end = (idx < updated.length - 1) ? updated[idx + 1].startTimestamp : duration;
      return {
        ...sec,
        startTimestamp: start,
        endTimestamp: end
      };
    });
    
    setEditorSections(contiguous);
    setActiveEditingSectionId(newSec.id);
    showToast("➕ Added new section! Drag sliders to adjust.");
  };

  const handleSaveSectionsToDiskDirect = (secsList) => {
    const activeBeatmap = calibratedSongData || songData;
    const baseSong = originalSongData || songData;
    if (!activeBeatmap || !baseSong) return;

    const dbSections = secsList.map(sec => ({
      name: sec.name,
      startTimestamp: parseFloat(parseFloat(sec.startTimestamp).toFixed(3)),
      focus: sec.focus || "",
      emoji: sec.emoji || "🎵"
    })).sort((a, b) => a.startTimestamp - b.startTimestamp);

    const payload = {
      youtubeId: baseSong.metadata?.youtubeId || 'calibrated_song',
      activeBeatmap: {
        ...activeBeatmap,
        sections: dbSections,
        breaks: breaks
      },
      originalBeatmap: {
        ...baseSong,
        sections: dbSections,
        breaks: breaks
      },
      calibration: activeBeatmap.tapCalibration || baseSong.tapCalibration || null
    };

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
          const updatedMap = JSON.parse(JSON.stringify(payload.activeBeatmap));
          setSongData(updatedMap);
          setCalibratedSongData(updatedMap);
          setOriginalSongData(updatedMap);
        } else {
          throw new Error(result.error);
        }
      })
      .catch(err => {
        console.error("Save section directly failed:", err);
      });
  };

  const handleDeleteSection = (id) => {
    const updated = editorSections.filter(sec => sec.id !== id);
    setEditorSections(updated);
    
    // Save to LocalStorage immediately
    if (songData?.metadata?.youtubeId) {
      localStorage.setItem(`armada_sections_${songData.metadata.youtubeId}`, JSON.stringify(updated));
    }
    
    // Sync to disk
    handleSaveSectionsToDiskDirect(updated);
    showToast("🗑️ Section deleted & saved to disk!");
  };

  const handleSaveSectionsToDisk = () => {
    handleSaveSectionsToDiskDirect(editorSections);
    showToast("💾 Saved all sections to disk successfully!");
  };

  const handleMarkBreakStart = () => {
    if (!player) return;
    const currentPlayhead = parseFloat(player.getCurrentTime().toFixed(2));
    setTempBreakStart(currentPlayhead.toFixed(2));
    showToast(`🎯 Break Start marked: ${currentPlayhead}s!`);
  };

  const handleMarkBreakEnd = () => {
    if (!player) return;
    const currentPlayhead = parseFloat(player.getCurrentTime().toFixed(2));
    setTempBreakEnd(currentPlayhead.toFixed(2));
    showToast(`🎯 Break End marked: ${currentPlayhead}s!`);
  };

  const handleAddNewBreak = () => {
    const start = parseFloat(tempBreakStart);
    const end = parseFloat(tempBreakEnd);
    if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
      showToast("⚠️ Invalid break times! Start must be < End.");
      return;
    }
    const newBreak = {
      id: `break-${Date.now()}`,
      startTimestamp: parseFloat(start.toFixed(2)),
      endTimestamp: parseFloat(end.toFixed(2)),
      label: "Cierre / Stop",
      action: "freeze"
    };
    const updatedBreaks = [...breaks, newBreak].sort((a, b) => a.startTimestamp - b.startTimestamp);
    setBreaks(updatedBreaks);
    setTempBreakStart("");
    setTempBreakEnd("");
    showToast("➕ Added new Cierre break!");
  };

  const handleDeleteBreak = (id) => {
    const updated = breaks.filter(b => b.id !== id);
    setBreaks(updated);
    showToast("❌ Removed break.");
  };
  const handleExitDev = () => {
    setShowDiagnostic(false);
    setRawTaps([]);
    setAnchors([]);
    setCalibrationStats(null);
    setEstimatedDelay(null);
    showToast("🔒 Dev Panel Locked!");
  };

  const handleHeaderClick = () => {
    if (!isDevMode) {
      return;
    }

    headerClicksRef.current += 1;
    if (headerClicksRef.current >= 5) {
      headerClicksRef.current = 0;
      const nextVal = !showDiagnostic;
      setShowDiagnostic(nextVal);
      showToast(nextVal ? "🛠️ Developer Panel Toggled!" : "🔒 Dev Panel Locked!");

      if (!nextVal) {
        setRawTaps([]);
        setAnchors([]);
        setCalibrationStats(null);
        setEstimatedDelay(null);
      } else {
        // Restore from LocalStorage
        if (songData?.metadata?.youtubeId) {
          const youtubeId = songData.metadata.youtubeId;
          const backup = localStorage.getItem(`armada_raw_taps_${youtubeId}`);
          if (backup) {
            try {
              const parsed = JSON.parse(backup);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setRawTaps(parsed);
                setTimeout(() => {
                  handleNormalizeBeatmapRef.current(true); // SILENT!
                  showToast(`⚡ Restored ${parsed.length} taps from local backup!`);
                }, 600);
              }
            } catch (e) {
              console.warn("Restore backup failed:", e);
            }
          }
        }
      }
    }
  };

  // Toast notification if unlocked via URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (isDevMode && params.get("dev") === "true") {
      setTimeout(() => {
        setShowDiagnostic(true);
        showToast("🛠️ Developer Mode Unlocked via URL!");
      }, 0);
    }
  }, []);

  // Backup taps to LocalStorage
  useEffect(() => {
    if (rawTaps.length > 0 && songData?.metadata?.youtubeId) {
      localStorage.setItem(`armada_raw_taps_${songData.metadata.youtubeId}`, JSON.stringify(rawTaps));
    }
  }, [rawTaps, songData]);

  const handleNormalizeBeatmapRef = useRef(handleNormalizeBeatmap);
  useEffect(() => {
    handleNormalizeBeatmapRef.current = handleNormalizeBeatmap;
  });

  // Auto-Normalization Debounce
  useEffect(() => {
    if (rawTaps.length === 0) return;

    if (!isActuallyPlaying) {
      const timer = setTimeout(() => {
        handleNormalizeBeatmapRef.current(true);
      }, 0);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      handleNormalizeBeatmapRef.current(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, [rawTaps, isActuallyPlaying]);

  if (loadingSong) {
    return (
      <div className="app-container" style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "center" }}>
        <header className="header glass-panel">
          <h1 className="song-title">Salsa Rhythm Hub</h1>
          <p className="song-artist">Syncing Beat Grid...</p>
        </header>
        <div className="glass-panel loading-container">
          <div className="loading-spinner"></div>
          <div style={{ fontWeight: 600, color: "#a78bfa" }}>Loading Beatmap...</div>
        </div>
      </div>
    );
  }

  // Render Catalog Selector View
  if (!currentSong) {
    return (
      <div className="app-container" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <SongSelector onSelectSong={handleSelectSong} />
        {toastMessage && (
          <div className="toast-notification">
            {toastMessage}
          </div>
        )}
      </div>
    );
  }

  // Active Break and Transitions Indicators
  const activeBreak = breaks.find(b => currentTime >= b.startTimestamp && currentTime < b.endTimestamp) || null;
  const sectionsList = songData?.sections || [];
  const nextSection = sectionsList.find(sec => sec.startTimestamp > currentTime) || null;
  const timeToNextSection = nextSection ? nextSection.startTimestamp - currentTime : null;

  return (
    <div className="app-container" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      
      {/* Upper Navigation & Mode Selector Tabs */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", gap: "12px", width: "100%" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button className="back-button" onClick={handleBackToCatalog} style={{ margin: 0 }}>
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
          {currentTime < introEnd && (
            <button 
              className="btn-step" 
              onClick={handleSkipIntro}
              style={{ 
                margin: 0, 
                padding: "6px 12px",
                fontSize: "0.75rem",
                background: "linear-gradient(135deg, #a78bfa, #8b5cf6)", 
                color: "#fff", 
                fontWeight: "700",
                boxShadow: "0 4px 12px rgba(139, 92, 246, 0.2)",
                animation: "pulse 2s infinite"
              }}
            >
              ⏩ Skip Intro
            </button>
          )}
        </div>

        {/* Learning vs Practice Tabs */}
        <div className="mode-tabs-container" style={{ margin: 0, flexGrow: 1, maxWidth: "300px" }}>
          <button 
            className={`mode-tab-btn ${mode === "learn" ? "active" : ""}`}
            onClick={() => setMode("learn")}
          >
            🎓 Learn
          </button>
          <button 
            className={`mode-tab-btn ${mode === "practice" ? "active" : ""}`}
            onClick={() => setMode("practice")}
          >
            🎯 Play
          </button>
        </div>
      </div>

      {/* Header Section */}
      <header 
        className="header glass-panel" 
        onClick={handleHeaderClick} 
        style={{ cursor: "pointer" }} 
        title="Click 5 times for Developer Panel"
      >
        <h1 className="song-title">
          {songData ? songData.metadata.songTitle : "Salsa Rhythm Hub"}
        </h1>
        <p className="song-artist">
          {songData ? `${songData.metadata.artist} — ${songData.metadata.danceStyle.toUpperCase()}` : "Ear-Training Visualizer"}
        </p>
      </header>

      {/* Main workspace layout */}
      <div className={showDiagnostic ? "dev-workspace-layout" : "normal-workspace-layout"}>
        {showDiagnostic ? (
          <>
            {/* Left Workspace Column: Video player ONLY */}
            <div className="left-workspace-column">
              {/* Defensive IFrame Player & Overlay Protection */}
              <div className="video-wrapper">
                <div key={songData?.metadata?.youtubeId || "yt-player"} id="yt-player"></div>
                <AudioShield onPlayToggle={handlePlayToggle} />
              </div>
            </div>

            {/* Right Column: Secure DevCalibrator */}
            <Suspense fallback={
              <div className="glass-panel loading-container" style={{ minHeight: "300px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div className="loading-spinner"></div>
                <div style={{ fontWeight: 600, color: "#a78bfa" }}>Loading Calibration Workbench...</div>
              </div>
            }>
              <DevCalibrator
                songData={songData}
                originalSongData={originalSongData}
                calibratedSongData={calibratedSongData}
                setCalibratedSongData={setCalibratedSongData}
                setSongData={setSongData}
                setOriginalSongData={setOriginalSongData}
                breaks={breaks}
                setBreaks={setBreaks}
                currentTime={currentTime}
                videoDuration={videoDuration}
                player={player}
                throttledSeek={throttledSeek}
                userDelaySetting={userDelaySetting}
                setUserDelaySetting={setUserDelaySetting}
                onBackToCatalog={() => {
                  setShowDiagnostic(false);
                  setRawTaps([]);
                  setAnchors([]);
                  setCalibrationStats(null);
                  setEstimatedDelay(null);
                  showToast("🔒 Dev Panel Locked!");
                }}
                showToast={showToast}
              />
            </Suspense>
          </>
        ) : (
          <div className="left-workspace-column">
              
            {/* Defensive IFrame Player & Overlay Protection */}
            <div className="video-wrapper">
              <div key={songData?.metadata?.youtubeId || "yt-player"} id="yt-player"></div>
              <AudioShield onPlayToggle={handlePlayToggle} />
            </div>

            {/* Dynamic Interface: Learn Mode beats pulses OR Practice Mode gamified tapping zone */}
            {mode === "practice" ? (
              <GameCanvas 
                key={calibratedSongData?.metadata?.youtubeId || songData?.metadata?.youtubeId}
                songData={calibratedSongData || songData}
                currentTime={currentTime}
                isPlaying={isActuallyPlaying}
                onPlayToggle={handlePlayToggle}
              />
            ) : (
              <Visualizer 
                danceStyle={songData?.metadata?.danceStyle || "salsa"}
                currentTime={currentTime}
                introEnd={introEnd}
                currentBeat={currentBeat}
                activeSection={activeSection}
                activeBreak={activeBreak}
              />
            )}

            {/* Segmented Roadmap Progress Scrubber */}
            <RoadmapScrubber
              currentTime={currentTime}
              videoDuration={videoDuration}
              introStart={introStart}
              introEnd={introEnd}
              nextSection={nextSection}
              timeToNextSection={timeToNextSection}
              showDiagnostic={showDiagnostic}
              editorSections={editorSections}
              sectionsList={sectionsList}
              breaks={breaks}
              onSeek={throttledSeek}
            />

            {/* Unified Touch Controlbar */}
            <ControlBar 
              isActuallyPlaying={isActuallyPlaying}
              onPlayToggle={handlePlayToggle}
              playbackRate={playbackRate}
              onSpeedChange={handleSpeedChange}
              onRewind={handleRewind}
            />
          </div>
        )}
      </div>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="toast-notification">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
