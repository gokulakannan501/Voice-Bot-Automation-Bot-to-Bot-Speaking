const caredeskConnector = require('../bridge/caredeskDirectConnector');

const TARGET_WS_URL = "wss://semivolatile-marcy-unfalsified.ngrok-free.dev/ws/audio?token=5afbe74c1f81c541e5232444560e488d7935bca2cce7e732";

async function runDirectVoiceTest() {
    console.log("🎙️ Testing Direct Bot-to-Bot Voice Conversation with CareDesk...");
    console.log(`   Target Bot: ${TARGET_WS_URL}\n`);

    caredeskConnector.on('log', (l) => {
        console.log(`[${l.level.toUpperCase()}] ${l.message}`);
    });

    try {
        await caredeskConnector.start(TARGET_WS_URL, {
            scenario: 'Booking',
            persona: 'Self',
            targetLanguage: 'English'
        });

        console.log("✅ Stream handshake complete. Listening for CareDesk voice & generating AI responses...");

        // Run for 30 seconds to allow 2-3 conversation turns
        await new Promise((resolve) => setTimeout(resolve, 30000));
        caredeskConnector.stop('Verification window ended');
    } catch (err) {
        console.error("❌ Test error:", err.message);
    } finally {
        process.exit(0);
    }
}

runDirectVoiceTest();

