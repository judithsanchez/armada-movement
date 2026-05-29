import { useState, useEffect, useRef, useCallback, RefObject } from "react";
import { Beat, Section, BeatmapSchema } from "../types/beatmap";

interface SyncEngineResult {
  currentTime: number;
  currentBeat: Beat | null;
  activeSection: Section | null;
  synchronizeAnchors: () => void;
}

export function useSyncEngine(
  player: any,
  songData: BeatmapSchema | null,
  localAudioRef: RefObject<HTMLAudioElement | null>,
  useLocalAudio: boolean,
  latencyOffset: number = 0,
  gridShift: number = 0
): SyncEngineResult {
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [currentBeat, setCurrentBeat] = useState<Beat | null>(null);
  const [activeSection, setActiveSection] = useState<Section | null>(null);

  // Refs for real-time tracking (avoids stale closures)
  const playerRef = useRef<any>(player);
  const songDataRef = useRef<BeatmapSchema | null>(songData);
  const frameIdRef = useRef<number | null>(null);

  // Sync anchors for YouTube dead reckoning
  const anchorYtTimeRef = useRef<number>(0);
  const anchorPerfTimeRef = useRef<number>(0);
  const playbackRateRef = useRef<number>(1);
  const isPlayingRef = useRef<boolean>(false);
  const lastDriftCheckRef = useRef<number>(0);

  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => {
    songDataRef.current = songData;
  }, [songData]);

  // Synchronize state trigger: resets anchors when play state changes for YT
  const synchronizeAnchors = useCallback(() => {
    if (useLocalAudio) {
      const audio = localAudioRef.current;
      if (audio) {
        setCurrentTime(audio.currentTime);
      }
      return;
    }

    const ytPlayer = playerRef.current;
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== "function") return;

    anchorYtTimeRef.current = ytPlayer.getCurrentTime();
    anchorPerfTimeRef.current = performance.now();
    playbackRateRef.current = ytPlayer.getPlaybackRate ? ytPlayer.getPlaybackRate() : 1;
    isPlayingRef.current = ytPlayer.getPlayerState ? ytPlayer.getPlayerState() === 1 : false; 
    lastDriftCheckRef.current = performance.now();
  }, [useLocalAudio, localAudioRef]);

  // 1. Mobile background sleep control (Page Visibility API)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log("[SyncEngine] Tab hidden: Pausing playback to prevent desync.");
        try {
          if (useLocalAudio && localAudioRef.current) {
            localAudioRef.current.pause();
          } else if (playerRef.current && typeof playerRef.current.pauseVideo === "function") {
            playerRef.current.pauseVideo();
          }
        } catch {
          // ignore player pause error
        }
        isPlayingRef.current = false;
      } else {
        console.log("[SyncEngine] Tab returned to view: Triggering complete resync.");
        setTimeout(synchronizeAnchors, 150);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [useLocalAudio, localAudioRef, synchronizeAnchors]);

  // 2. Setup periodic sync updates and frame loop
  useEffect(() => {
    const updateLoop = () => {
      const sData = songDataRef.current;
      let elapsed = 0;

      if (useLocalAudio) {
        const audio = localAudioRef.current;
        if (audio) {
          elapsed = audio.currentTime;
          isPlayingRef.current = !audio.paused;
        }
      } else {
        const ytPlayer = playerRef.current;
        if (ytPlayer && isPlayingRef.current) {
          const now = performance.now();
          const timeDelta = (now - anchorPerfTimeRef.current) / 1000;
          elapsed = anchorYtTimeRef.current + timeDelta * playbackRateRef.current;

          // Periodic Drift Correction (Every 2 seconds)
          if (now - lastDriftCheckRef.current > 2000) {
            lastDriftCheckRef.current = now;
            try {
              const actualYtTime = ytPlayer.getCurrentTime();
              const drift = Math.abs(elapsed - actualYtTime);
              if (drift > 0.1) { 
                anchorYtTimeRef.current = actualYtTime;
                anchorPerfTimeRef.current = now;
                playbackRateRef.current = ytPlayer.getPlaybackRate ? ytPlayer.getPlaybackRate() : 1;
                elapsed = actualYtTime;
              }
            } catch (err) {
              console.warn("Drift check failed: ", err);
            }
          }
        } else if (ytPlayer) {
          try {
            elapsed = ytPlayer.getCurrentTime() || 0;
          } catch {
            // ignore player timing fetch error
          }
        }
      }

      if (elapsed < 0) elapsed = 0;
      setCurrentTime(elapsed);

      // Apply AV Latency Compensation Offset (Shifts visual timeline relative to audio)
      const visualTime = elapsed - (latencyOffset / 1000);

      // Match closest beat in JSON map
      if (sData && sData.beats && sData.beats.length > 0) {
        let closest: Beat | null = null;
        let minDiff = Infinity;

        // Asymmetric visual window: trigger beat highlight from 30ms before to 100ms after the timestamp
        for (let i = 0; i < sData.beats.length; i++) {
          const beat = sData.beats[i];
          const timeDiff = visualTime - beat.timestamp;
          if (timeDiff >= -0.030 && timeDiff < 0.100) {
            const absDiff = Math.abs(timeDiff);
            if (absDiff < minDiff) {
              minDiff = absDiff;
              closest = beat;
            }
          }
        }

        if (closest) {
          // Apply Grid Shift Correction (Shifts beat cycle modularly)
          const shiftedBeatNum = (((closest.beat - 1 + gridShift + 8) % 8) + 1) as any;
          setCurrentBeat({
            ...closest,
            beat: shiftedBeatNum
          });
        } else {
          setCurrentBeat(null);
        }

        // Match active structural section
        if (sData.sections && sData.sections.length > 0) {
          let currentSec = sData.sections[0];
          for (let i = 0; i < sData.sections.length; i++) {
            const sec = sData.sections[i];
            if (visualTime >= sec.startTimestamp) {
              currentSec = sec;
            }
          }
          setActiveSection(currentSec);
        }
      }

      frameIdRef.current = requestAnimationFrame(updateLoop);
    };

    frameIdRef.current = requestAnimationFrame(updateLoop);

    return () => {
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
      }
    };
  }, [useLocalAudio, localAudioRef, latencyOffset, gridShift]);

  // YT state listeners (only active when not using local audio)
  useEffect(() => {
    if (!player || useLocalAudio) return;

    const statePollInterval = setInterval(() => {
      const ytPlayer = playerRef.current;
      if (!ytPlayer || typeof ytPlayer.getPlayerState !== "function") return;

      const playerState = ytPlayer.getPlayerState();
      const currentRate = ytPlayer.getPlaybackRate ? ytPlayer.getPlaybackRate() : 1;
      const isPlaying = playerState === 1;

      if (isPlaying !== isPlayingRef.current || currentRate !== playbackRateRef.current) {
        synchronizeAnchors();
      }
      
      if (isPlaying) {
        const elapsedDelta = (performance.now() - anchorPerfTimeRef.current) / 1000;
        const reckoned = anchorYtTimeRef.current + elapsedDelta * playbackRateRef.current;
        const actual = ytPlayer.getCurrentTime();
        if (Math.abs(reckoned - actual) > 0.5) { 
          synchronizeAnchors();
        }
      }
    }, 200);

    return () => clearInterval(statePollInterval);
  }, [player, useLocalAudio, synchronizeAnchors]);

  return {
    currentTime,
    currentBeat,
    activeSection,
    synchronizeAnchors
  };
}
