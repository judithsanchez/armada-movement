export type DanceStyle = "salsa" | "bachata";
export type SalsaBeatCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type BachataBeatCount = 1 | 2 | 3 | 4;
export type BeatCount = SalsaBeatCount | BachataBeatCount;
export type BreakAction = "freeze" | "mute";
export type Difficulty = "easy" | "medium" | "hard";

export interface Beat {
  timestamp: number;
  beat: BeatCount;
}

export interface Section {
  name: string;
  startTimestamp: number;
  focus: string;
  emoji: string;
}

export interface BreakEvent {
  id: string;
  startTimestamp: number;
  endTimestamp: number;
  label: string;
  action: BreakAction;
}

export interface SongMetadata {
  songTitle: string;
  artist: string;
  danceStyle: DanceStyle;
  youtubeId: string;
  bpm: number;
  difficulty?: Difficulty;
  duration?: number;
  introStart?: number;
  introEnd?: number;
}

export interface BeatmapSchema {
  id: string;
  schemaVersion: "1.1";
  metadata: SongMetadata;
  sections: Section[];
  events: BreakEvent[];
  breaks?: BreakEvent[];
  beats: Beat[];
}

export type CatalogSong = SongMetadata & {
  id: string;
  difficulty: Difficulty;
};
