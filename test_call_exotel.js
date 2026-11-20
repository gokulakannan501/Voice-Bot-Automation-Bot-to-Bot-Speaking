require('dotenv').config();
const axios = require('axios');
const exotelService = require('./services/exotelService');

// Command Line Arguments passed from server.js
const requestedLanguage = process.argv[2] || 'English';
const persona = process.argv[3] || 'Self';
const scenario = process.argv[4] || 'Booking';

async function startExotelCall() {
    try {
        const targetBotNumber = process.argv[5] || process.env.TARGET_BOT_NUMBER;

        if (!targetBotNumber || targetBotNumber.includes('x')) {
            console.error("❌ ERROR: Target bot number is missing. Please enter the target phone number in the Dashboard UI or pass it as an argument (e.g. node test_call_exotel.js English Self Booking 08047360196)");
            return;
        }

        console.log(`\n🎧 Initiating Exotel Call to Target Bot => ${targetBotNumber}...`);
        console.log(`📡 Params: Language=${requestedLanguage}, Persona=${persona}, Scenario=${scenario}`);

        // 1. Detect public forwarding URL from local Ngrok if available
        let publicUrl = process.env.PUBLIC_URL;
        try {
            const ngrokRes = await axios.get("http://127.0.0.1:4040/api/tunnels", { timeout: 1500 });
            publicUrl = ngrokRes.data.tunnels[0].public_url;
            console.log(`🔗 Found active Ngrok Tunnel: ${publicUrl}`);
        } catch (err) {
            if (publicUrl) {
                console.log(`🔗 Using configured PUBLIC_URL from .env: ${publicUrl}`);
            } else {
                console.warn("⚠️ Warning: Could not detect Ngrok on port 4040 and PUBLIC_URL is empty. Continuing with defaults...");
            }
        }

        const statusCallback = publicUrl ? `${publicUrl.replace(/\/$/, '')}/exotel-call-status` : '';

        // 2. Instruct Exotel to dial the number and connect to our Voicebot App / Stream
        const call = await exotelService.initiateCall({
            to: targetBotNumber,
            callerId: process.env.EXOTEL_CALLER_ID,
            appId: process.env.EXOTEL_APP_ID,
            customParameters: {
                language: requestedLanguage,
                persona: persona,
                scenario: scenario
            },
            statusCallback: statusCallback
        });

        console.log("✅ Exotel call successfully initiated!");
        console.log(`Call SID: ${call.Sid || call.sid || 'Active'}\n`);
        console.log("Make sure your `node server.js` is running.");
        console.log("Exotel will now connect to the Voicebot WebSocket stream.\n");

    } catch (error) {
        console.error("❌ Failed to initiate Exotel call:", error.message);
    }
}

startExotelCall();
