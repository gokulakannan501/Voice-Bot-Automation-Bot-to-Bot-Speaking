require('dotenv').config();
const caredeskConnector = require('../bridge/caredeskDirectConnector');
const fs = require('fs');
const path = require('path');

const TARGET_WS_URL = "wss://semivolatile-marcy-unfalsified.ngrok-free.dev/ws/audio?token=5afbe74c1f81c541e5232444560e488d7935bca2cce7e732";

async function runAdversarialTest() {
    console.log("💥 Starting ADVERSARIAL Stress-Test (Chaos Mode: Break the Bot)...\n");

    caredeskConnector.on('turn', (t) => {
        console.log(`\n💬 [Turn ${t.turn}] ${t.senderName}: "${t.text}"`);
    });

    caredeskConnector.on('recording_saved', (rec) => {
        console.log(`\n💾 [RECORDING VERIFIED]: Saved ${rec.filename} (${rec.durationSec}s, ${rec.sizeBytes} bytes)`);
    });

    try {
        await caredeskConnector.start(TARGET_WS_URL, {
            scenario: 'ADVERSARIAL_BREAK_BOT',
            targetLanguage: 'English',
            patientName: 'Gokulakannan',
            maxTurns: 3
        });

        console.log("✅ WebSocket Connected! Running chaos test for 32 seconds...\n");
        await new Promise((resolve) => setTimeout(resolve, 32000));
        caredeskConnector.stop('Chaos test concluded');
    } catch (err) {
        console.error("Test error:", err.message);
    } finally {
        // Verify recordings folder
        const recDir = path.join(__dirname, '..', 'recordings');
        const files = fs.readdirSync(recDir).filter(f => f.endsWith('.wav'));
        console.log(`\n📁 Files in recordings directory:`, files);
        process.exit(0);
    }
}

runAdversarialTest();

