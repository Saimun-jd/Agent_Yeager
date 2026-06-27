// Globals available from audio.js and webrtc.js
window.onerror = function(msg, url, lineNo, columnNo, error) {
    alert("Global Error: " + msg + " at " + lineNo + ":" + columnNo);
    return false;
};

let audioSink = new VBCableAudioSink();
let webrtcReceiver;
let socket = io('https://localhost:3000');
let audioContextForVolume = new AudioContext();
let analyser = audioContextForVolume.createAnalyser();

async function populateDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
    
    const select = document.getElementById('deviceSelect');
    select.innerHTML = '';
    
    audioOutputs.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `Speaker ${select.length + 1}`;
        if (device.label.toLowerCase().includes('cable')) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function updateVolumeMeter(stream) {
    if (audioContextForVolume.state === 'suspended') {
        audioContextForVolume.resume();
    }
    const source = audioContextForVolume.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function renderFrame() {
        requestAnimationFrame(renderFrame);
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for(let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        let average = sum / bufferLength;
        document.getElementById('volumeMeter').value = average;
    }
    renderFrame();
}

async function startReceiver() {
    try {
        webrtcReceiver = new WebRTCReceiver(audioSink);
        
        // HACK: Create a silent audio stream to send back to the mobile device.
        const silentContext = new AudioContext();
        const oscillator = silentContext.createOscillator();
        const dst = silentContext.createMediaStreamDestination();
        const gainNode = silentContext.createGain();
        
        oscillator.type = 'sine';
        oscillator.frequency.value = 440;
        gainNode.gain.value = 0.0001; 
        
        oscillator.connect(gainNode);
        gainNode.connect(dst);
        oscillator.start();
        dst.stream.getTracks().forEach(track => webrtcReceiver.pc.addTrack(track, dst.stream));
    } catch (err) {
        alert("Error starting receiver: " + err.message);
        document.getElementById('connectBtn').disabled = false;
        return;
    }

    socket.on('connect', () => {
        console.log('Connected to signaling server');
        // Join as desktop
        socket.emit('signal', { type: 'join', role: 'desktop' });
    });

    socket.on('signal', async (data) => {
        if (data.type === 'offer') {
            const answer = await webrtcReceiver.createAnswer(data.offer);
            socket.emit('signal', { type: 'answer', answer });
        } else if (data.type === 'candidate') {
            await webrtcReceiver.addIceCandidate(data.candidate);
        } else if (data.type === 'ping') {
            socket.emit('signal', { type: 'pong', time: data.time });
        } else if (data.type === 'latency') {
            document.getElementById('latencyValue').innerText = data.ms;
        }
    });

    socket.on('server_log', (data) => {
        appendAiLog(data.msg);
        if (data.modelsLoaded) {
            document.getElementById('applyAiBtn').disabled = false;
        }
    });

    webrtcReceiver.pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { type: 'candidate', candidate: event.candidate });
        }
    };

    webrtcReceiver.pc.onconnectionstatechange = () => {
        const statusEl = document.getElementById('connStatus');
        statusEl.innerText = webrtcReceiver.pc.connectionState;
        if (webrtcReceiver.pc.connectionState === 'connected') {
            statusEl.className = 'status connected';
            if (webrtcReceiver.mediaStream) {
                updateVolumeMeter(webrtcReceiver.mediaStream);
            }
        } else {
            statusEl.className = 'status disconnected';
            document.getElementById('volumeMeter').value = 0;
            document.getElementById('latencyValue').innerText = 'N/A';
            document.getElementById('connectBtn').disabled = false;
            document.getElementById('connectBtn').innerText = "Reconnect Receiver";
        }
    };

    await audioSink.initialize();
}

document.getElementById('connectBtn').addEventListener('click', () => {
    startReceiver();
    document.getElementById('connectBtn').disabled = true;
});

document.getElementById('applyDeviceBtn').addEventListener('click', () => {
    const deviceId = document.getElementById('deviceSelect').value;
    if (deviceId) {
        audioSink.deviceId = deviceId;
        if (audioSink.audioElement && typeof audioSink.audioElement.setSinkId === 'function') {
            audioSink.audioElement.setSinkId(deviceId);
        }
    }
});

// AI Control Panel Logic
function appendAiLog(msg) {
    const logsDiv = document.getElementById('aiLogs');
    const time = new Date().toLocaleTimeString();
    let colorStyle = '';
    const lowerMsg = msg.toLowerCase();
    if (lowerMsg.includes('error') || lowerMsg.includes('fail')) {
        colorStyle = ' style="color: #ff003c;"';
    } else if (lowerMsg.includes('warn')) {
        colorStyle = ' style="color: #ffff00;"';
    }
    logsDiv.innerHTML += `<div${colorStyle}>[${time}] ${msg}</div>`;
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

// Load saved models from localStorage
window.addEventListener('DOMContentLoaded', () => {
    const savedVoice = localStorage.getItem('voiceModel');
    const savedVoiceCustom = localStorage.getItem('voiceModelCustom');
    const savedCleanup = localStorage.getItem('cleanupModel');
    const savedCleanupCustom = localStorage.getItem('cleanupModelCustom');

    if (savedVoice) {
        document.getElementById('voiceModelSelect').value = savedVoice;
        if (savedVoice === 'custom' && savedVoiceCustom) {
            document.getElementById('voiceModelCustom').value = savedVoiceCustom;
            document.getElementById('voiceModelCustom').style.display = 'block';
        }
    }

    if (savedCleanup) {
        document.getElementById('cleanupModelSelect').value = savedCleanup;
        if (savedCleanup === 'custom' && savedCleanupCustom) {
            document.getElementById('cleanupModelCustom').value = savedCleanupCustom;
            document.getElementById('cleanupModelCustom').style.display = 'block';
        }
    }
});

document.getElementById('voiceModelSelect').addEventListener('change', (e) => {
    document.getElementById('voiceModelCustom').style.display = e.target.value === 'custom' ? 'block' : 'none';
});

document.getElementById('cleanupModelSelect').addEventListener('change', (e) => {
    document.getElementById('cleanupModelCustom').style.display = e.target.value === 'custom' ? 'block' : 'none';
});

document.getElementById('applyAiBtn').addEventListener('click', () => {
    if (!socket) {
        alert("Please 'Start Receiver' first to connect to the server.");
        return;
    }
    
    let voiceModel = document.getElementById('voiceModelSelect').value;
    let voiceModelCustom = document.getElementById('voiceModelCustom').value.trim();
    if (voiceModel === 'custom') {
        if (!voiceModelCustom) return alert("Please enter a custom Voice model ID.");
        voiceModel = voiceModelCustom;
    }

    let cleanupModel = document.getElementById('cleanupModelSelect').value;
    let cleanupModelCustom = document.getElementById('cleanupModelCustom').value.trim();
    if (cleanupModel === 'custom') {
        if (!cleanupModelCustom) return alert("Please enter a custom Cleanup model ID.");
        cleanupModel = cleanupModelCustom;
    }
    
    // Save to localStorage
    localStorage.setItem('voiceModel', document.getElementById('voiceModelSelect').value);
    localStorage.setItem('voiceModelCustom', voiceModelCustom);
    localStorage.setItem('cleanupModel', document.getElementById('cleanupModelSelect').value);
    localStorage.setItem('cleanupModelCustom', cleanupModelCustom);

    appendAiLog(`Requested models: Voice=${voiceModel}, Cleanup=${cleanupModel}`);
    document.getElementById('applyAiBtn').disabled = true;
    
    socket.emit('load_models', { voiceModel, cleanupModel });
});

// Setup device list
navigator.mediaDevices.getUserMedia({ audio: true }).then(() => {
    populateDevices();
}).catch(e => {
    console.error("Need microphone permission to list devices reliably in some environments", e);
    populateDevices(); // fallback
});

// Display the connection URL
async function displayUrl() {
    try {
        const localIP = await window.electronAPI.getLocalIP();
        // Add ?v=9 to bypass mobile browser caching so the PWA fix works!
        const url = `https://${localIP}:3000/mobile.html?v=9`;
        document.getElementById('connectUrl').innerText = url;
        
        // Generate QR Code using a robust online API
        const qrcodeImg = document.getElementById('qrcode');
        qrcodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(url)}`;
        qrcodeImg.style.display = 'inline-block';
    } catch (error) {
        document.getElementById('connectUrl').innerText = `Error: ${error.message}`;
        console.error("Error setting local IP:", error);
    }
}
displayUrl();
