require('dotenv').config();
const caredeskConnector = require('../bridge/caredeskDirectConnector');

const TARGET_WS_URL = "wss://semivolatile-marcy-unfalsified.ngrok-free.dev/ws/audio?token=5afbe74c1f81c541e5232444560e488d7935bca2cce7e732";

async function testFullCareDeskE2E() {
    console.log("🌟 Starting Full End-to-End CareDesk Voice Bot-to-Bot Test...\n");

    caredeskConnector.on('turn', (t) => {
        console.log(`\n💬 [Turn ${t.turn}] ${t.senderName}: "${t.text}"`);
    });

    caredeskConnector.on('log', (l) => {
        if (l.level === 'error') console.error(`❌ [Error]: ${l.message}`);
    });

    try {
        await caredeskConnector.start(TARGET_WS_URL, {
            scenario: 'Booking',
            targetLanguage: 'English',
            patientName: 'Gokulakannan',
            maxTurns: 4
        });

        console.log("✅ WebSocket Handshake Established. Entering conversational loop...\n");

        // Wait up to 35 seconds for turns to complete
        await new Promise((resolve) => setTimeout(resolve, 35000));
        caredeskConnector.stop('E2E test window concluded');
    } catch (err) {
        console.error("Test failed:", err.message);
    } finally {
        console.log("\n🏁 CareDesk E2E Test finished.");
        process.exit(0);
    }
}

testFullCareDeskE2E();

