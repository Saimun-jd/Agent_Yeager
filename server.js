require("dotenv").config();
const { Server } = require("socket.io");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const selfsigned = require("selfsigned");
const { WaveFile } = require("wavefile");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

// AI Pipelines
let transformers = null;
let voicePipeline = null;
let cleanupPipeline = null;

let mcpClient = null;

async function setupMCP() {
    const transport = new StdioClientTransport({
        command: process.platform === "win32" ? "npx.cmd" : "npx",
        args: ["-y", "spotify-mcp"],
        env: process.env
    });

    mcpClient = new Client({
        name: "VoiceAssistant",
        version: "1.0.0"
    }, {
        capabilities: { tools: {} }
    });

    try {
        await mcpClient.connect(transport);
        console.log("Connected to Spotify MCP Server");
    } catch (error) {
        console.error("Failed to connect to MCP:", error);
    }
}
setupMCP();

const requestHandler = (req, res) => {
    const basePath = req.url.split('?')[0];
    const fileMap = {
        '/': 'mobile.html',
        '/index.html': 'index.html',
        '/mobile.html': 'mobile.html',
        '/manifest.json': 'manifest.json',
        '/sw.js': 'sw.js',
        '/audio.js': 'audio.js',
        '/webrtc.js': 'webrtc.js',
        '/renderer.js': 'renderer.js'
    };

    const file = fileMap[basePath];
    if (file) {
        fs.readFile(path.join(__dirname, file), (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end();
            }
            const ext = path.extname(file);
            const mime = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.json' ? 'application/json' : 'text/plain';
            res.writeHead(200, { 'Content-Type': mime });
            res.end(data);
        });
    } else if (basePath.endsWith('.jpg') || basePath.endsWith('.png') || basePath.endsWith('.jpeg')) {
        // Serve image files for the background
        const imgPath = path.join(__dirname, basePath);
        fs.readFile(imgPath, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end();
            }
            const ext = path.extname(basePath).toLowerCase();
            const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end();
    }
};

const os = require('os');
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
}
const localIP = getLocalIP();
const attrs = [{ name: 'commonName', value: 'localhost' }];
let httpServer = null;
const io = new Server({ cors: { origin: "*" } });

async function initServer() {
    const pems = await selfsigned.generate(attrs, {
        days: 365,
        keySize: 2048,
        extensions: [{
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'localhost' },
                { type: 7, ip: '127.0.0.1' },
                ...(localIP !== 'localhost' ? [{ type: 7, ip: localIP }] : [])
            ]
        }]
    });
    httpServer = https.createServer({ key: pems.private, cert: pems.cert }, requestHandler);
    io.attach(httpServer);
    return httpServer;
}

async function parseSpotifyCommand(commandObj, socket) {
    if (!mcpClient) {
        console.error(" MCP Client not connected.");
        return;
    }

    const logAndEmit = (msg) => {
        console.log(msg);
        socket.emit("server_log", { msg: msg });
    };

    if (!commandObj || !commandObj.action || commandObj.action === "unknown") {
        logAndEmit(" Could not determine a clear Spotify action from your speech.");
        return;
    }

    const action = commandObj.action;

    if (action === "pause") {
        logAndEmit(" Pausing Spotify...");
        await mcpClient.callTool({ name: "pause", arguments: {} });
        logAndEmit(" Paused.");
        return;
    }

    if (action === "resume") {
        logAndEmit(" Resuming Spotify...");
        await mcpClient.callTool({ name: "play", arguments: {} });
        logAndEmit(" Resumed.");
        return;
    }

    if (action === "next") {
        logAndEmit(" Skipping to next track...");
        try {
            await mcpClient.callTool({ name: "skip_next", arguments: {} });
            await mcpClient.callTool({ name: "play", arguments: {} });
            logAndEmit(" Skipped and playing.");
        } catch (e) {
            logAndEmit(" Failed to skip next: " + (e.message || e));
        }
        return;
    }

    if (action === "previous") {
        logAndEmit(" Skipping to previous track...");
        try {
            await mcpClient.callTool({ name: "skip_previous", arguments: {} });
            await mcpClient.callTool({ name: "play", arguments: {} });
            logAndEmit(" Skipped back and playing.");
        } catch (e) {
            logAndEmit(" Failed to skip previous: " + (e.message || e));
        }
        return;
    }

    if (action === "volume_up" || action === "volume_down" || action === "set_volume") {
        logAndEmit(" Volume control is mapped but requires MCP plugin support.");
        return;
    }

    if (action === "like") {
        logAndEmit(" Adding current song to Liked Songs...");
        try {
            const nowPlaying = await mcpClient.callTool({ name: "get_now_playing", arguments: {} });
            if (nowPlaying && nowPlaying.content && nowPlaying.content.length > 0) {
                const npText = nowPlaying.content[0].text;
                let uri = null;
                const match = npText.match(/spotify:track:[a-zA-Z0-9]+/);
                if (match) uri = match[0];

                if (uri) {
                    await mcpClient.callTool({ name: "save_items", arguments: { uris: [uri] } });
                    logAndEmit(` Added ${uri} to Liked Songs!`);
                } else {
                    logAndEmit(" Could not find a currently playing track URI to like.");
                }
            } else {
                logAndEmit(" Nothing seems to be playing right now.");
            }
        } catch (err) {
            logAndEmit(" Error liking song: " + (err.message || err));
        }
        return;
    }

    if (action === "play_liked") {
        try {
            logAndEmit(" Fetching your Liked Songs...");
            const savedResult = await mcpClient.callTool({
                name: "get_saved_tracks",
                arguments: { limit: 50 }
            });
            if (savedResult && !savedResult.isError && savedResult.content && savedResult.content.length > 0) {
                const textOutput = savedResult.content[0].text;
                const matches = textOutput.match(/spotify:track:[a-zA-Z0-9]+/g);

                if (matches && matches.length > 0) {
                    const uris = matches;
                    logAndEmit(` Playing ${uris.length} of your liked songs...`);

                    let playResult = await mcpClient.callTool({ name: "play", arguments: { uris: uris } });
                    if (playResult && playResult.isError) {
                        logAndEmit(" Playback failed, attempting to find an available device to wake up...");
                        let deviceId = null;
                        try {
                            const devicesRes = await mcpClient.callTool({ name: "get_devices", arguments: {} });
                            if (devicesRes && !devicesRes.isError && devicesRes.content.length > 0) {
                                const text = devicesRes.content[0].text;
                                try {
                                    const parsed = JSON.parse(text);
                                    if (parsed.devices && parsed.devices.length > 0) {
                                        deviceId = parsed.devices[0].id;
                                    }
                                } catch (e) {
                                    const match = text.match(/ID:\s*([a-zA-Z0-9a-fA-F-]+)/);
                                    if (match) deviceId = match[1];
                                }
                            }
                        } catch (e) { }

                        if (deviceId) {
                            logAndEmit(` Found device ${deviceId}, routing playback there...`);
                            await mcpClient.callTool({ name: "transfer_playback", arguments: { device_id: deviceId, play: false } }).catch(() => { });
                            await new Promise(r => setTimeout(r, 800));
                            playResult = await mcpClient.callTool({ name: "play", arguments: { uris: uris, device_id: deviceId } });
                        } else {
                            logAndEmit(" No devices found. Make sure Spotify is open somewhere!");
                        }
                    }
                    if (playResult && playResult.isError) {
                        logAndEmit(" Playback failed! Spotify said: " + playResult.content[0].text);
                    } else {
                        logAndEmit(" Liked songs playing successfully!");
                        await mcpClient.callTool({ name: "set_shuffle", arguments: { state: true } });
                    }
                } else {
                    logAndEmit(" You don't have any liked songs.");
                }
            } else {
                logAndEmit(" Error fetching liked songs.");
            }
        } catch (err) {
            logAndEmit(" Error: " + (err.message || err));
        }
        return;
    }

    if (action === "play") {
        let queryParts = [];
        if (commandObj.song) queryParts.push(commandObj.song);
        if (commandObj.artist) queryParts.push(commandObj.artist);
        if (commandObj.album) queryParts.push(commandObj.album);
        if (commandObj.playlist) queryParts.push(commandObj.playlist);

        const query = queryParts.join(" ").trim();

        if (query) {
            try {
                logAndEmit(` Searching Spotify for: "${query}"`);
                const searchResult = await mcpClient.callTool({
                    name: "search",
                    arguments: { query: query, types: ["track"], limit: 1 }
                });

                let uri = null;
                if (searchResult && searchResult.isError) {
                    logAndEmit(" Spotify MCP returned an error: " + searchResult.content[0].text);
                } else if (searchResult && searchResult.content && searchResult.content.length > 0) {
                    const contentText = searchResult.content[0].text;
                    logAndEmit(" Search successful! Extracting URI...");
                    try {
                        const parsed = JSON.parse(contentText);
                        if (parsed.tracks && parsed.tracks.items && parsed.tracks.items.length > 0) {
                            uri = parsed.tracks.items[0].uri;
                        }
                    } catch (e) {
                        const match = contentText.match(/spotify:track:[a-zA-Z0-9]+/);
                        if (match) uri = match[0];
                    }
                }

                if (uri) {
                    logAndEmit(` Triggering playback for URI: ${uri}`);
                    let playResult = await mcpClient.callTool({
                        name: "play",
                        arguments: { uris: [uri] }
                    });

                    if (playResult && playResult.isError) {
                        logAndEmit(" Playback failed, attempting to find an available device to wake up...");
                        let deviceId = null;
                        try {
                            const devicesRes = await mcpClient.callTool({ name: "get_devices", arguments: {} });
                            if (devicesRes && !devicesRes.isError && devicesRes.content.length > 0) {
                                const text = devicesRes.content[0].text;
                                try {
                                    const parsed = JSON.parse(text);
                                    if (parsed.devices && parsed.devices.length > 0) {
                                        deviceId = parsed.devices[0].id;
                                    }
                                } catch (e) {
                                    const match = text.match(/ID:\s*([a-zA-Z0-9a-fA-F-]+)/);
                                    if (match) deviceId = match[1];
                                }
                            }
                        } catch (e) { }

                        if (deviceId) {
                            logAndEmit(` Found device ${deviceId}, routing playback there...`);
                            await mcpClient.callTool({ name: "transfer_playback", arguments: { device_id: deviceId, play: false } }).catch(() => { });
                            await new Promise(r => setTimeout(r, 800));
                            playResult = await mcpClient.callTool({
                                name: "play",
                                arguments: { uris: [uri], device_id: deviceId }
                            });
                        } else {
                            logAndEmit(" No devices found. Make sure Spotify is open somewhere!");
                        }
                    }

                    if (playResult && playResult.isError) {
                        logAndEmit(" Playback failed! Spotify said: " + playResult.content[0].text);
                    } else {
                        logAndEmit(" Playback command sent successfully!");
                    }
                } else {
                    logAndEmit(" No track URI found to play.");
                }
            } catch (err) {
                logAndEmit(" Error executing MCP tool: " + (err.message || err));
            }
        } else {
            logAndEmit(" Resuming playback...");
            await mcpClient.callTool({ name: "play", arguments: {} });
        }
    } else {
        logAndEmit(" Command did not match any known Spotify actions. Ignored.");
    }
}

async function processNaturalLanguage(rawText, socket) {
    let commandObj = { action: "unknown" };

    console.log("\n--- NLP PIPELINE ---");
    console.log("Voice Model Output:", rawText);

    if (cleanupPipeline && rawText.length > 3) {
        socket.emit("server_log", { msg: " Step 2: Running LLM Intent Extraction..." });

        let jsonString = "";

        try {
            const systemPrompt = `You are an intent extractor. Fix any spelling errors (like 'model california' -> 'hotel california'). Output JSON only.

Input: "I would love to hear Chasing Cars"
Output: {"action": "play", "song": "Chasing Cars"}

Input: "can you play chasing cars by Snow Patrol"
Output: {"action": "play", "artist": "Snow Patrol"}

Input: "play chasing cars by Snow Patrol"
Output: {"action": "play", "artist": "Snow Patrol"}

Input: "play the next track please"
Output: {"action": "next"}

Input: "skip this one"
Output: {"action": "next"}

Input: "Please change this sound."
Output: {"action": "next"}

Input: "play something else"
Output: {"action": "next"}

Input: "go back to the last song"
Output: {"action": "previous"}

Input: "play that again"
Output: {"action": "previous"}

Input: "stop the music"
Output: {"action": "pause"}

Input: "shut up for a second"
Output: {"action": "pause"}

Input: "continue playing"
Output: {"action": "resume"}

Input: "turn it down a bit"
Output: {"action": "volume_down"}

Input: "too loud"
Output: {"action": "volume_down"}

Input: "louder please"
Output: {"action": "volume_up"}

Input: "add this to my liked songs"
Output: {"action": "like"}

Input: "this is a banger save it"
Output: {"action": "like"}

Input: "play my liked songs"
Output: {"action": "play_liked"}

Input: "shuffle my liked songs"
Output: {"action": "play_liked"}

Input: "Play one of my like songs"
Output: {"action": "play_liked"}

Input: "Play "Songname" by "artist"
output

Input: "I am in the mood for something"
Output: {"action": "unknown"}`;

            if (cleanupPipeline.task === 'text-generation') {
                const prompt = `${systemPrompt}\n\nInput: "${rawText}"\nOutput:`;
                const cleanupResult = await cleanupPipeline(prompt, { max_new_tokens: 60, temperature: 0.1, repetition_penalty: 1.15 });
                console.log("Raw pipeline object:", JSON.stringify(cleanupResult[0]));
                let generated = cleanupResult[0].generated_text;

                // If it repeated our prompt, slice it off
                if (generated.startsWith(prompt)) {
                    generated = generated.slice(prompt.length);
                }

                jsonString = generated;
            } else {
                const prompt = `${systemPrompt}\n\nInput: "${rawText}"\nOutput:`;
                const cleanupResult = await cleanupPipeline(prompt, { max_new_tokens: 60, temperature: 0.1, repetition_penalty: 1.15 });
                console.log("Raw pipeline object:", JSON.stringify(cleanupResult[0]));
                let generated = cleanupResult[0].generated_text;
                if (generated.includes(prompt)) {
                    generated = generated.slice(prompt.length);
                }
                jsonString = generated;
            }

            console.log("LLM Raw Output:", jsonString);

            // Attempt to extract JSON from the LLM output
            const match = jsonString.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    commandObj = JSON.parse(match[0]);
                } catch (parseErr) {
                    console.log("JSON Parse Failed on substring:", match[0]);
                }
            } else {
                console.log("No JSON structure found in output.");
                socket.emit("server_log", { msg: ` Failed to extract JSON. Raw AI Output: ${jsonString}` });
            }

        } catch (err) {
            console.error("LLM Extraction Error:", err);
            socket.emit("server_log", { msg: ` LLM Error: ${err.message}` });
        }

        console.log("Final Extracted Intent:", commandObj);
        socket.emit("server_log", { msg: ` Intent Extracted: ${JSON.stringify(commandObj)}` });
    }

    if (commandObj.action === "unknown") {
        // Fallback basic text matching if no model is loaded OR if the LLM hallucinated
        console.log("Falling back to basic regex parsing...");
        const lowerText = rawText.toLowerCase();
        if (lowerText.includes("pause")) commandObj.action = "pause";
        else if (lowerText.includes("liked song") || lowerText.includes("like song") || lowerText.includes("liked playlist") || lowerText.includes("like playlist")) commandObj.action = "play_liked";
        else if (lowerText.includes("next") || lowerText.includes("skip") || (lowerText.includes("change") && (lowerText.includes("sound") || lowerText.includes("song")))) commandObj.action = "next";
        else if (lowerText.includes("play")) {
            commandObj.action = "play";
            commandObj.song = lowerText.replace("spotify", "").replace("play", "").trim();
        }
    }

    // Convert to readable text for the mobile UI
    let readableIntent = `Action: ${commandObj.action}`;
    if (commandObj.song) readableIntent += ` | Song: ${commandObj.song}`;
    if (commandObj.artist) readableIntent += ` | Artist: ${commandObj.artist}`;
    socket.emit("ai_transcription", { text: rawText, intent: readableIntent });

    await parseSpotifyCommand(commandObj, socket);
}

io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("signal", (data) => {
        socket.broadcast.emit("signal", data);
    });

    socket.on("load_models", async (data) => {
        const { voiceModel, cleanupModel } = data;
        socket.emit("server_log", { msg: `Initializing Transformers.js...` });

        try {
            if (!transformers) transformers = await import('@xenova/transformers');
            const { pipeline } = transformers;

            let lastLogTime = Date.now();
            const progressCallback = (info) => {
                if (info.status === 'progress') {
                    // Throttle updates to every 1 second
                    if (Date.now() - lastLogTime > 1000) {
                        socket.emit("server_log", { msg: ` Downloading ${info.file}: ${Math.round(info.progress)}%` });
                        lastLogTime = Date.now();
                    }
                } else if (info.status === 'done') {
                    socket.emit("server_log", { msg: ` Finished downloading ${info.file}` });
                }
            };

            socket.emit("server_log", { msg: `Loading Voice Model: ${voiceModel} (Downloading if not cached)` });
            voicePipeline = await pipeline('automatic-speech-recognition', voiceModel, { progress_callback: progressCallback });
            socket.emit("server_log", { msg: ` Voice Model Ready.` });

            if (cleanupModel !== 'none') {
                socket.emit("server_log", { msg: `Loading Cleanup Model: ${cleanupModel}` });
                try {
                    cleanupPipeline = await pipeline('text2text-generation', cleanupModel, { progress_callback: progressCallback });
                } catch (e) {
                    if (e.message && e.message.includes('Unsupported model type')) {
                        socket.emit("server_log", { msg: ` Not a text2text model, trying text-generation pipeline...` });
                        cleanupPipeline = await pipeline('text-generation', cleanupModel, { progress_callback: progressCallback });
                    } else {
                        throw e;
                    }
                }
                socket.emit("server_log", { msg: ` Cleanup Model Ready.` });
            } else {
                cleanupPipeline = null;
                socket.emit("server_log", { msg: `Cleanup Model Disabled.` });
            }

            socket.emit("server_log", { msg: ` All systems ready. Waiting for voice commands...`, modelsLoaded: true });
        } catch (err) {
            console.error(err);
            socket.emit("server_log", { msg: ` Failed to load models: ${err.message}`, modelsLoaded: true });
        }
    });

    socket.on("voice_command", async (data) => {
        socket.emit("server_log", { msg: `[Manual Text] Processing: "${data.text}"` });
        await processNaturalLanguage(data.text, socket);
    });

    socket.on("audio_pcm", async (buffer) => {
        console.log(" Received raw PCM audio chunk.");

        if (!voicePipeline) {
            socket.emit("server_log", { msg: " AI Models not loaded. Please select them on your Desktop." });
            socket.emit("ai_transcription", { error: "AI Models not loaded on PC." });
            return;
        }

        try {
            socket.emit("server_log", { msg: " Step 1: Running Whisper Voice-to-Text..." });
            const float32Data = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / Float32Array.BYTES_PER_ELEMENT);

            const result = await voicePipeline(float32Data);
            let rawText = result.text.trim();
            socket.emit("server_log", { msg: ` Whisper Output: "${rawText}"` });

            await processNaturalLanguage(rawText, socket);

        } catch (e) {
            console.error("AI inference error:", e);
            socket.emit("server_log", { msg: ` AI Error: ${e.message}` });
            socket.emit("ai_transcription", { error: "Failed to transcribe audio on PC." });
        }
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
    });
});

if (require.main === module) {
    initServer().then((server) => {
        server.listen(3000, "0.0.0.0", () => {
            console.log("HTTPS Signaling server running on port 3000");
        });
    });
} else {
    module.exports = {
        listen: (port, host, cb) => {
            initServer().then((server) => {
                server.listen(port, host, cb);
            });
        }
    };
}
