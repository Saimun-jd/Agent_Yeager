# Agent Yeager

Agent Yeager is a premium, mobile-first intelligence terminal web application for voice communication and AI assistants. It features a stunning, GPU-accelerated tactical HUD interface and real-time WebRTC audio streaming.

## Features

- **Tactical UI/UX:** Dark matte theme, 8-point grid, layered glassmorphism shadows, and an animated environmental background.
- **Push-to-Talk (PTT):** Hero interaction button featuring an animated CSS oscilloscope waveform.
- **Real-Time Audio:** Secure WebRTC streaming between devices.
- **Terminal Logs:** Authentic rolling terminal interface for system status and command override.
- **Progressive Web App (PWA):** Installs natively on mobile devices.

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm

### Installation
1. Clone the repository:
   ```bash
   git clone <your-repository-url>
   cd webrtc-audio-bridge
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the App
1. Start the server:
   ```bash
   node server.js
   ```
2. The server will run on `https://0.0.0.0:3000` (HTTPS is required for WebRTC microphone access).
3. Open `https://localhost:3000` on your desktop or `https://<YOUR_LOCAL_IP>:3000` on your mobile device. You will need to accept the self-signed certificate warning in your browser.

## Architecture

- `server.js`: Node.js Express server handling Socket.io signaling and static file serving.
- `mobile.html`: The mobile-first tactical terminal interface.
- `manifest.json` & `sw.js`: PWA configuration.
- `beatles_bg.jpg`: The background environment image.

## Customization

The tactical HUD relies on CSS variables defined in `mobile.html`. You can customize the look by adjusting the `:root` variables:
- `--accent`: Primary interaction color (default: `#FF003C`)
- `--success`: Online/Connected indicator (default: `#22C55E`)
- `--text-main`: Primary text color (default: `#EAEAEA`)

## Troubleshoot
if spotify mcp does not connect manually run 
```bash
node auth.js
```

## License
MIT License
