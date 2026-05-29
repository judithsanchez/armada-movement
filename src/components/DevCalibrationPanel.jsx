const fineTuneSteps = [-0.5, -0.1, 0.1, 0.5];

function FineTuneButtons({ onAdjust }) {
  return (
    <div style={{ display: "flex", gap: "4px" }}>
      {fineTuneSteps.map((step) => (
        <button key={step} className="btn-step" onClick={() => onAdjust(step)}>
          {step > 0 ? `+${step}s` : `${step}s`}
        </button>
      ))}
    </div>
  );
}

export default function DevCalibrationPanel({
  calibrationStats,
  estimatedDelay,
  anchors,
  userDelaySetting,
  onUserDelaySettingChange,
  onExit,
  onResetCalibration,
  onCopyCalibratedJson,
  onDownloadCalibratedJson,
  tempBreakStart,
  tempBreakEnd,
  onTempBreakStartChange,
  onTempBreakEndChange,
  onMarkBreakStart,
  onMarkBreakEnd,
  onAddNewBreak,
  breaks,
  onDeleteBreak,
  onAddNewSection,
  editorSections,
  activeEditingSectionId,
  onToggleEditingSection,
  introStart,
  introEnd,
  videoDuration,
  onIntroStartChange,
  onIntroEndChange,
  onMarkIntroStart,
  onMarkIntroEnd,
  onSaveMetadataAndBreaks,
  onUpdateSectionName,
  onUpdateSectionTimes,
  player,
  onSaveSectionsToDisk,
  onDeleteSection
}) {
  return (
    <div className="glass-panel dev-panel right-workspace-column">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "8px" }}>
        <span style={{ fontSize: "0.9rem", fontWeight: "800", color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: "6px" }}>
          🛠️ Creator Calibration Desk
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "0.7rem", color: "#6b7280", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: "6px" }}>DEV MODE</span>
          <button
            onClick={onExit}
            style={{ background: "rgba(255, 255, 255, 0.04)", border: "1px solid #27272a", color: "#ffffff", padding: "2px 8px", borderRadius: "6px", fontSize: "0.7rem", fontWeight: "700", cursor: "pointer", transition: "all 0.2s ease" }}
            title="Lock and hide the Developer Calibration Desk"
          >
            Exit
          </button>
        </div>
      </div>

      {calibrationStats && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: "800", color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            📊 Calibration Stats
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", background: "rgba(255, 255, 255, 0.02)", padding: "10px", borderRadius: "10px", border: "1px solid rgba(255, 255, 255, 0.08)", fontSize: "0.75rem" }}>
            <Stat label="Total Taps" value={calibrationStats.totalTaps} color="#fff" />
            <Stat label="Matched Taps" value={calibrationStats.matchedTaps} color="#ffffff" />
            <Stat label="Outliers" value={calibrationStats.outliersCount} color="#ffffff" />
            <Stat label="Median Diff" value={`${calibrationStats.medianDiffMs}ms`} color="#ffffff" />
            {estimatedDelay !== null && <Stat label="Est. Reaction Delay" value={`${Math.round(estimatedDelay * 1000)}ms`} color="#ffffff" />}
            {anchors.length > 0 && <Stat label="Warp Anchors" value={`${anchors.length} active`} color="#ffffff" />}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", fontWeight: "800", color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          <span>Reaction Delay</span>
          <span>{userDelaySetting}ms</span>
        </div>
        <input
          type="range"
          min="0"
          max="500"
          step="10"
          value={userDelaySetting}
          onChange={(e) => onUserDelaySettingChange(parseInt(e.target.value))}
          style={{ flexGrow: 1, accentColor: "#ffffff" }}
        />
        <span style={{ fontSize: "0.6rem", color: "#6b7280", fontStyle: "italic" }}>
          Compensates for reaction lag when tapping counts.
        </span>
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "12px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px" }}>
        <button
          className="btn-step"
          onClick={onResetCalibration}
          style={{ flexGrow: 1, padding: "8px 12px", fontSize: "0.75rem", fontWeight: "700", background: "rgba(255, 255, 255, 0.04)", border: "1px solid #27272a", color: "#a1a1aa" }}
        >
          🔄 Reset Calibration Grid
        </button>
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
        <button className="btn-step" onClick={onCopyCalibratedJson} style={{ flexGrow: 1, padding: "6px 10px", fontSize: "0.7rem", fontWeight: "700", background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.1)", color: "#fff" }} title="Copy current calibrated beatmap JSON to clipboard">
          📋 Copy JSON
        </button>
        <button className="btn-step" onClick={onDownloadCalibratedJson} style={{ flexGrow: 1, padding: "6px 10px", fontSize: "0.7rem", fontWeight: "700", background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.1)", color: "#fff" }} title="Download calibrated beatmap as a JSON file">
          💾 Download JSON
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: "800", color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          ❄️ Cierre Breaks Editor
        </span>

        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: "4px" }}>
            <BreakInputRow value={tempBreakStart} onChange={onTempBreakStartChange} onMark={onMarkBreakStart} placeholder="Start (s)" title="Mark break start" />
            <BreakInputRow value={tempBreakEnd} onChange={onTempBreakEndChange} onMark={onMarkBreakEnd} placeholder="End (s)" title="Mark break end" />
          </div>
          <button className="btn-step" onClick={onAddNewBreak} style={{ height: "48px", background: "rgba(255, 255, 255, 0.04)", border: "1px solid #27272a", color: "#ffffff", fontSize: "0.7rem", fontWeight: "700" }}>
            ➕ Add
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "120px", overflowY: "auto", background: "rgba(0,0,0,0.1)", padding: "6px", borderRadius: "8px" }}>
          {breaks.map((breakEvent) => (
            <div key={breakEvent.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.65rem", padding: "4px 6px", borderRadius: "4px", background: "rgba(255,255,255,0.03)" }}>
              <span style={{ color: "#e5e7eb" }}>❄️ {breakEvent.startTimestamp.toFixed(2)}s - {breakEvent.endTimestamp.toFixed(2)}s</span>
              <button onClick={() => onDeleteBreak(breakEvent.id)} style={{ background: "none", border: "none", color: "#a1a1aa", cursor: "pointer", fontSize: "0.75rem" }} title="Delete break">
                🗑️
              </button>
            </div>
          ))}
          {breaks.length === 0 && (
            <span style={{ fontSize: "0.6rem", color: "#6b7280", fontStyle: "italic", textAlign: "center" }}>No cierre breaks set.</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: "800", color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            🏷️ Song Sections Editor
          </span>
          <button className="btn-step" onClick={onAddNewSection} style={{ padding: "4px 10px", fontSize: "0.7rem", fontWeight: "700", background: "rgba(255, 255, 255, 0.04)", border: "1px solid #27272a", color: "#ffffff" }}>
            ➕ Add Section
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "rgba(255,255,255,0.02)", padding: "8px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.04)" }}>
          <IntroEditor
            activeEditingSectionId={activeEditingSectionId}
            onToggleEditingSection={onToggleEditingSection}
            introStart={introStart}
            introEnd={introEnd}
            videoDuration={videoDuration}
            onIntroStartChange={onIntroStartChange}
            onIntroEndChange={onIntroEndChange}
            onMarkIntroStart={onMarkIntroStart}
            onMarkIntroEnd={onMarkIntroEnd}
            onSaveMetadataAndBreaks={onSaveMetadataAndBreaks}
          />

          {editorSections.map((section) => (
            <SectionEditor
              key={section.id}
              section={section}
              isEditing={activeEditingSectionId === section.id}
              videoDuration={videoDuration}
              onToggleEditingSection={onToggleEditingSection}
              onUpdateSectionName={onUpdateSectionName}
              onUpdateSectionTimes={onUpdateSectionTimes}
              onSaveSectionsToDisk={onSaveSectionsToDisk}
              onDeleteSection={onDeleteSection}
              player={player}
            />
          ))}

          {editorSections.length === 0 && (
            <span style={{ fontSize: "0.65rem", color: "#6b7280", fontStyle: "italic", textAlign: "center" }}>No sections yet. Click ➕ Add Section!</span>
          )}
        </div>
      </div>

      <button
        className="btn-diagnose-action"
        onClick={onSaveMetadataAndBreaks}
        style={{ width: "100%", minHeight: "42px", background: "linear-gradient(135deg, #ffffff, #d1d5db)", boxShadow: "0 4px 14px rgba(255, 255, 255, 0.15)", border: "none", color: "#000000", fontWeight: "800", textTransform: "uppercase", borderRadius: "12px", fontSize: "0.8rem", letterSpacing: "0.5px", cursor: "pointer", display: "flex", alignItems: "center", justifycontent: "center", gap: "8px", marginTop: "8px", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }}
        title="Save the song intro boundaries to disk"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        <span>Save Song Boundaries</span>
      </button>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ color: "#9ca3af", fontSize: "0.65rem" }}>{label}</span>
      <span style={{ fontWeight: "700", color }}>{value}</span>
    </div>
  );
}

function BreakInputRow({ value, onChange, onMark, placeholder, title }) {
  return (
    <div style={{ display: "flex", gap: "4px" }}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "4px 8px", fontSize: "0.75rem", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.2)", color: "#fff" }}
      />
      <button className="btn-dev-sync" style={{ padding: "4px 8px", fontSize: "0.65rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }} onClick={onMark} title={title}>
        Mark
      </button>
    </div>
  );
}

function IntroEditor({
  activeEditingSectionId,
  onToggleEditingSection,
  introStart,
  introEnd,
  videoDuration,
  onIntroStartChange,
  onIntroEndChange,
  onMarkIntroStart,
  onMarkIntroEnd,
  onSaveMetadataAndBreaks
}) {
  const introId = "__intro__";
  const isEditingIntro = activeEditingSectionId === introId;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px", borderRadius: "8px", border: `1px solid ${isEditingIntro ? "rgba(255, 255, 255, 0.3)" : "rgba(255,255,255,0.06)"}`, background: isEditingIntro ? "rgba(255, 255, 255, 0.08)" : "rgba(255,255,255,0.02)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ flexGrow: 1, fontSize: "0.8rem", fontWeight: "700", color: "#e5e7eb" }}>🎬 Intro Region</span>
        <EditToggle isEditing={isEditingIntro} onClick={() => onToggleEditingSection(isEditingIntro ? null : introId)} />
        <IconButton onClick={onSaveMetadataAndBreaks} title="Save intro boundaries to disk" icon="💾" />
      </div>

      {isEditingIntro ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
          <TimestampEditor
            label="Start"
            value={introStart}
            color="#ffffff"
            max={videoDuration}
            onChange={onIntroStartChange}
            onMark={onMarkIntroStart}
          />
          <TimestampEditor
            label="End"
            value={introEnd}
            color="#ffffff"
            max={videoDuration}
            onChange={onIntroEndChange}
            onMark={onMarkIntroEnd}
          />
        </div>
      ) : (
        <div style={{ display: "flex", gap: "16px", fontSize: "0.65rem", color: "#9ca3af", fontStyle: "italic", padding: "2px 4px" }}>
          <span>Start: <strong style={{ color: "#e5e7eb" }}>{introStart.toFixed(2)}s</strong></span>
          <span>End: <strong style={{ color: "#e5e7eb" }}>{introEnd.toFixed(2)}s</strong></span>
        </div>
      )}
    </div>
  );
}

function SectionEditor({
  section,
  isEditing,
  videoDuration,
  onToggleEditingSection,
  onUpdateSectionName,
  onUpdateSectionTimes,
  onSaveSectionsToDisk,
  onDeleteSection,
  player
}) {
  const markCurrentTime = (field) => {
    if (!player) return;
    const currentTime = parseFloat(player.getCurrentTime().toFixed(2));
    onUpdateSectionTimes(section.id, field, currentTime);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px", borderRadius: "8px", border: `1px solid ${isEditing ? "rgba(255, 255, 255, 0.3)" : "rgba(255,255,255,0.04)"}`, background: isEditing ? "rgba(255, 255, 255, 0.08)" : "rgba(0,0,0,0.15)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          type="text"
          value={section.name}
          onChange={(e) => onUpdateSectionName(section.id, e.target.value)}
          placeholder="Section Name (e.g. Verse, Chorus)"
          style={{ flexGrow: 1, padding: "4px 8px", fontSize: "0.75rem", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.2)", color: "#fff", fontWeight: "600" }}
        />
        <EditToggle isEditing={isEditing} onClick={() => onToggleEditingSection(isEditing ? null : section.id)} />
        <IconButton onClick={onSaveSectionsToDisk} title="Save sections to disk" icon="💾" />
        <IconButton onClick={() => onDeleteSection(section.id)} title="Delete section" icon="🗑️" />
      </div>

      {isEditing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
          <TimestampEditor
            label="Start"
            value={section.startTimestamp}
            color="#ffffff"
            max={videoDuration}
            onChange={(value) => onUpdateSectionTimes(section.id, "startTimestamp", value)}
            onMark={() => markCurrentTime("startTimestamp")}
          />
          <TimestampEditor
            label="End"
            value={section.endTimestamp}
            color="#ffffff"
            max={videoDuration}
            onChange={(value) => onUpdateSectionTimes(section.id, "endTimestamp", value)}
            onMark={() => markCurrentTime("endTimestamp")}
          />
        </div>
      ) : (
        <div style={{ display: "flex", gap: "16px", fontSize: "0.65rem", color: "#9ca3af", fontStyle: "italic", padding: "2px 4px" }}>
          <span>Start: <strong style={{ color: "#e5e7eb" }}>{section.startTimestamp.toFixed(2)}s</strong></span>
          <span>End: <strong style={{ color: "#e5e7eb" }}>{section.endTimestamp.toFixed(2)}s</strong></span>
        </div>
      )}
    </div>
  );
}

function TimestampEditor({ label, value, color, max, onChange, onMark }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", fontWeight: "600", color: "#9ca3af" }}>
        <span>{label}</span>
        <span style={{ color: "#ffffff" }}>{value.toFixed(2)}s</span>
      </div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="range"
          min="0"
          max={max}
          step="0.05"
          value={value}
          onChange={(e) => onChange(e.target.value, false)}
          onMouseUp={(e) => onChange(e.target.value, true)}
          onTouchEnd={(e) => onChange(e.target.value, true)}
          style={{ flexGrow: 1, height: "6px", cursor: "pointer", accentColor: "#ffffff" }}
        />
        <button className="btn-dev-sync" onClick={onMark} title={`Mark current playhead as ${label.toLowerCase()}`}>🎯 Mark</button>
      </div>
      <FineTuneButtons onAdjust={(step) => onChange(value + step, true)} />
    </div>
  );
}

function EditToggle({ isEditing, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ background: isEditing ? "rgba(255, 255, 255, 0.12)" : "rgba(255,255,255,0.05)", border: `1px solid ${isEditing ? "rgba(255, 255, 255, 0.3)" : "rgba(255,255,255,0.1)"}`, color: isEditing ? "#ffffff" : "#6b7280", padding: "2px 8px", borderRadius: "6px", fontSize: "0.7rem", fontWeight: "700", cursor: "pointer", whiteSpace: "nowrap" }}
    >
      {isEditing ? "✏️ On" : "✏️ Off"}
    </button>
  );
}

function IconButton({ onClick, title, icon }) {
  return (
    <button
      onClick={onClick}
      style={{ background: "none", border: "none", fontSize: "0.95rem", cursor: "pointer", opacity: 0.7, transition: "opacity 0.15s ease" }}
      onMouseEnter={(e) => e.target.style.opacity = 1}
      onMouseLeave={(e) => e.target.style.opacity = 0.7}
      title={title}
    >
      {icon}
    </button>
  );
}
