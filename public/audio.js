class AudioSink {
    initialize() {
        throw new Error("Not implemented");
    }
    write(buffer) {
        throw new Error("Not implemented");
    }
    close() {
        throw new Error("Not implemented");
    }
}

class MockAudioSink extends AudioSink {
    constructor() {
        super();
        this.initialized = false;
        this.closed = false;
        this.frames = [];
    }

    initialize() {
        this.initialized = true;
    }

    write(buffer) {
        if (!this.initialized) throw new Error("Not initialized");
        this.frames.push(buffer);
    }

    close() {
        this.closed = true;
    }
}

// In Electron, to route audio to VB-CABLE, we don't manipulate raw PCM in JS
// unless we strictly have to. WebRTC provides a MediaStream. We can attach
// it to an <audio> element and use setSinkId. However, the requirements say:
// "write(buffer: Buffer)" and "Decode audio stream, Send audio to VB-CABLE".
// If we must handle raw PCM buffers to fulfill the interface, we'd use Web Audio API
// (AudioContext) to play the buffers.
// Let's implement VBCableAudioSink using Web Audio API AudioContext + setSinkId.

class VBCableAudioSink extends AudioSink {
    constructor() {
        super();
        this.audioContext = null;
        this.audioElement = null;
        this.mediaStreamDestination = null;
        this.deviceId = null;
    }

    async setDeviceByName(namePart) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
        const target = audioOutputs.find(d => d.label.toLowerCase().includes(namePart.toLowerCase()));
        if (target) {
            this.deviceId = target.deviceId;
        } else {
            throw new Error("Device not found");
        }
    }

    async initialize() {
        this.audioContext = new AudioContext({ sampleRate: 48000 });
        this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();

        this.audioElement = document.createElement('audio');
        this.audioElement.style.display = 'none';
        document.body.appendChild(this.audioElement);

        // By default, hook up the manual processing destination
        this.audioElement.srcObject = this.mediaStreamDestination.stream;
        
        if (this.deviceId) {
            if (typeof this.audioElement.setSinkId === 'function') {
                await this.audioElement.setSinkId(this.deviceId);
            } else {
                console.warn("setSinkId not supported");
            }
        }
        
        await this.audioElement.play().catch(e => console.error("Initial play error:", e));
    }

    setStream(stream) {
        if (this.audioElement) {
            this.audioElement.srcObject = stream;
            this.audioElement.play().catch(e => console.error('Audio play error on stream set:', e));
        }
    }

    write(buffer) {
        // buffer should be a Float32Array or Int16Array
        // Convert to AudioBuffer and play it
        if (!this.audioContext) return;
        
        const frameCount = buffer.length;
        const audioBuffer = this.audioContext.createBuffer(1, frameCount, 48000);
        const channelData = audioBuffer.getChannelData(0);
        
        // Convert Int16 to Float32 if necessary
        if (buffer instanceof Int16Array) {
            for (let i = 0; i < frameCount; i++) {
                channelData[i] = buffer[i] / 32768.0;
            }
        } else {
            channelData.set(buffer);
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.mediaStreamDestination);
        source.start();
    }

    close() {
        if (this.audioContext) {
            this.audioContext.close();
        }
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.srcObject = null;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AudioSink, MockAudioSink, VBCableAudioSink };
}
