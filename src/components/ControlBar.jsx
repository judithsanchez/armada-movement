
import { Play, Pause, RotateCcw } from "lucide-react";

export default function ControlBar({
  isActuallyPlaying,
  onPlayToggle,
  playbackRate,
  onSpeedChange,
  onRewind
}) {
  return (
    <div className="glass-panel" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div className="controls-panel" style={{ display: "flex", flexDirection: "row", gap: "10px", alignItems: "center" }}>
        
        {/* Rewind 10s Button */}
        <button 
          className="btn-touch" 
          onClick={onRewind} 
          title="Rewind 10 seconds"
          style={{ flex: "0 0 54px", minHeight: "48px", display: "flex", justifyContent: "center", alignItems: "center" }}
        >
          <RotateCcw size={20} />
        </button>

        {/* Play / Pause Toggle Button */}
        <button className="btn-touch btn-play" onClick={onPlayToggle} style={{ flexGrow: 2 }}>
          {isActuallyPlaying ? (
            <>
              <Pause size={20} fill="currentColor" />
              <span>Pause Song</span>
            </>
          ) : (
            <>
              <Play size={20} fill="currentColor" />
              <span>Play Song</span>
            </>
          )}
        </button>

        {/* Speed Controls Selector */}
        <div className="speed-toggle-container" style={{ flex: "0 0 auto" }}>
          {[0.5, 0.75, 1.0].map((rate) => (
            <button
              key={rate}
              className={`speed-option ${playbackRate === rate ? "active" : ""}`}
              onClick={() => onSpeedChange(rate)}
              title={`Set speed to ${rate}x`}
            >
              {rate}x
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}
