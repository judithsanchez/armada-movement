import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/armada-movement/' : '/',
  server: {
    historyApiFallback: true,
  },
  plugins: [
    react(),
    {
      name: 'save-beatmap-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const pathname = parsedUrl.pathname;

          const saveToBoth = (fileName, fileData) => {
            const filePath = path.join(__dirname, 'public', 'songs', fileName);
            fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf8');
            console.log(`[Developer API] Successfully saved: ${filePath}`);
          };

          if (pathname === '/api/save-beatmap' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const { youtubeId, activeBeatmap, originalBeatmap, calibration } = JSON.parse(body);
                const songId = youtubeId || 'calibrated_song';

                // File 1: Original baseline machine analysis (Write ONCE, never overwrite)
                const origFileName = `${songId}_original.json`;
                const origCheckPath = path.join(__dirname, 'public', 'songs', origFileName);
                if (!fs.existsSync(origCheckPath)) {
                  saveToBoth(origFileName, originalBeatmap);
                  console.log(`[Developer API] Wrote baseline machine analysis backup: ${origFileName}`);
                } else {
                  console.log(`[Developer API] Baseline backup already exists, skipping write: ${origFileName}`);
                }

                // File 2: Calibration ground-truth tap log
                const calFileName = `${songId}_calibration.json`;
                saveToBoth(calFileName, calibration);

                // File 3: Active normalized beatmap
                const activeFileName = `${songId}.json`;
                saveToBoth(activeFileName, activeBeatmap);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  success: true, 
                  message: `Successfully saved active, baseline, and calibration files for ${songId}` 
                }));
              } catch (err) {
                console.error("[Developer API] Save beatmap failed:", err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
              }
            });
          } 
          else if (pathname === '/api/ingest-song-metadata' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const { title, artist, youtubeId, difficulty, danceStyle } = JSON.parse(body);
                if (!youtubeId || youtubeId.length !== 11) {
                  throw new Error("Invalid YouTube ID (must be exactly 11 characters)");
                }
                const fileName = `${youtubeId}.json`;
                const checkPath = path.join(__dirname, 'public', 'songs', fileName);
                if (fs.existsSync(checkPath)) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ success: false, error: "Song with this YouTube ID already exists" }));
                  return;
                }

                // Create default entry in AgnosticSong schema structure
                const songData = {
                  id: `song-${youtubeId}`,
                  title: title || "Untitled Song",
                  artist: artist || "Unknown Artist",
                  youtubeId: youtubeId,
                  youtubeUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
                  difficulty: difficulty || "medium",
                  isCalibrated: false,
                  rawAnalysis: {
                    estimatedBpm: 0,
                    rawBeats: [],
                    processedAt: new Date().toISOString()
                  },
                  globalTapLog: [],
                  globalReactionDelayMs: 200,
                  
                  // Flat compatibility fields:
                  metadata: {
                    songTitle: title || "Untitled Song",
                    artist: artist || "Unknown Artist",
                    danceStyle: danceStyle || "salsa",
                    youtubeId: youtubeId,
                    bpm: 0,
                    difficulty: difficulty || "medium"
                  },
                  sections: [],
                  beats: []
                };

                saveToBoth(fileName, songData);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, song: songData }));
              } catch (err) {
                console.error("[Developer API] Ingest song metadata failed:", err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
              }
            });
          }
          else if (pathname === '/api/save-draft' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const { youtubeId, draft } = JSON.parse(body);
                const fileName = `${youtubeId}_draft.json`;
                saveToBoth(fileName, draft);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
              } catch (err) {
                console.error("[Developer API] Save draft failed:", err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
              }
            });
          }
          else if (pathname === '/api/upload-song-audio' && req.method === 'POST') {
            try {
              const youtubeId = parsedUrl.searchParams.get('youtubeId');
              if (!youtubeId || youtubeId.length !== 11) {
                throw new Error("Invalid or missing YouTube ID");
              }

              const tempFileName = `temp_${youtubeId}.mp3`;
              const tempFilePath = path.join(__dirname, 'public', 'songs', tempFileName);
              
              // Pipe request stream to temp MP3 file
              const fileStream = fs.createWriteStream(tempFilePath);
              req.pipe(fileStream);

              fileStream.on('error', (err) => {
                console.error("[Developer API] Temp MP3 stream error:", err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
              });

              fileStream.on('finish', () => {
                console.log(`[Developer API] Temp MP3 fully written: ${tempFilePath}`);
                
                // Spawn Python Librosa Analyzer
                const scriptPath = path.join(__dirname, 'scripts', 'analyze_salsa_advanced.py');
                const outFilePath = path.join(__dirname, 'public', 'songs', `${youtubeId}.json`);

                console.log(`[Developer API] Spawning Python analyzer subprocess...`);
                const pyProcess = spawn('python3', [scriptPath, '--audio', tempFilePath, '--output', outFilePath]);

                let stdoutData = '';
                let stderrData = '';

                pyProcess.stdout.on('data', (chunk) => { stdoutData += chunk; });
                pyProcess.stderr.on('data', (chunk) => { stderrData += chunk; });

                pyProcess.on('close', (code) => {
                  console.log(`[Developer API] Python process closed with code ${code}`);
                  if (stderrData) {
                    console.log(`[Developer API] Python stderr:\n${stderrData}`);
                  }
                  
                  // Delete temp file immediately in all circumstances
                  try {
                    if (fs.existsSync(tempFilePath)) {
                      fs.unlinkSync(tempFilePath);
                      console.log(`[Developer API] Deleted temporary MP3: ${tempFilePath}`);
                    }
                  } catch (delErr) {
                    console.error("[Developer API] Failed to delete temp file:", delErr);
                  }

                  if (code !== 0) {
                    let errMsg = `Python analyzer exited with non-zero code ${code}`;
                    if (stderrData.includes("ModuleNotFoundError")) {
                      errMsg += ". Missing Python dependency! Please run: pip3 install -r requirements.txt";
                    }
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                      success: false, 
                      error: errMsg, 
                      details: stderrData || stdoutData 
                    }));
                    return;
                  }

                  try {
                    // Read updated JSON
                    if (!fs.existsSync(outFilePath)) {
                      throw new Error("Analyzed output JSON was not found");
                    }
                    const songData = JSON.parse(fs.readFileSync(outFilePath, 'utf8'));

                    // Update catalog.json
                    const catalogPath = path.join(__dirname, 'public', 'songs', 'catalog.json');
                    let catalog = [];
                    if (fs.existsSync(catalogPath)) {
                      catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
                    }

                    const catalogEntry = {
                      id: songData.id,
                      songTitle: songData.title,
                      artist: songData.artist,
                      danceStyle: songData.metadata?.danceStyle || "salsa",
                      youtubeId: songData.youtubeId,
                      bpm: songData.rawAnalysis?.estimatedBpm || 0,
                      difficulty: songData.difficulty,
                      isCalibrated: false
                    };

                    const existingIdx = catalog.findIndex(item => item.youtubeId === youtubeId);
                    if (existingIdx !== -1) {
                      catalog[existingIdx] = catalogEntry;
                    } else {
                      catalog.push(catalogEntry);
                    }

                    saveToBoth('catalog.json', catalog);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, song: songData }));
                  } catch (err) {
                    console.error("[Developer API] Post-analysis parsing/catalog update failed:", err);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                  }
                });
              });

            } catch (err) {
              console.error("[Developer API] Upload MP3 endpoint error:", err);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          }
          else {
            next();
          }
        });
      }
    }
  ],
})
