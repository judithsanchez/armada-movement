export default function CalibrationTapDeck({
  rawTaps,
  onTapOnOne,
  onSaveToDisk,
  onClearTaps
}) {
  return (
    <div className="glass-panel" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
      <button
        className="btn-diagnose-tap"
        onClick={onTapOnOne}
        style={{ width: "100%", height: "80px", borderRadius: "16px", border: "3px solid rgba(255, 255, 255, 0.4)" }}
      >
        <span style={{ fontSize: "1.2rem", fontWeight: "800" }}>TAP ON "1"</span>
        <span style={{ fontSize: "0.65rem", opacity: 0.8, fontWeight: "400" }}>Tap every time you hear count 1</span>
      </button>

      {rawTaps.length > 0 && (
        <div style={{ display: "flex", width: "100%", gap: "10px", marginTop: "4px" }}>
          <button
            className={`btn-diagnose-action ${rawTaps.length >= 50 ? "active-ready" : "locked-pending"}`}
            onClick={onSaveToDisk}
            disabled={rawTaps.length < 50}
            style={{
              flexGrow: 1,
              minHeight: "48px",
              background: rawTaps.length >= 50
                ? "linear-gradient(135deg, #ffffff, #d1d5db)"
                : "rgba(255,255,255,0.03)",
              boxShadow: rawTaps.length >= 50
                ? "0 4px 16px rgba(255, 255, 255, 0.25)"
                : "none",
              border: rawTaps.length >= 50
                ? "none"
                : "1px solid rgba(255, 255, 255, 0.05)",
              color: rawTaps.length >= 50 ? "#000000" : "#6b7280",
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
            onClick={onClearTaps}
            style={{
              width: "48px",
              height: "48px",
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid #27272a",
              borderRadius: "12px",
              color: "#a1a1aa",
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
  );
}
