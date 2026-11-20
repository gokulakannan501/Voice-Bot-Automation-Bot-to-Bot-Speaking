const WebSocket = require('ws');

const TARGET_WS_URL = "wss://semivolatile-marcy-unfalsified.ngrok-free.dev/ws/audio?token=5afbe74c1f81c541e5232444560e488d7935bca2cce7e732";

console.log("🔍 Probing Target Bot WebSocket:");
console.log(TARGET_WS_URL);

const ws = new WebSocket(TARGET_WS_URL, {
    headers: {
        "User-Agent": "Bot-To-Bot-Probe/1.0"
    },
    timeout: 8000
});

ws.on('open', () => {
    console.log("✅ [TARGET WS OPEN] Successfully connected to Target Bot WebSocket!");
});

ws.on('message', (data, isBinary) => {
    console.log(`\n📥 [TARGET WS INCOMING MESSAGE] isBinary=${isBinary}, length=${data.length} bytes`);
    if (isBinary) {
        console.log(`   Binary chunk preview (hex): ${data.slice(0, 32).toString('hex')}`);
    } else {
        const text = data.toString();
        console.log(`   Text payload (first 300 chars): ${text.slice(0, 300)}`);
        try {
            const parsed = JSON.parse(text);
            console.log("   Parsed JSON keys:", Object.keys(parsed));
            console.log("   Full JSON:", JSON.stringify(parsed, null, 2));
        } catch {
            console.log("   Not JSON (raw text)");
        }
    }
});

ws.on('error', (err) => {
    console.error("❌ [TARGET WS ERROR]:", err.message);
});

ws.on('close', (code, reason) => {
    console.log(`🔌 [TARGET WS CLOSED] Code: ${code}, Reason: "${reason.toString()}"`);
    process.exit(0);
});

// Auto-close after 8 seconds of listening
setTimeout(() => {
    console.log("\n⏱️ Probe listening window (8s) finished. Closing connection...");
    ws.close();
    process.exit(0);
}, 8000);

