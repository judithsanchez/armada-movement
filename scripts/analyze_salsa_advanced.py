import os
import json
import time
import argparse
import numpy as np
import librosa
import librosa.segment

def main():
    parser = argparse.ArgumentParser(description="Advanced Salsa Audio Beat Tracker and Structure Analyzer")
    parser.add_argument("--audio", required=True, help="Path to the audio file to analyze")
    parser.add_argument("--output", required=True, help="Path where output JSON beatmap should be written")
    args = parser.parse_args()

    audio_path = args.audio
    output_path = args.output
    
    if not os.path.exists(audio_path):
        print(f"[ERROR] Audio file not found at: {audio_path}")
        return
        
    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    
    print("[SALSA-AI] Loading audio file...")
    start_time = time.time()
    y, sr = librosa.load(audio_path, sr=22050)
    duration = librosa.get_duration(y=y, sr=sr)
    print(f"[SALSA-AI] Loaded in {time.time() - start_time:.2f}s. Duration: {duration:.2f}s")
    
    # 1. Harmonic-Percussive Source Separation (HPSS)
    print("[SALSA-AI] Separating percussive transients from harmonic vocals/brass...")
    hpss_start = time.time()
    y_harm, y_perc = librosa.effects.hpss(y)
    print(f"[SALSA-AI] HPSS completed in {time.time() - hpss_start:.2f}s.")
    
    # 2. Beat Tracking on Isolated Percussive signal
    print("[SALSA-AI] Running beat tracking on isolated percussive track...")
    beat_start = time.time()
    tempo, beat_frames = librosa.beat.beat_track(y=y_perc, sr=sr)
    
    if hasattr(tempo, 'item'):
        tempo = tempo.item()
    elif isinstance(tempo, (list, tuple, np.ndarray)) and len(tempo) > 0:
        tempo = tempo[0]
        
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    print(f"[SALSA-AI] Beat tracking completed. BPM: {tempo:.2f}. Beats found: {len(beat_times)}")
    
    # 3. Structural Segmentation (Agglomerative Clustering)
    # Disabled automatic section generation so that new songs start with zero sections by default.
    sections = []
        
    # 4. Construct 8-Count Cycle Beats list
    beats_list = []
    for idx, t in enumerate(beat_times):
        beat_count = (idx % 8) + 1
        beats_list.append({
            "timestamp": round(float(t), 3),
            "beat": beat_count
        })

    # Read existing metadata if available
    metadata = {
        "songTitle": "Pobre Diablo",
        "artist": "Ronald Borjas",
        "danceStyle": "salsa",
        "youtubeId": "66HCBysrJS8",
        "difficulty": "hard",
        "bpm": round(tempo, 2)
    }
    
    existing_id = None
    if os.path.exists(output_path):
        try:
            with open(output_path, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
                if "metadata" in existing_data and existing_data["metadata"]:
                    metadata.update(existing_data["metadata"])
                elif "title" in existing_data:
                    metadata["songTitle"] = existing_data.get("title", metadata["songTitle"])
                    metadata["artist"] = existing_data.get("artist", metadata["artist"])
                    metadata["youtubeId"] = existing_data.get("youtubeId", metadata["youtubeId"])
                    metadata["difficulty"] = existing_data.get("difficulty", metadata["difficulty"])
                    metadata["danceStyle"] = existing_data.get("danceStyle", "salsa")
                if "id" in existing_data:
                    existing_id = existing_data["id"]
        except Exception as e:
            print(f"[SALSA-AI WARNING] Could not read existing JSON: {e}")

    dance_style = metadata.get("danceStyle", "salsa").lower()
    default_beat_count = "bachata-4" if dance_style == "bachata" else "salsa-8"

    # Convert sections to new schema
    formatted_sections = []
    for idx, sec in enumerate(sections):
        formatted_sections.append({
            "id": f"sec-{idx}",
            "name": sec["name"] or f"Section {idx + 1}",
            "emoji": sec["emoji"] or "🎵",
            "startTimestamp": sec["startTimestamp"],
            "endTimestamp": sections[idx + 1]["startTimestamp"] if idx < len(sections) - 1 else round(float(duration), 2),
            "focusInstrument": sec["focus"],
            "beatCountType": default_beat_count,
            "displayCounts": True,
            "localOffsetMs": 0
        })

    # Assemble complete schema JSON
    schema_json = {
        "id": existing_id or f"song-{metadata['youtubeId']}",
        "title": metadata["songTitle"],
        "artist": metadata["artist"],
        "youtubeId": metadata["youtubeId"],
        "youtubeUrl": f"https://www.youtube.com/watch?v={metadata['youtubeId']}",
        "difficulty": metadata["difficulty"].lower(),
        "isCalibrated": False,
        
        "rawAnalysis": {
            "estimatedBpm": round(tempo, 2),
            "rawBeats": [round(float(t), 3) for t in beat_times],
            "processedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        },
        "globalTapLog": [],
        "globalReactionDelayMs": 200,
        "calibratedBeatmap": {
            "bpm": round(tempo, 2),
            "beats": beats_list,
            "sections": formatted_sections
        },
        
        # Flat compatibility fields:
        "metadata": {
            "songTitle": metadata["songTitle"],
            "artist": metadata["artist"],
            "danceStyle": dance_style,
            "youtubeId": metadata["youtubeId"],
            "bpm": round(tempo, 2),
            "difficulty": metadata["difficulty"].lower()
        },
        "sections": [
            {
                "name": sec["name"],
                "startTimestamp": sec["startTimestamp"],
                "focus": sec["focus"],
                "emoji": sec["emoji"]
            }
            for sec in sections
        ],
        "beats": beats_list
    }
    
    # Save file
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(schema_json, f, indent=2, ensure_ascii=False)
        
    print(f"\n[SUCCESS] Advanced Salsa Beatmap successfully created at: {output_path}")

if __name__ == "__main__":
    main()
