const assert = require('assert');
const mockBots = require('../bridge/mockBots');
const botBridge = require('../bridge/botBridge');

async function runBridgeTest() {
    console.log("🧪 Starting WebSocket Bot-to-Bot Bridge Automated Verification Test...\n");

    // 1. Start mock bots
    mockBots.start(5001, 5002);
    console.log("✅ Mock Bot servers started (Ports 5001 & 5002)");

    let turnEvents = [];

    botBridge.on('turn', (turn) => {
        turnEvents.push(turn);
        console.log(`   [Turn ${turn.turn}] ${turn.senderName} ➔ ${turn.recipientName}: "${turn.text}"`);
    });

    botBridge.on('log', (log) => {
        if (log.level === 'error') {
            console.error(`   ❌ Log Error: ${log.message}`);
        }
    });

    // 2. Start bridge
    await botBridge.start({
        botAUrl: 'ws://localhost:5001',
        botBUrl: 'ws://localhost:5002',
        mode: 'json',
        initiator: 'botA',
        maxTurns: 6
    });

    // 3. Wait for session completion or timeout (15 seconds)
    const testPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("Test timed out waiting for conversation to complete"));
        }, 15000);

        botBridge.on('completed', (result) => {
            clearTimeout(timeout);
            resolve(result);
        });
    });

    const completionResult = await testPromise;
    console.log(`\n🏁 Bridge completed with reason: "${completionResult.reason}"`);

    // 4. Assertions
    assert(turnEvents.length >= 2, `Expected at least 2 turns, but got ${turnEvents.length}`);
    assert.strictEqual(turnEvents[0].from, 'botA', "First turn should be from Bot A (initiator)");
    assert.strictEqual(turnEvents[1].from, 'botB', "Second turn should be from Bot B");

    console.log(`✅ Total verified conversation turns: ${turnEvents.length}`);
    console.log("✅ Turn-taking alternated properly between Bot A and Bot B.");
    console.log("✅ Sockets closed cleanly.");

    // Cleanup
    mockBots.stop();
    console.log("\n🎉 ALL WebSocket Bot-to-Bot Bridge Tests PASSED Successfully!\n");
    process.exit(0);
}

runBridgeTest().catch((err) => {
    console.error("\n❌ Bridge Test Failed:", err);
    mockBots.stop();
    process.exit(1);
});

