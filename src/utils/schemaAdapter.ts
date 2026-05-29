import { AgnosticSong, Section, BeatCountType } from "../types/schemas";

/**
 * Dynamically converts legacy beatmap formats to the unified AgnosticSong structure.
 */
export function adaptToAgnosticSong(data: any, videoDuration: number = 300): AgnosticSong {
  // If it's already in the unified AgnosticSong format, return it with flat compatibility fields added
  if (data && data.rawAnalysis) {
    const song = data as AgnosticSong;
    const bpm = song.calibratedBeatmap?.bpm || song.rawAnalysis.estimatedBpm;
    const beats = song.calibratedBeatmap?.beats || song.rawAnalysis.rawBeats.map((t, idx) => ({
      timestamp: t,
      beat: (idx % 8) + 1
    }));
    const sections = song.calibratedBeatmap?.sections || [];

    return {
      ...song,
      metadata: {
        songTitle: song.title,
        artist: song.artist,
        danceStyle: data.metadata?.danceStyle || data.danceStyle || (song.calibratedBeatmap?.sections?.some(s => s.beatCountType === "bachata-4") ? "bachata" : "salsa"),
        youtubeId: song.youtubeId,
        bpm: bpm,
        difficulty: song.difficulty,
        duration: song.duration
      },
      sections: sections.map((sec, idx) => ({
        name: sec.name,
        startTimestamp: sec.startTimestamp,
        focus: sec.focusInstrument || "",
        emoji: sec.emoji || "🎵"
      })),
      beats: beats
    } as any;
  }

  // Fallback / legacy adaptation
  const metadata = data.metadata || {};
  const legacyBeats = data.beats || [];
  const legacySections = data.sections || [];
  
  const youtubeId = metadata.youtubeId || "";
  const danceStyle = metadata.danceStyle || "salsa";
  const defaultBeatCount: BeatCountType = danceStyle === "bachata" ? "bachata-4" : "salsa-8";

  // Sort and convert sections
  const sortedLegacySections = [...legacySections].sort((a, b) => a.startTimestamp - b.startTimestamp);
  const convertedSections: Section[] = sortedLegacySections.map((sec, idx) => {
    const start = sec.startTimestamp || 0;
    const end = (idx < sortedLegacySections.length - 1) 
      ? sortedLegacySections[idx + 1].startTimestamp 
      : (data.metadata?.duration || videoDuration);

    return {
      id: `sec-${idx}-${sec.name || "section"}`,
      name: sec.name || `Section ${idx + 1}`,
      emoji: sec.emoji || "🎵",
      startTimestamp: start,
      endTimestamp: end,
      focusInstrument: sec.focus || "",
      beatCountType: defaultBeatCount,
      displayCounts: true,
      localOffsetMs: 0
    };
  });

  // Construct AgnosticSong format
  const adapted = {
    id: data.id || `song-${youtubeId}`,
    title: metadata.songTitle || "Untitled Song",
    artist: metadata.artist || "Unknown Artist",
    youtubeId: youtubeId,
    youtubeUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
    difficulty: (metadata.difficulty || "medium").toLowerCase() as any,
    isCalibrated: true, // Legacy loaded songs are assumed calibrated
    rawAnalysis: {
      estimatedBpm: metadata.bpm || 120,
      rawBeats: legacyBeats.map((b: any) => b.timestamp),
      processedAt: new Date().toISOString()
    },
    globalTapLog: [],
    globalReactionDelayMs: 200,
    calibratedBeatmap: {
      bpm: metadata.bpm || 120,
      beats: legacyBeats.map((b: any) => ({
        timestamp: b.timestamp,
        beat: b.beat
      })),
      sections: convertedSections
    },
    
    // Flat compatibility fields:
    metadata: {
      songTitle: metadata.songTitle || "Untitled Song",
      artist: metadata.artist || "Unknown Artist",
      danceStyle: danceStyle,
      youtubeId: youtubeId,
      bpm: metadata.bpm || 120,
      difficulty: metadata.difficulty || "medium",
      duration: metadata.duration || videoDuration,
      introStart: metadata.introStart,
      introEnd: metadata.introEnd
    },
    sections: legacySections,
    beats: legacyBeats
  };

  return adapted as any;
}
