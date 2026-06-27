const { MockAudioSink, VBCableAudioSink } = require('./audio');

describe('Audio Pipeline', () => {
    test('Audio frames are passed correctly', () => {
        const sink = new MockAudioSink();
        sink.initialize();
        
        const testBuffer = new Int16Array([1, 2, 3, 4]);
        sink.write(testBuffer);
        
        expect(sink.frames.length).toBe(1);
        expect(sink.frames[0]).toEqual(testBuffer);
    });

    test('Audio format conversion works', () => {
        // Test Int16 to Float32 logic. Since WebAudio is heavily tied to the DOM,
        // we'll mock the AudioContext to test VBCableAudioSink format conversion.
        
        const mockChannelData = new Float32Array(4);
        const mockAudioBuffer = {
            getChannelData: jest.fn(() => mockChannelData)
        };
        const mockSource = {
            buffer: null,
            connect: jest.fn(),
            start: jest.fn()
        };
        const mockAudioContext = {
            createMediaStreamDestination: jest.fn(() => ({ stream: {} })),
            createBuffer: jest.fn(() => mockAudioBuffer),
            createBufferSource: jest.fn(() => mockSource),
            close: jest.fn()
        };
        
        global.document = {
            createElement: jest.fn(() => ({
                srcObject: null,
                setSinkId: jest.fn(),
                play: jest.fn(),
                pause: jest.fn()
            }))
        };

        const sink = new VBCableAudioSink();
        sink.audioContext = mockAudioContext;
        sink.mediaStreamDestination = mockAudioContext.createMediaStreamDestination();
        
        const testBuffer = new Int16Array([0, 16384, 32767, -32768]);
        sink.write(testBuffer);
        
        expect(mockAudioContext.createBuffer).toHaveBeenCalledWith(1, 4, 48000);
        expect(mockChannelData[0]).toBeCloseTo(0);
        expect(mockChannelData[1]).toBeCloseTo(0.5);
        expect(mockChannelData[2]).toBeCloseTo(1.0, 4); // close to 1
        expect(mockChannelData[3]).toBeCloseTo(-1.0);
    });
});
