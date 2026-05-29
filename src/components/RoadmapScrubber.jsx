export default function RoadmapScrubber({
  currentTime,
  videoDuration,
  introStart,
  introEnd,
  nextSection,
  timeToNextSection,
  showDiagnostic,
  editorSections,
  sectionsList,
  breaks,
  onSeek
}) {
  const duration = videoDuration || 1;

  return (
    <div className="glass-panel" style={{ padding: "14px 16px", marginBottom: "0px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", fontWeight: "600", color: "#9ca3af", marginBottom: "8px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          Song Roadmap
          {nextSection && timeToNextSection <= 10 && (
            <span style={{ fontSize: "0.65rem", color: "#fb7185", marginLeft: "8px", fontWeight: "bold" }}>
              ➡️ {nextSection.name} in {timeToNextSection.toFixed(1)}s
            </span>
          )}
        </span>
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
            onSeek(clickPercent * duration, true);
          }}
        >
          <div
            className="roadmap-segment segment-intro"
            style={{
              left: `${(introStart / duration) * 100}%`,
              width: `${((introEnd - introStart) / duration) * 100}%`
            }}
            title="Song Intro Region"
          />

          {(showDiagnostic ? editorSections : sectionsList).map((sec, idx) => (
            <div
              key={idx}
              className="roadmap-section-marker"
              style={{ left: `${(sec.startTimestamp / duration) * 100}%` }}
              title={`${sec.name} Start`}
            />
          ))}

          {breaks.map((breakEvent) => (
            <div
              key={breakEvent.id}
              className="roadmap-segment segment-break"
              style={{
                left: `${(breakEvent.startTimestamp / duration) * 100}%`,
                width: `${((breakEvent.endTimestamp - breakEvent.startTimestamp) / duration) * 100}%`
              }}
              title={`Cierre Stop: ${breakEvent.startTimestamp}s - ${breakEvent.endTimestamp}s`}
            />
          ))}

          <div
            className="roadmap-playhead"
            style={{ left: `${(currentTime / duration) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
