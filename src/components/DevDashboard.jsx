import { useState, useRef } from "react";
import { ArrowLeft, Upload, FileAudio, Youtube, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";

function extractYoutubeId(input) {
  if (!input) return "";
  const trimmed = input.trim();
  
  // 1. Check if exactly 11 characters
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  
  // 2. Check standard URL patterns
  const patterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  // 3. Fallback pattern to extract from custom raw string or iframe tags
  const fallbackMatch = trimmed.match(/(?:\/|v=|embed\/|shorts\/)([a-zA-Z0-9_-]{11})(?:[?&]|$)/);
  if (fallbackMatch && fallbackMatch[1]) {
    return fallbackMatch[1];
  }
  
  return "";
}

export default function DevDashboard({ onBack, onIngestSuccess }) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [youtubeInput, setYoutubeInput] = useState("");
  const youtubeId = extractYoutubeId(youtubeInput);
  const [difficulty, setDifficulty] = useState("medium");
  const [danceStyle, setDanceStyle] = useState("salsa");
  const [audioFile, setAudioFile] = useState(null);

  // Status & Progress states
  const [status, setStatus] = useState("idle"); // idle | uploading | analyzing | success | error
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith("audio/") || file.name.endsWith(".mp3") || file.name.endsWith(".mp4")) {
        setAudioFile(file);
      } else {
        alert("Please select a valid audio file (.mp3 / .mp4)");
      }
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setAudioFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title || !artist || !youtubeId || !audioFile) {
      alert("Please fill in all fields, select a valid audio file, and provide a valid YouTube link or iframe.");
      return;
    }

    if (youtubeId.length !== 11) {
      alert("Please provide a valid YouTube Link, IFrame tag, or 11-character Video ID.");
      return;
    }

    setStatus("uploading");
    setProgress(0);
    setStatusMessage("[1/3] Uploading MP3 audio track...");

    try {
      // Step 1: Ingest Metadata
      const metadataRes = await fetch("/api/ingest-song-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, artist, youtubeId, difficulty, danceStyle })
      });

      const metadataData = await metadataRes.json();
      if (!metadataRes.ok) {
        throw new Error(metadataData.error || "Failed to ingest metadata");
      }

      // Step 2: Upload Audio & Trigger Analysis
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/upload-song-audio?youtubeId=${youtubeId}`, true);

      // Track upload progress
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setProgress(percent);
          setStatusMessage(`[1/3] Uploading MP3 audio track... (${percent}%)`);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result = JSON.parse(xhr.responseText);
            if (result.success) {
              setStatus("success");
              setStatusMessage("[3/3] Ingestion complete! Initializing unified data schema...");
              setTimeout(() => {
                onIngestSuccess(result.song);
              }, 1500);
            } else {
              throw new Error(result.error || "Analysis failed");
            }
          } catch (err) {
            handleUploadError(err.message);
          }
        } else {
          try {
            const errResult = JSON.parse(xhr.responseText);
            handleUploadError(errResult.error || "Upload failed");
          } catch {
            handleUploadError(`Upload failed with status code ${xhr.status}`);
          }
        }
      };

      xhr.onerror = () => {
        handleUploadError("Network connection error occurred during upload");
      };

      // Start the upload
      xhr.send(audioFile);

      // Transition to processing state after upload completes but before response returns
      xhr.upload.onload = () => {
        setStatus("analyzing");
        setProgress(100);
        setStatusMessage("[2/3] Analyzing audio beat intervals (Spawning Salsa-AI Librosa)...");
      };

    } catch (err) {
      handleUploadError(err.message);
    }
  };

  const handleUploadError = (msg) => {
    setStatus("error");
    setErrorMessage(msg);
  };

  return (
    <div style={{ maxWidth: "680px", margin: "40px auto", padding: "0 20px", width: "100%", boxSizing: "border-box" }}>
      {/* Top back row */}
      <button 
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background: "none",
          border: "none",
          color: "#ffffff",
          fontSize: "0.9rem",
          fontWeight: "bold",
          cursor: "pointer",
          marginBottom: "24px",
          padding: 0
        }}
      >
        <ArrowLeft size={16} /> Back to Song Library
      </button>

      <div className="glass-panel" style={{ padding: "30px", borderRadius: "20px", border: "1px solid #27272a", background: "rgba(9, 9, 11, 0.85)", backdropFilter: "blur(12px)" }}>
        <h2 style={{ margin: "0 0 8px 0", fontSize: "1.5rem", fontWeight: "900", color: "#fff", display: "flex", alignItems: "center", gap: "10px" }}>
          🚀 Developer Ingestion Console
        </h2>
        <p style={{ margin: "0 0 24px 0", fontSize: "0.85rem", color: "#9ca3af" }}>
          Add a new track by parsing audio transients natively and generating style-agnostic draft schemas.
        </p>

        {status === "idle" ? (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {/* Row 1: Title & Artist */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: "bold", color: "#ffffff", textTransform: "uppercase" }}>Song Title</label>
                <input 
                  type="text" 
                  value={title} 
                  onChange={(e) => setTitle(e.target.value)} 
                  placeholder="e.g. Pobre Diablo"
                  required
                  style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", color: "#fff", outline: "none" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: "bold", color: "#ffffff", textTransform: "uppercase" }}>Artist</label>
                <input 
                  type="text" 
                  value={artist} 
                  onChange={(e) => setArtist(e.target.value)} 
                  placeholder="e.g. Ronald Borjas"
                  required
                  style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", color: "#fff", outline: "none" }}
                />
              </div>
            </div>

            {/* Row 2: YouTube ID / Link & Difficulty */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: "bold", color: "#ffffff", textTransform: "uppercase", display: "flex", alignItems: "center", gap: "4px" }}>
                  <Youtube size={14} style={{ color: "#ffffff" }} /> YouTube Link or IFrame Tag
                </label>
                <input 
                  type="text" 
                  value={youtubeInput} 
                  onChange={(e) => setYoutubeInput(e.target.value)} 
                  placeholder="Paste URL or embed iframe..."
                  required
                  style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", color: "#fff", outline: "none", fontSize: "0.85rem" }}
                />
                {youtubeId ? (
                  <span style={{ fontSize: "0.7rem", color: "#34d399", fontWeight: "bold", marginTop: "2px" }}>
                    ✓ Parsed Video ID: {youtubeId}
                  </span>
                ) : youtubeInput ? (
                  <span style={{ fontSize: "0.7rem", color: "#f87171", fontWeight: "bold", marginTop: "2px" }}>
                    ✗ Invalid URL or unrecognized ID
                  </span>
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: "bold", color: "#ffffff", textTransform: "uppercase" }}>Difficulty</label>
                <select 
                  value={difficulty} 
                  onChange={(e) => setDifficulty(e.target.value)}
                  style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", color: "#fff", outline: "none", cursor: "pointer" }}
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
            </div>

            {/* Legal Embed Preview Check iframe (Instantly highlights third-party restrictions) */}
            {youtubeId && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid #27272a", padding: "14px", borderRadius: "12px" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: "900", color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  📺 Legal Embed Verification Preview
                </span>
                <iframe
                  width="100%"
                  height="220"
                  src={`https://www.youtube.com/embed/${youtubeId}`}
                  title="YouTube embed verification player"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  style={{ borderRadius: "8px", background: "#000", border: "1px solid rgba(255,255,255,0.05)" }}
                ></iframe>
                <span style={{ fontSize: "0.65rem", color: "#9ca3af", fontStyle: "italic", lineHeight: "1.3" }}>
                  💡 Legal embed check: Attempt playing this preview video. If YouTube shows a grey warning indicating restricted playback, this video is legally forbidden from external embedding.
                </span>
              </div>
            )}

            {/* Row 3: Dance Style */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: "bold", color: "#ffffff", textTransform: "uppercase" }}>Dance Style</label>
              <select 
                value={danceStyle} 
                onChange={(e) => setDanceStyle(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", color: "#fff", outline: "none", cursor: "pointer" }}
              >
                <option value="salsa">Salsa (8-Count Default Grid)</option>
                <option value="bachata">Bachata (4-Count Default Grid)</option>
              </select>
            </div>

            {/* Row 4: Audio File Upload Dropzone */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: "bold", color: "#ffffff", textTransform: "uppercase" }}>Audio Track (.mp3 / .mp4)</label>
              <div 
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "2px dashed #27272a",
                  background: audioFile ? "rgba(255, 255, 255, 0.04)" : "rgba(0,0,0,0.2)",
                  borderRadius: "12px",
                  padding: "24px",
                  textAlign: "center",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px"
                }}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileSelect} 
                  accept="audio/*,.mp3,.mp4" 
                  style={{ display: "none" }} 
                />
                {audioFile ? (
                  <>
                    <FileAudio size={36} style={{ color: "#ffffff" }} />
                    <span style={{ fontSize: "0.9rem", color: "#ffffff", fontWeight: "bold" }}>{audioFile.name}</span>
                    <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Click or drop another file to replace</span>
                  </>
                ) : (
                  <>
                    <Upload size={36} style={{ color: "#ffffff" }} />
                    <span style={{ fontSize: "0.9rem", color: "#e5e7eb", fontWeight: "bold" }}>Drag & Drop MP3 file here</span>
                    <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Or click to browse your files</span>
                  </>
                )}
              </div>
            </div>

            {/* Submit Button */}
            <button 
              type="submit"
              style={{
                background: "linear-gradient(135deg, #ffffff, #d1d5db)",
                border: "none",
                borderRadius: "12px",
                color: "#000000",
                padding: "12px 24px",
                fontSize: "0.95rem",
                fontWeight: "900",
                cursor: "pointer",
                boxShadow: "0 4px 15px rgba(255, 255, 255, 0.15)",
                transition: "all 0.2s ease",
                marginTop: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px"
              }}
            >
              Start Automated Ingestion Pipeline
            </button>
          </form>
        ) : (
          /* Process Status & HUD Panel */
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "20px 10px", alignItems: "center", textAlign: "center" }}>
            {status === "uploading" && (
              <>
                <Loader2 className="animate-spin" size={48} style={{ color: "#ffffff" }} />
                <div style={{ width: "100%", background: "rgba(255,255,255,0.05)", borderRadius: "10px", height: "12px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <div style={{ width: `${progress}%`, background: "#ffffff", height: "100%", transition: "width 0.2s ease" }}></div>
                </div>
              </>
            )}

            {status === "analyzing" && (
              <Loader2 className="animate-spin" size={48} style={{ color: "#ffffff" }} />
            )}

            {status === "success" && (
              <CheckCircle size={48} style={{ color: "#ffffff" }} />
            )}

            {status === "error" && (
              <AlertTriangle size={48} style={{ color: "#a1a1aa" }} />
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: "bold", color: "#ffffff" }}>
                {statusMessage}
              </h3>
              {status === "error" ? (
                <>
                  <p style={{ margin: "4px 0 16px 0", fontSize: "0.85rem", color: "#e5e7eb", background: "rgba(255, 255, 255, 0.02)", padding: "10px 14px", borderRadius: "8px", border: "1px solid #27272a", wordBreak: "break-word" }}>
                    {errorMessage}
                  </p>
                  <button 
                    onClick={() => setStatus("idle")}
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: "8px",
                      color: "#fff",
                      padding: "8px 16px",
                      fontSize: "0.8rem",
                      fontWeight: "bold",
                      cursor: "pointer"
                    }}
                  >
                    Try Again
                  </button>
                </>
              ) : (
                <span style={{ fontSize: "0.75rem", color: "#6b7280", fontStyle: "italic" }}>
                  {status === "uploading" && "Uploading raw audio track securely to local server..."}
                  {status === "analyzing" && "Running MIR transient separation and clustering. This may take 10-15 seconds..."}
                  {status === "success" && "Successfully generated schemas! Redirecting to Workbench..."}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
