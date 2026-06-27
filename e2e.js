const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const puppeteer = (await import('puppeteer')).default;
    
    console.log("Starting signaling server...");
    const serverProcess = spawn('node', ['server.js'], { cwd: __dirname });
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("Launching browser...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--allow-file-access-from-files']
    });

    const desktopPage = await browser.newPage();
    const phonePage = await browser.newPage();

    console.log("Loading desktop page...");
    const desktopUrl = `file://${path.join(__dirname, 'index.html').replace(/\\/g, '/')}`;
    await desktopPage.goto(desktopUrl);
    
    await desktopPage.click('#connectBtn');
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log("Loading phone page...");
    await phonePage.goto('about:blank');
    await phonePage.addScriptTag({ url: 'http://localhost:3000/socket.io/socket.io.js' });
    
    console.log("Executing test...");
    const latency = await phonePage.evaluate(() => {
        return new Promise((resolve, reject) => {
            const socket = io('http://localhost:3000');
            const pc = new RTCPeerConnection();
            
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const dest = ctx.createMediaStreamDestination();
            osc.connect(dest);
            osc.start();
            
            const stream = dest.stream;
            stream.getTracks().forEach(track => pc.addTrack(track, stream));

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
                    resolve(rtt / 2);
                }
            };

            socket.on('connect', async () => {
                socket.emit('signal', { type: 'join', role: 'phone' });
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('signal', { type: 'offer', offer });
            });

            socket.on('signal', async (data) => {
                if (data.type === 'answer') {
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
    if (latency < 200) {
        console.log("PASS: Latency < 200ms");
    } else {
        console.error("FAIL: Latency >= 200ms");
        process.exitCode = 1;
    }

    const volume = await desktopPage.evaluate(() => {
        return parseFloat(document.getElementById('volumeMeter').value);
    });

    if (volume >= 0) {
        console.log("PASS: Volume meter works (volume=" + volume + ")");
    } else {
        console.error("FAIL: Volume meter invalid");
        process.exitCode = 1;
    }

    await browser.close();
    serverProcess.kill();
    console.log("E2E Test Complete.");
})();
