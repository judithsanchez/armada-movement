import json
import os

def main():
    print("[Beatmap Generator] Generating template beatmap for Adicto...")
    
    # Eduardo Moreno & Okocán - Adicto
    # YouTube ID: RWRHAVGoEiw
    # Tempo: ~190 BPM
    bpm = 190.0
    interval = 60.0 / bpm
    duration_sec = 280.0  # 4 minutes 40 seconds
    
    total_beats = int(duration_sec / interval)
    print(f"  * BPM: {bpm}")
    print(f"  * Beat Interval: {interval:.4f}s")
    print(f"  * Generating {total_beats} beats...")
    
    beats = []
    for idx in range(total_beats):
        beats.append({
            "timestamp": round(idx * interval, 3),
            "beat": (idx % 8) + 1
        })
        
    adicto_song = {
        "id": "song-salsa-adicto",
        "schemaVersion": "1.1",
        "metadata": {
            "songTitle": "Adicto",
            "artist": "Eduardo Moreno & Okocán",
            "danceStyle": "salsa",
            "youtubeId": "RWRHAVGoEiw",
            "bpm": bpm,
            "difficulty": "medium"
        },
        "sections": [
            {
                "name": "Intro / Starting Groove",
                "startTimestamp": 0.0,
                "focus": "conga",
                "emoji": "🪘"
            }
        ],
        "events": [],
        "beats": beats
    }
    
    # 1. Save to WSL / project songs directory
    output_dir = "public/songs"
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "RWRHAVGoEiw.json")
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(adicto_song, f, indent=2, ensure_ascii=False)
        
    print(f"[SUCCESS] Generated starting beatmap successfully at: {output_path}")

if __name__ == "__main__":
    main()
