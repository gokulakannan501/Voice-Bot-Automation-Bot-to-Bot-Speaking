const WebSocket = require('ws');

const TARGET_WS_URL = "wss://semivolatile-marcy-unfalsified.ngrok-free.dev/ws/audio?token=5afbe74c1f81c541e5232444560e488d7935bca2cce7e732";

const ws = new WebSocket(TARGET_WS_URL);

ws.on('open', () => {
    console.log("✅ [CONNECTED] Sending handshake tests...");

    // Test 1: Send a start frame
    const startPayload = JSON.stringify({
        event: "start",
        streamSid: "probe_" + Date.now(),
        start: {
            streamSid: "probe_" + Date.now(),
            mediaFormat: {
                encoding: "audio/x-mulaw",
                sampleRate: 8000,
                channels: 1
            }
        }
    });

    console.log("📤 Sending start frame:", startPayload);
    ws.send(startPayload);

    // After 1s, send test raw audio chunk (320 bytes silence PCM)
    setTimeout(() => {
        console.log("📤 Sending 320 bytes raw PCM chunk...");
        const silenceChunk = Buffer.alloc(320);
        ws.send(silenceChunk);
    }, 1000);

    // After 2s, send a media JSON frame
    setTimeout(() => {
        console.log("📤 Sending media JSON frame...");
        const mediaPayload = JSON.stringify({
            event: "media",
            media: {
                payload: Buffer.alloc(160).toString('base64')
            }
        });
        ws.send(mediaPayload);
    }, 2000);
});

ws.on('message', (data, isBinary) => {
    console.log(`\n📥 [TARGET BOT REPLIED!] isBinary=${isBinary}, length=${data.length}`);
    if (isBinary) {
        console.log(`   Binary data preview: ${data.slice(0, 32).toString('hex')}`);
    } else {
        console.log(`   Text data: ${data.toString()}`);
    }
});

ws.on('error', (err) => {
    console.error("❌ Socket error:", err.message);
});

ws.on('close', (code, reason) => {
    console.log(`🔌 Closed. Code: ${code}, Reason: "${reason.toString()}"`);
});

setTimeout(() => {
    console.log("Finished 6s test.");
    ws.close();
    process.exit(0);
}, 6000);

