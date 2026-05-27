import React, { useState, useEffect, useRef } from "react";
import { useSyncEngine } from "./hooks/useSyncEngine";
import { Play, Pause, RotateCcw, Music, ArrowLeft } from "lucide-react";

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

const convertToDatabaseSections = (editorSecs) => {
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
  
  // Media states
  const [player, setPlayer] = useState(null);
  const [playerState, setPlayerState] = useState(-1); 
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

  // Song Selection States
  const [catalog, setCatalog] = useState([]);
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

  // 1. Fetch song catalog on startup
  useEffect(() => {
    fetch("songs/catalog.json")
      .then((res) => {
        if (!res.ok) throw new Error("Catalog fetch failed");
        return res.json();
      })
      .then((data) => {
        setCatalog(data);
        console.log("[App] Catalog loaded successfully:", data);
      })
      .catch((err) => {
        console.error("[App] Failed to load catalog JSON:", err);
      });
  }, []);

  // 1.5 Sync showDiagnostic to root container width
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
          } catch (e) {
            setEditorSections(populateEditorSections(data.sections, duration));
          }
        } else {
          setEditorSections(populateEditorSections(data.sections, duration));
        }

        setCurrentSong(song);
        setLoadingSong(false);
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
      songData.metadata.introStart = numericVal;
    }
    if (calibratedSongData && calibratedSongData.metadata) {
      calibratedSongData.metadata.introStart = numericVal;
    }

    throttledSeek(numericVal, isFinal);
  };

  const handleIntroEndChange = (val, isFinal = false) => {
    const numericVal = parseFloat(Math.max(0, Math.min(videoDuration, parseFloat(val))).toFixed(2));
    setIntroEnd(numericVal);
    
    // Sync to active song metadata so that saving handles it
    if (songData && songData.metadata) {
      songData.metadata.introEnd = numericVal;
    }
    if (calibratedSongData && calibratedSongData.metadata) {
      calibratedSongData.metadata.introEnd = numericVal;
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
          showinfo: 0,
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
        }
      } catch (e) {
        console.warn("Error getting player duration:", e);
      }
    }
  }, [player, currentSong, playerState]);

  // 4. Hook into the high-precision sync engine
  const { currentTime, currentBeat, activeSection, synchronizeAnchors } = useSyncEngine(
    player,
    calibratedSongData || songData,
    null,
    false,
    0, // zero AV latency offset
    0  // zero static grid count shift
  );

  // 5. Touch Controller click handlers
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

    // 1. Record the raw tap timestamp FIRST — this is the ground truth
    const newRawTaps = [...rawTaps, tapTime];
    setRawTaps(newRawTaps);

    // 2. Auto-update reaction delay estimate (live, after each tap)
    const delay = computeReactionDelay(newRawTaps, baseSong.beats);
    setEstimatedDelay(delay);

    const delayMs = delay ? Math.round(delay * 1000) : '?';
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

    // 1. Compute global shift based on the first tap to align the baseline phase
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

    // 2. Multi-Tap Mode: Piecewise-Linear Warping on the pre-aligned shifted grid
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

      if (bestBeat1 && minDiff < 0.400) { // now perfectly in-phase, so easily matches within 400ms!
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
  };  const handleResetCalibration = () => {
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
          // Update baseline and current states in-memory to reflect saved parameters
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

    // Seek the player so the user gets instant visual playhead feedback
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

  const handleAdjustBreak = (id, field, amount) => {
    const updated = breaks.map(b => {
      if (b.id === id) {
        const newVal = parseFloat(Math.max(0, b[field] + amount).toFixed(2));
        return { ...b, [field]: newVal };
      }
      return b;
    });
    setBreaks(updated);
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
    if (rawTaps.length > 0 && songData?.metadata?.youtubeId) {
      localStorage.setItem(`armada_raw_taps_${songData.metadata.youtubeId}`, JSON.stringify(rawTaps));
    }
  }, [rawTaps, songData]);

  // Restore taps from LocalStorage on initial load / Dev Mode toggle
  useEffect(() => {
    if (!songData?.metadata?.youtubeId) return;
    
    const youtubeId = songData.metadata.youtubeId;

    if (!showDiagnostic) {
      // Clear tap state in memory immediately when leaving Dev Mode
      setRawTaps([]);
      setAnchors([]);
      setCalibrationStats(null);
      setEstimatedDelay(null);
      return;
    }
    
    // We are in Dev Mode, restore from LocalStorage if there are backup taps
    const backup = localStorage.getItem(`armada_raw_taps_${youtubeId}`);
    if (backup) {
      try {
        const parsed = JSON.parse(backup);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRawTaps(parsed);
          // Wait briefly for songData to load, then normalize to recreate anchors/calibrationStats!
          setTimeout(() => {
            handleNormalizeBeatmap(true); // SILENT!
            showToast(`⚡ Restored ${parsed.length} taps from local backup!`);
          }, 600);
        }
      } catch (e) {
        console.warn("Restore backup failed:", e);
      }
    } else {
      // If no backup, clear memory anyway just in case
      setRawTaps([]);
      setAnchors([]);
      setCalibrationStats(null);
      setEstimatedDelay(null);
    }
  }, [originalSongData, showDiagnostic]);

  // Auto-Normalization Debounce: Automatically runs the normalization engine in the background
  // whenever the user pauses the playback, the song ends, or stops tapping for 2 seconds.
  useEffect(() => {
    if (rawTaps.length === 0) return;

    // 1. If paused, run normalization instantly
    if (!isActuallyPlaying) {
      handleNormalizeBeatmap(true); // SILENT!
      return;
    }

    // 2. If playing, run normalization after 2 seconds of no new taps (idle-debounce)
    const timer = setTimeout(() => {
      handleNormalizeBeatmap(true); // SILENT!
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

  if (!currentSong) {
    return (
      <div className="app-container" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div className="catalog-title-wrapper">
          <h1 className="catalog-title">Salsa Rhythm Hub</h1>
          <p className="catalog-subtitle">
            Master the Latin count structure and calibrate micro-timings with absolute auditory precision.
          </p>
        </div>

        <div className="catalog-grid">
          {catalog.map((song) => (
            <div
              key={song.id}
              className="song-card"
              onClick={() => handleSelectSong(song)}
            >
              <div className="song-card-icon-container">
                <Music size={24} />
              </div>
              <div className="song-card-details">
                <h3 className="song-card-title">{song.songTitle}</h3>
                <p className="song-card-artist">{song.artist}</p>
                <div className="song-card-meta">
                  <span className="badge badge-bpm">{song.bpm} BPM</span>
                  <span className={`badge badge-${song.difficulty}`}>{song.difficulty}</span>
                  <span className="badge badge-style">{song.danceStyle} On1</span>
                </div>
              </div>
            </div>
          ))}
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

  // 1. Dynamic Active Break Check
  const activeBreak = breaks.find(b => currentTime >= b.startTimestamp && currentTime < b.endTimestamp) || null;

  // 2. Upcoming Transition Countdown
  const sectionsList = songData?.sections || [];
  const nextSection = sectionsList.find(sec => sec.startTimestamp > currentTime) || null;
  const timeToNextSection = nextSection ? nextSection.startTimestamp - currentTime : null;
  const showTransitionCue = timeToNextSection !== null && timeToNextSection > 0 && timeToNextSection <= 3.0;

  return (
    <div className="app-container" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Back button link */}
      <button className="back-button" onClick={handleBackToCatalog}>
        <ArrowLeft size={16} />
        <span>Back to Catalog</span>
      </button>

      {/* 1. Header Section */}
      <header className="header glass-panel" onClick={handleHeaderClick} style={{ cursor: "pointer" }} title="Click 5 times for Developer Panel">
        <h1 className="song-title">
          {songData ? songData.metadata.songTitle : "Salsa Rhythm Hub"}
        </h1>
        <p className="song-artist">
          {songData ? `${songData.metadata.artist} — ${songData.metadata.danceStyle.toUpperCase()} On1` : "Ear-Training Visualizer"}
        </p>
      </header>

      {/* Main workspace layout wrapper */}
      <div className={showDiagnostic ? "dev-workspace-layout" : "normal-workspace-layout"}>

        {/* Left Column: Player, visualizer tracker, scrubber, public tapping deck */}
        <div className="left-workspace-column">
          {/* 5. Media Player Display */}
          <div className="video-wrapper">
            <div key={songData?.metadata?.youtubeId || "yt-player"} id="yt-player"></div>
            <div className="touch-shield" onClick={handlePlayToggle}></div>
          </div>

          {/* 7. Beats Pulse Tracker (8 neon counts / Bias Shield) */}
          <div className="glass-panel" style={{ padding: "20px 10px" }}>
            {activeBreak ? (
              <div className="break-freeze-overlay">
                <div className="break-freeze-title">
                  <span>❄️ HOLD POSE / BREAK</span>
                </div>
                <div className="break-freeze-countdown">
                  Groove resumes in {Math.max(0, activeBreak.endTimestamp - currentTime).toFixed(1)}s
                </div>
              </div>
            ) : showDiagnostic ? (
              <div className="bias-shield-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "12px 6px" }}>
                <div className="bias-shield-icon" style={{ fontSize: "1.8rem", animation: "pulse 2s infinite" }}>🔒</div>
                <div className="bias-shield-title" style={{ fontSize: "0.95rem", fontWeight: "800", color: "#f3f4f6", letterSpacing: "0.5px" }}>Visual Counts Shielded</div>
                <div className="bias-shield-text" style={{ fontSize: "0.75rem", color: "#9ca3af", textAlign: "center", maxWidth: "280px" }}>
                  Visual counts hidden to guarantee absolute auditory rhythm mapping.
                </div>
                <div className="bias-shield-counter" style={{ fontSize: "0.8rem", fontWeight: "800", color: rawTaps.length >= 50 ? "#10b981" : "#a78bfa", marginTop: "4px", background: "rgba(255,255,255,0.03)", padding: "4px 12px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.06)" }}>
                  {rawTaps.length >= 50 ? `✅ Ready: ${rawTaps.length} Taps` : `⚡ Progress: ${rawTaps.length} / 50 Taps`}
                </div>
              </div>
            ) : (
              <div className="beats-container">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((beatNum) => {
                  const isBachata = songData?.metadata?.danceStyle === "bachata";
                  let canLight, isGold;
                  if (isBachata) {
                    canLight = true;
                    isGold = beatNum === 4 || beatNum === 8;
                  } else {
                    canLight = beatNum === 1 || beatNum === 3 || beatNum === 5;
                    isGold = beatNum === 1 || beatNum === 5;
                  }
                  const isActive = canLight && currentTime >= introEnd && currentBeat && currentBeat.beat === beatNum;
                  const isPause = !isBachata && (beatNum === 4 || beatNum === 8);
                  return (
                    <div
                      key={beatNum}
                      className={`beat-circle ${isPause ? "beat-pause" : ""}${isActive ? (isGold ? " accent-gold" : " accent-cyan") : ""}`}
                    >
                      <span>{beatNum}</span>
                      {isBachata && (beatNum === 4 || beatNum === 8) && (
                        <span className="beat-label" style={{ fontSize: "0.55rem", opacity: 0.8, color: "hsl(var(--accent-gold))" }}>TAP</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 7.3. Segmented Roadmap Progress Scrubber */}
          <div className="glass-panel" style={{ padding: "14px 16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", fontWeight: "600", color: "#9ca3af", marginBottom: "8px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>Song Roadmap</span>
              <span style={{ color: "#a78bfa" }}>
                {Math.floor(currentTime / 60)}:{(Math.floor(currentTime % 60)).toString().padStart(2, "0")} / {Math.floor(videoDuration / 60)}:{(Math.floor(videoDuration % 60)).toString().padStart(2, "0")}
              </span>
            </div>
            
            <div className="roadmap-scrubber-wrapper">
              <div 
                className="roadmap-scrubber-track"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickPercent = (e.clientX - rect.left) / rect.width;
                  const targetTime = clickPercent * videoDuration;
                  throttledSeek(targetTime, true);
                }}
              >
                {/* 1. Dynamic Intro Highlight Segment */}
                <div 
                  className="roadmap-segment segment-intro"
                  style={{
                    left: `${(introStart / videoDuration) * 100}%`,
                    width: `${((introEnd - introStart) / videoDuration) * 100}%`
                  }}
                  title="Song Intro Region"
                ></div>

                {/* 2. Dynamic Section markers */}
                {(showDiagnostic ? editorSections : sectionsList).map((sec, idx) => (
                  <div
                    key={idx}
                    className="roadmap-section-marker"
                    style={{ left: `${(sec.startTimestamp / videoDuration) * 100}%` }}
                    title={`${sec.name} Start`}
                  ></div>
                ))}

                {/* 3. Dynamic Breaks highlight segments */}
                {breaks.map((b) => (
                  <div
                    key={b.id}
                    className="roadmap-segment segment-break"
                    style={{
                      left: `${(b.startTimestamp / videoDuration) * 100}%`,
                      width: `${((b.endTimestamp - b.startTimestamp) / videoDuration) * 100}%`
                    }}
                    title={`Cierre Stop: ${b.startTimestamp}s - ${b.endTimestamp}s`}
                  ></div>
                ))}

                {/* 4. Glowing Playhead Handle */}
                <div 
                  className="roadmap-playhead"
                  style={{ left: `${(currentTime / videoDuration) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* 8. Custom bottom touch controls (Simplified Play/Pause Only) */}
          <div className="glass-panel" style={{ padding: "16px" }}>
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

          {/* 7.5. Public Tapping Deck (Clean & Sleek for Tappers) */}
          {showDiagnostic && (
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
                <div style={{ display: "flex", width: "100%", gap: "10px", marginTop: "4px" }}>
                  <button
                    className={`btn-diagnose-action ${rawTaps.length >= 50 ? "active-ready" : "locked-pending"}`}
                    onClick={handleSaveToDisk}
                    disabled={rawTaps.length < 50}
                    style={{
                      flexGrow: 1,
                      minHeight: "48px",
                      background: rawTaps.length >= 50 
                        ? "linear-gradient(135deg, #10b981, #059669)" 
                        : "rgba(255,255,255,0.03)",
                      boxShadow: rawTaps.length >= 50 
                        ? "0 4px 16px rgba(16, 185, 129, 0.25)" 
                        : "none",
                      border: rawTaps.length >= 50 
                        ? "none" 
                        : "1px solid rgba(255, 255, 255, 0.05)",
                      color: rawTaps.length >= 50 ? "#fff" : "#6b7280",
                      fontWeight: "800",
                      textTransform: "uppercase",
                      borderRadius: "12px",
                      letterSpacing: "0.5px",
                      cursor: rawTaps.length >= 50 ? "pointer" : "not-allowed",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                    }}
                    title={rawTaps.length >= 50 ? "Save the normalized beatmap permanently to disk" : `Record at least 50 taps to unlock. Current: ${rawTaps.length}/50`}
                  >
                    {rawTaps.length >= 50 ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "pulse 2s infinite" }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                        <span>Save Calibration</span>
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        <span>Locked: {rawTaps.length}/50</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setRawTaps([]);
                      setAnchors([]);
                      setCalibrationStats(null);
                      setEstimatedDelay(null);
                      if (songData?.metadata?.youtubeId) {
                        localStorage.removeItem(`armada_raw_taps_${songData.metadata.youtubeId}`);
                      }
                      showToast("🔄 Taps cleared & visual shield lifted!");
                    }}
                    style={{
                      width: "48px",
                      height: "48px",
                      background: "rgba(239, 68, 68, 0.1)",
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      borderRadius: "12px",
                      color: "#f87171",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.2s ease"
                    }}
                    title="Clear all recorded taps and lift the visual count shield"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {/* Right Column: Developer Calibration Panel */}
        {showDiagnostic && (
          <div className="glass-panel dev-panel right-workspace-column">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "8px" }}>
              <span style={{ fontSize: "0.9rem", fontWeight: "800", color: "#c084fc", textTransform: "uppercase", letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: "6px" }}>
                🛠️ Creator Calibration Desk
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "0.7rem", color: "#6b7280", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: "6px" }}>DEV MODE</span>
                <button 
                  onClick={() => {
                    setShowDiagnostic(false);
                    showToast("🔒 Dev Panel Locked!");
                  }}
                  style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", color: "#f87171", padding: "2px 8px", borderRadius: "6px", fontSize: "0.7rem", fontWeight: "700", cursor: "pointer", transition: "all 0.2s ease" }}
                  title="Lock and hide the Developer Calibration Desk"
                >
                  Exit
                </button>
              </div>
            </div>

            {/* Song Sections Editor — Intro pinned at top, then all song sections */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: "800", color: "#38bdf8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  🏷️ Song Sections Editor
                </span>
                <button 
                  className="btn-step" 
                  onClick={handleAddNewSection} 
                  style={{ padding: "4px 10px", fontSize: "0.7rem", fontWeight: "700", background: "rgba(56, 189, 248, 0.15)", border: "1px solid rgba(56, 189, 248, 0.3)", color: "#38bdf8" }}
                >
                  ➕ Add Section
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "rgba(255,255,255,0.02)", padding: "8px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.04)" }}>

                {/* ── Pinned Intro section ── */}
                {(() => {
                  const introId = "__intro__";
                  const isEditingIntro = activeEditingSectionId === introId;
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px", borderRadius: "8px", border: `1px solid ${isEditingIntro ? "rgba(56, 189, 248, 0.4)" : "rgba(255,255,255,0.06)"}`, background: isEditingIntro ? "rgba(56, 189, 248, 0.04)" : "rgba(255,255,255,0.02)" }}>
                      {/* Header */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ flexGrow: 1, fontSize: "0.8rem", fontWeight: "700", color: "#e5e7eb" }}>🎬 Intro Region</span>
                        <button
                          onClick={() => setActiveEditingSectionId(isEditingIntro ? null : introId)}
                          style={{ background: isEditingIntro ? "rgba(56, 189, 248, 0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${isEditingIntro ? "rgba(56, 189, 248, 0.4)" : "rgba(255,255,255,0.1)"}`, color: isEditingIntro ? "#38bdf8" : "#6b7280", padding: "2px 8px", borderRadius: "6px", fontSize: "0.7rem", fontWeight: "700", cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          {isEditingIntro ? "✏️ On" : "✏️ Off"}
                        </button>
                        <button
                          onClick={handleSaveMetadataAndBreaks}
                          style={{ background: "none", border: "none", fontSize: "0.95rem", cursor: "pointer", opacity: 0.7, transition: "opacity 0.15s ease" }}
                          onMouseEnter={e => e.target.style.opacity = 1}
                          onMouseLeave={e => e.target.style.opacity = 0.7}
                          title="Save intro boundaries to disk"
                        >💾</button>
                      </div>

                      {isEditingIntro ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
                          {/* Intro Start */}
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", fontWeight: "600", color: "#9ca3af" }}>
                              <span>Start</span><span style={{ color: "#38bdf8" }}>{introStart.toFixed(2)}s</span>
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                              <input type="range" min="0" max={videoDuration} step="0.1" value={introStart}
                                onChange={(e) => handleIntroStartChange(e.target.value, false)}
                                onMouseUp={(e) => handleIntroStartChange(e.target.value, true)}
                                onTouchEnd={(e) => handleIntroStartChange(e.target.value, true)}
                                style={{ flexGrow: 1, accentColor: "#38bdf8" }}
                              />
                              <button className="btn-dev-sync" onClick={handleMarkIntroStart} title="Mark current playhead as intro start">🎯 Mark</button>
                            </div>
                            <div style={{ display: "flex", gap: "4px" }}>
                              <button className="btn-step" onClick={() => handleIntroStartChange(introStart - 0.5, true)}>-0.5s</button>
                              <button className="btn-step" onClick={() => handleIntroStartChange(introStart - 0.1, true)}>-0.1s</button>
                              <button className="btn-step" onClick={() => handleIntroStartChange(introStart + 0.1, true)}>+0.1s</button>
                              <button className="btn-step" onClick={() => handleIntroStartChange(introStart + 0.5, true)}>+0.5s</button>
                            </div>
                          </div>
                          {/* Intro End */}
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", fontWeight: "600", color: "#9ca3af" }}>
                              <span>End</span><span style={{ color: "#f43f5e" }}>{introEnd.toFixed(2)}s</span>
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                              <input type="range" min="0" max={videoDuration} step="0.1" value={introEnd}
                                onChange={(e) => handleIntroEndChange(e.target.value, false)}
                                onMouseUp={(e) => handleIntroEndChange(e.target.value, true)}
                                onTouchEnd={(e) => handleIntroEndChange(e.target.value, true)}
                                style={{ flexGrow: 1, accentColor: "#f43f5e" }}
                              />
                              <button className="btn-dev-sync" onClick={handleMarkIntroEnd} title="Mark current playhead as intro end">🎯 Mark</button>
                            </div>
                            <div style={{ display: "flex", gap: "4px" }}>
                              <button className="btn-step" onClick={() => handleIntroEndChange(introEnd - 0.5, true)}>-0.5s</button>
                              <button className="btn-step" onClick={() => handleIntroEndChange(introEnd - 0.1, true)}>-0.1s</button>
                              <button className="btn-step" onClick={() => handleIntroEndChange(introEnd + 0.1, true)}>+0.1s</button>
                              <button className="btn-step" onClick={() => handleIntroEndChange(introEnd + 0.5, true)}>+0.5s</button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: "16px", fontSize: "0.65rem", color: "#9ca3af", fontStyle: "italic", padding: "2px 4px" }}>
                          <span>Start: <strong style={{ color: "#e5e7eb" }}>{introStart.toFixed(2)}s</strong></span>
                          <span>End: <strong style={{ color: "#e5e7eb" }}>{introEnd.toFixed(2)}s</strong></span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── Song sections ── */}
                {editorSections.map((sec) => {
                  const isEditing = activeEditingSectionId === sec.id;
                  return (
                    <div key={sec.id} style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px", borderRadius: "8px", border: `1px solid ${isEditing ? "rgba(56, 189, 248, 0.4)" : "rgba(255,255,255,0.04)"}`, background: isEditing ? "rgba(56, 189, 248, 0.04)" : "rgba(0,0,0,0.15)" }}>
                      
                      {/* Header row */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <input 
                          type="text" 
                          value={sec.name} 
                          onChange={(e) => handleUpdateSectionName(sec.id, e.target.value)}
                          placeholder="Section Name (e.g. Verse, Chorus)"
                          style={{ flexGrow: 1, padding: "4px 8px", fontSize: "0.75rem", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.2)", color: "#fff", fontWeight: "600" }}
                        />
                        <button
                          onClick={() => setActiveEditingSectionId(isEditing ? null : sec.id)}
                          style={{ background: isEditing ? "rgba(56, 189, 248, 0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${isEditing ? "rgba(56, 189, 248, 0.4)" : "rgba(255,255,255,0.1)"}`, color: isEditing ? "#38bdf8" : "#6b7280", padding: "2px 8px", borderRadius: "6px", fontSize: "0.7rem", fontWeight: "700", cursor: "pointer", whiteSpace: "nowrap" }}
                          title={isEditing ? "Disable editing" : "Enable editing"}
                        >
                          {isEditing ? "✏️ On" : "✏️ Off"}
                        </button>
                        <button onClick={handleSaveSectionsToDisk}
                          style={{ background: "none", border: "none", fontSize: "0.95rem", cursor: "pointer", opacity: 0.7, transition: "opacity 0.15s ease" }}
                          onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}
                          title="Save sections to disk">💾</button>
                        <button onClick={() => handleDeleteSection(sec.id)}
                          style={{ background: "none", border: "none", fontSize: "0.95rem", cursor: "pointer", opacity: 0.7, transition: "opacity 0.15s ease" }}
                          onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}
                          title="Delete section">🗑️</button>
                      </div>

                      {/* Sliders when enabled */}
                      {isEditing ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
                          {/* Start */}
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", fontWeight: "600", color: "#9ca3af" }}>
                              <span>Start</span><span style={{ color: "#38bdf8" }}>{sec.startTimestamp.toFixed(2)}s</span>
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                              <input type="range" min="0" max={videoDuration} step="0.05" value={sec.startTimestamp}
                                onChange={(e) => handleUpdateSectionTimes(sec.id, "startTimestamp", e.target.value)}
                                onMouseUp={(e) => throttledSeek(parseFloat(e.target.value), true)}
                                onTouchEnd={(e) => throttledSeek(parseFloat(e.target.value), true)}
                                style={{ flexGrow: 1, height: "6px", cursor: "pointer", accentColor: "#38bdf8" }}
                              />
                              <button className="btn-dev-sync" onClick={() => { if (!player) return; const t = parseFloat(player.getCurrentTime().toFixed(2)); handleUpdateSectionTimes(sec.id, "startTimestamp", t); }} title="Mark current playhead as start">🎯 Mark</button>
                            </div>
                            <div style={{ display: "flex", gap: "4px" }}>
                              <button className="btn-step" onClick={() => handleUpdateSectionTimes(sec.id, "startTimestamp", sec.startTimestamp - 0.5)}>-0.5s</button>
                              <button className="btn-step" onClick={() => handleUpdateSectionTimes(sec.id, "startTimestamp", sec.startTimestamp - 0.1)}>-0.1s</button>
                              <button className="btn-step" onClick={() => handleUpdateSectionTimes(sec.id, "startTimestamp", sec.startTimestamp + 0.1)}>+0.1s</button>
                              <button className="btn-step" onClick={() => handleUpdateSectionTimes(sec.id, "startTimestamp", sec.startTimestamp + 0.5)}>+0.5s</button>
                            </div>
                          </div>
                          {/* End */}
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", fontWeight: "600", color: "#9ca3af" }}>
                              <span>End</span><span style={{ color: "#f43f5e" }}>{sec.endTimestamp.toFixed(2)}s</span>
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                              <input type="range" min="0" max={videoDuration} step="0.05" value={sec.endTimestamp}
                                onChange={(e) => handleUpdateSectionTimes(sec.id, "endTimestamp", e.target.value)}
                                onMouseUp={(e) => throttledSeek(parseFloat(e.target.value), true)}
                                onTouchEnd={(e) => throttledSeek(parseFloat(e.target.value), true)}
                                style={{ flexGrow: 1, height: "6px", cursor: "pointer", accentColor: "#f43f5e" }}
                              />
                              <button className="btn-dev-sync" onClick={() => { if (!player) return; const t = parseFloat(player.getCurrentTime().toFixed(2)); handleUpdateSectionTimes(sec.id, "endTimestamp", t); }} title="Mark current playhead as end">🎯 Mark</button>
                            </div>
                            <div style={{ display: "flex", gap: "4px" }}>
                              <button className="btn-step" onClick={() => handleUpdateSectionTimes(sec.id, "endTimestamp", sec.endTimestamp - 0.5)}>-0.5s</button>
                              <button className="btn-step" onClick={() => handleUpdateSectionTimes(sec.id, "endTimestamp", sec.endTimestamp - 0.1)}>-0.1s</button>
                              <button className="btn-step" onClick={() => handleUpdateSectionTimes(sec.id, "endTimestamp", sec.endTimestamp + 0.1)}>+0.1s</button>
                              <button className="btn-step" onClick={() => handleUpdateSectionTimes(sec.id, "endTimestamp", sec.endTimestamp + 0.5)}>+0.5s</button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: "16px", fontSize: "0.65rem", color: "#9ca3af", fontStyle: "italic", padding: "2px 4px" }}>
                          <span>Start: <strong style={{ color: "#e5e7eb" }}>{sec.startTimestamp.toFixed(2)}s</strong></span>
                          <span>End: <strong style={{ color: "#e5e7eb" }}>{sec.endTimestamp.toFixed(2)}s</strong></span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {editorSections.length === 0 && (
                  <span style={{ fontSize: "0.65rem", color: "#6b7280", fontStyle: "italic", textAlign: "center" }}>No sections yet. Click ➕ Add Section!</span>
                )}
              </div>
            </div>

            {/* Save Song Boundaries Button */}
            <button 
              className="btn-diagnose-action" 
              onClick={handleSaveMetadataAndBreaks}
              style={{
                width: "100%",
                minHeight: "42px",
                background: "linear-gradient(135deg, #a78bfa, #8b5cf6)",
                boxShadow: "0 4px 14px rgba(139, 92, 246, 0.3)",
                border: "none",
                color: "#fff",
                fontWeight: "800",
                textTransform: "uppercase",
                borderRadius: "12px",
                fontSize: "0.8rem",
                letterSpacing: "0.5px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginTop: "8px",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
              }}
              title="Save the song intro boundaries to disk"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              <span>Save Song Boundaries</span>
            </button>
          </div>
        )}
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
