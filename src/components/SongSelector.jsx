import { useState, useEffect } from "react";
import { Music, Search } from "lucide-react";

export default function SongSelector({ onSelectSong, onOpenDevDashboard }) {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [styleFilter, setStyleFilter] = useState("all");

  // Fetch song catalog on startup
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + "songs/catalog.json")
      .then((res) => {
        if (!res.ok) throw new Error("Catalog fetch failed");
        return res.json();
      })
      .then((data) => {
        setCatalog(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[SongSelector] Failed to load catalog JSON:", err);
        setError("Failed to load song catalog.");
        setLoading(false);
      });
  }, []);

  const filteredSongs = catalog.filter((song) => {
    // Hide uncalibrated draft songs from normal catalog selectors
    if (song.isCalibrated === false && !onOpenDevDashboard) {
      return false;
    }

    const matchesSearch =
      song.songTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      song.artist.toLowerCase().includes(searchQuery.toLowerCase());
      
    const matchesDifficulty =
      difficultyFilter === "all" || song.difficulty.toLowerCase() === difficultyFilter.toLowerCase();
      
    const matchesStyle =
      styleFilter === "all" || song.danceStyle.toLowerCase() === styleFilter.toLowerCase();

    return matchesSearch && matchesDifficulty && matchesStyle;
  });

  if (loading) {
    return (
      <div className="glass-panel loading-container" style={{ padding: "40px", textAlign: "center" }}>
        <div className="loading-spinner"></div>
        <div style={{ marginTop: "12px", fontWeight: 600, color: "#e5e7eb" }}>Loading Catalog...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel" style={{ padding: "30px", textAlign: "center", color: "#f87171" }}>
        <p>❌ {error}</p>
        <button 
          onClick={() => { setLoading(true); setError(null); }}
          className="btn-touch"
          style={{ marginTop: "12px", maxWidth: "200px", margin: "12px auto 0" }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="catalog-title-wrapper" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px", marginBottom: "20px" }}>
        <div>
          <h1 className="catalog-title" style={{ margin: 0 }}>Salsa Rhythm Hub</h1>
          <p className="catalog-subtitle" style={{ margin: "4px 0 0 0" }}>
            Master the Latin count structure and calibrate micro-timings with absolute auditory precision.
          </p>
        </div>
        {onOpenDevDashboard && (
          <button
            onClick={onOpenDevDashboard}
            style={{
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid #27272a",
              color: "#ffffff",
              padding: "10px 18px",
              borderRadius: "12px",
              fontSize: "0.85rem",
              fontWeight: "900",
              cursor: "pointer",
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.2)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
              e.currentTarget.style.borderColor = "#27272a";
            }}
          >
            🚀 Developer Console
          </button>
        )}
      </div>

      {/* Search & Filters Panel */}
      <div className="glass-panel" style={{ padding: "16px", marginBottom: "20px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Search Input */}
          <div style={{ position: "relative", width: "100%" }}>
            <Search 
              size={18} 
              style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#6b7280" }} 
            />
            <input
              type="text"
              placeholder="Search songs or artists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px 10px 38px",
                fontSize: "0.9rem",
                borderRadius: "12px",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                background: "rgba(0, 0, 0, 0.3)",
                color: "#fff",
                outline: "none",
                boxSizing: "border-box"
              }}
            />
          </div>

          {/* Filters Selects */}
          <div style={{ display: "flex", gap: "10px" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "0.7rem", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px" }}>Dance Style</label>
              <select
                value={styleFilter}
                onChange={(e) => setStyleFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  background: "rgba(0, 0, 0, 0.3)",
                  color: "#fff",
                  fontSize: "0.8rem",
                  outline: "none"
                }}
              >
                <option value="all">All Styles</option>
                <option value="salsa">Salsa</option>
                <option value="bachata">Bachata</option>
              </select>
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "0.7rem", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px" }}>Difficulty</label>
              <select
                value={difficultyFilter}
                onChange={(e) => setDifficultyFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  background: "rgba(0, 0, 0, 0.3)",
                  color: "#fff",
                  fontSize: "0.8rem",
                  outline: "none"
                }}
              >
                <option value="all">All Difficulties</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Song Cards Grid */}
      <div className="catalog-grid">
        {filteredSongs.map((song) => (
          <div
            key={song.id}
            className="song-card"
            onClick={() => onSelectSong(song)}
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
                <span className="badge badge-style" style={{ textTransform: "capitalize" }}>{song.danceStyle}</span>
              </div>
            </div>
          </div>
        ))}

        {filteredSongs.length === 0 && (
          <div 
            className="glass-panel" 
            style={{ 
              gridColumn: "1 / -1", 
              padding: "40px 20px", 
              textAlign: "center", 
              color: "#9ca3af",
              fontStyle: "italic" 
            }}
          >
            No songs matched your search criteria.
          </div>
        )}
      </div>
    </div>
  );
}
