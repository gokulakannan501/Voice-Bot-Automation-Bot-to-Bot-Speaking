const WebSocket = require('ws');

const TARGET_WS_URL = "wss://semivolatile-marcy-unfalsified.ngrok-free.dev/ws/audio?token=5afbe74c1f81c541e5232444560e488d7935bca2cce7e732";

console.log("🚀 Testing Valid Exotel AgentStream Handshake with CareDesk Target Bot...");

const ws = new WebSocket(TARGET_WS_URL);

const streamSid = "stream_" + Date.now();
const callSid = "call_" + Date.now();

ws.on('open', () => {
    console.log("✅ WebSocket Connected!");

    // 1. Send Exotel 'connected' event
    const connectedFrame = {
        event: "connected",
        protocol: "Call",
        version: "1.0.0"
    };
    console.log("📤 Sending 'connected' frame...");
    ws.send(JSON.stringify(connectedFrame));

    // 2. Send Exotel 'start' event with all required snake_case fields
    setTimeout(() => {
        const startFrame = {
            event: "start",
            sequence_number: "1",
            stream_sid: streamSid,
            start: {
                stream_sid: streamSid,
                account_sid: "AC_poc_test_account",
                call_sid: callSid,
                from: "+919876543210",
                to: "+918047360196",
                custom_parameters: {},
                media_format: {
                    encoding: "audio/x-l16",
                    sample_rate: 8000,
                    channels: 1
                }
            }
        };

        console.log("📤 Sending valid Exotel 'start' frame:", JSON.stringify(startFrame, null, 2));
        ws.send(JSON.stringify(startFrame));
    }, 200);

    // 3. Send 1 second of silent 8kHz 16-bit PCM (8000 samples/sec * 2 bytes = 16000 bytes/sec, so 320 bytes = 20ms)
    setTimeout(() => {
        console.log("📤 Sending 20ms silent audio frame...");
        const silenceChunk = Buffer.alloc(320); // 20ms silence
        const mediaFrame = {
            event: "media",
            sequence_number: "2",
            stream_sid: streamSid,
            media: {
                chunk: "1",
                timestamp: "20",
                payload: silenceChunk.toString('base64')
            }
        };
        ws.send(JSON.stringify(mediaFrame));
    }, 500);
});

ws.on('message', (data, isBinary) => {
    console.log(`\n📥 [CAREDESK REPLIED!] isBinary=${isBinary}, length=${data.length} bytes`);
    if (isBinary) {
        console.log("   Binary audio preview (hex):", data.slice(0, 32).toString('hex'));
    } else {
        const text = data.toString();
        try {
            const parsed = JSON.parse(text);
            console.log("   Event:", parsed.event);
            if (parsed.event === 'media') {
                const payloadLen = parsed.media?.payload?.length || 0;
                console.log(`   Media payload length: ${payloadLen} base64 chars (~${Math.round(payloadLen * 0.75)} bytes audio)`);
            } else {
                console.log("   Full JSON:", JSON.stringify(parsed, null, 2));
            }
        } catch {
            console.log("   Raw Text:", text.slice(0, 200));
        }
    }
});

ws.on('error', (err) => {
    console.error("❌ Socket error:", err.message);
});

ws.on('close', (code, reason) => {
    console.log(`🔌 Connection closed. Code: ${code}, Reason: "${reason.toString()}"`);
});

setTimeout(() => {
    console.log("\n⏱️ 10-second test completed. Closing...");
    ws.close();
    process.exit(0);
}, 10000);

