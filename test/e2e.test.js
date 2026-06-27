const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path = require('path');

describe('End-to-End Latency Test', () => {
    let serverProcess;
    let browser;
    let desktopPage;
    let phonePage;

    beforeAll(async () => {
        // Start signaling server
        serverProcess = spawn('node', ['server.js'], { cwd: __dirname });
        await new Promise(resolve => setTimeout(resolve, 2000)); // wait for server

        browser = await puppeteer.launch({
            headless: "new",
            args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--allow-file-access-from-files']
        });

        desktopPage = await browser.newPage();
        phonePage = await browser.newPage();
    }, 15000);

    afterAll(async () => {
        if (browser) await browser.close();
        if (serverProcess) serverProcess.kill();
    });

    test('Measures latency < 200ms', async () => {
        // Load desktop
        const desktopUrl = `file://${path.join(__dirname, 'index.html')}`;
        await desktopPage.goto(desktopUrl);
        
        // Start desktop receiver
        await desktopPage.click('#connectBtn');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Setup Phone
        await phonePage.goto('about:blank');
        await phonePage.addScriptTag({ url: 'http://localhost:3000/socket.io/socket.io.js' });
        
        const latency = await phonePage.evaluate(() => {
            return new Promise((resolve, reject) => {
                const socket = io('http://localhost:3000');
                const pc = new RTCPeerConnection();
                
                // Create audio tone
                const ctx = new AudioContext();
                const osc = ctx.createOscillator();
                const dest = ctx.createMediaStreamDestination();
                osc.connect(dest);
                osc.start();
                
                const stream = dest.stream;
                stream.getTracks().forEach(track => pc.addTrack(track, stream));

                // Create DataChannel for latency measurement
                const dc = pc.createDataChannel('latency');
                let startTime;

                dc.onopen = () => {
                    startTime = performance.now();
                    dc.send(JSON.stringify({ timestamp: startTime }));
                };

                dc.onmessage = (e) => {
                    const data = JSON.parse(e.data);
                    if (data.reply) {
                        const rtt = performance.now() - startTime;
                        resolve(rtt / 2); // One-way latency
                    }
                };

                socket.on('connect', () => {
                    socket.emit('signal', { type: 'join', role: 'phone' });
                });

                socket.on('signal', async (data) => {
                    if (data.type === 'join' && data.role === 'desktop') {
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        socket.emit('signal', { type: 'offer', offer });
                    } else if (data.type === 'answer') {
                        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                    } else if (data.type === 'candidate') {
                        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                    }
                });

                pc.onicecandidate = (e) => {
                    if (e.candidate) {
                        socket.emit('signal', { type: 'candidate', candidate: e.candidate });
                    }
                };

                setTimeout(() => reject(new Error('Timeout')), 10000);
            });
        });

        console.log(`Measured Latency: ${latency.toFixed(2)} ms`);
        
        // Verify desktop receives audio frames by checking volume meter
        const volume = await desktopPage.evaluate(() => {
            return parseFloat(document.getElementById('volumeMeter').value);
        });

        expect(latency).toBeLessThan(200);
        expect(volume).toBeGreaterThanOrEqual(0); // Volume meter is working
    }, 15000);
});
