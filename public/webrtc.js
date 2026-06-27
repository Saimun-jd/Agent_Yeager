// Simple wrapper for RTCPeerConnection to receive audio
class WebRTCReceiver {
    constructor(audioSink) {
        this.pc = new RTCPeerConnection();
        this.audioSink = audioSink;
        this.mediaStream = null;

        this.pc.ontrack = (event) => {
            if (event.track.kind === 'audio') {
                this.mediaStream = event.streams[0];
                this.handleIncomingTrack(this.mediaStream);
            }
        };

        this.pc.ondatachannel = (event) => {
            const channel = event.channel;
            channel.onmessage = (e) => {
                const data = JSON.parse(e.data);
                if (data.timestamp) {
                    channel.send(JSON.stringify({ reply: true, timestamp: data.timestamp }));
                }
            };
        };
    }

    handleIncomingTrack(stream) {
        // Normally, the audio sink would just take the stream if using VBCableAudioSink,
        // or we use WebAudio to process frames.
        if (this.audioSink.setStream) {
            this.audioSink.setStream(stream);
        }
    }

    async createAnswer(offer) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        return answer;
    }

    addIceCandidate(candidate) {
        return this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WebRTCReceiver };
}
