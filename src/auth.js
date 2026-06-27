const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { execSync } = require('child_process');

console.log("Starting Spotify authentication...");
try {
    execSync('npx -y spotify-mcp auth', { stdio: 'inherit', env: process.env });
} catch (e) {
    console.error("Auth failed:", e.message);
}
