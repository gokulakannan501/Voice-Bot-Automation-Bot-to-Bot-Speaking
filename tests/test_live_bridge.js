const mockBots = require('../bridge/mockBots');
const botBridge = require('../bridge/botBridge');

const TARGET_WS_URL = "wss://semivolatile-marcy-unfalsified.ngrok-free.dev/ws/audio?token=5afbe74c1f81c541e5232444560e488d7935bca2cce7e732";

async function testLiveBridge() {
    console.log("🚀 Testing Bot-to-Bot Bridge with LIVE Target Bot WebSocket:");
    console.log(`   Bot A (Target): ${TARGET_WS_URL}`);
    console.log(`   Bot B (Tester): ws://localhost:5002\n`);

    // 1. Start Patient Tester Bot on 5002
    mockBots.start(5001, 5002);

    botBridge.on('log', (log) => {
        console.log(`[${log.level.toUpperCase()}] ${log.message}`);
    });

    botBridge.on('turn', (turn) => {
        console.log(`💬 Turn ${turn.turn} | ${turn.senderName} ➔ ${turn.recipientName}: "${turn.text}"`);
    });

    try {
        await botBridge.start({
            botAUrl: TARGET_WS_URL,
            botBUrl: 'ws://localhost:5002',
            mode: 'json',
            initiator: 'botB', // Let Patient Bot speak first to kick-off the conversation
            maxTurns: 6,
            nameA: 'Live Target Bot',
            nameB: 'AI Patient Tester'
        });

        console.log("✅ Bridge is actively running! Listening for 10 seconds...");

        await new Promise((resolve) => setTimeout(resolve, 10000));
        botBridge.stop('Test window concluded');
    } catch (err) {
        console.error("❌ Bridge session error:", err.message);
    } finally {
        mockBots.stop();
        process.exit(0);
    }
}

testLiveBridge();

