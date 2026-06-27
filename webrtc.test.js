const { WebRTCReceiver } = require('./webrtc');
const { MockAudioSink } = require('./audio');

describe('WebRTC Receiver', () => {
    beforeAll(() => {
        global.RTCPeerConnection = jest.fn().mockImplementation(() => ({
            ontrack: null,
            setRemoteDescription: jest.fn().mockResolvedValue(),
            createAnswer: jest.fn().mockResolvedValue({ type: 'answer', sdp: 'dummy' }),
            setLocalDescription: jest.fn().mockResolvedValue(),
            addIceCandidate: jest.fn().mockResolvedValue()
        }));
        global.RTCSessionDescription = jest.fn(desc => desc);
        global.RTCIceCandidate = jest.fn(cand => cand);
    });

    test('Desktop creates WebRTC receiver', () => {
        const sink = new MockAudioSink();
        const receiver = new WebRTCReceiver(sink);
        expect(receiver.pc).toBeDefined();
    });

    test('Incoming audio track is received', () => {
        const sink = new MockAudioSink();
        sink.setStream = jest.fn();
        const receiver = new WebRTCReceiver(sink);
        
        // Simulate ontrack event
        const mockStream = { id: 'test-stream' };
        receiver.pc.ontrack({
            track: { kind: 'audio' },
            streams: [mockStream]
        });

        expect(receiver.mediaStream).toBe(mockStream);
        expect(sink.setStream).toHaveBeenCalledWith(mockStream);
    });
});
