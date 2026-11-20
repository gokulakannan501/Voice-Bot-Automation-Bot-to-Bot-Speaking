require('dotenv').config();
const WebSocket = require('ws');
const { WaveFile } = require('wavefile');
const sarvamService = require('../services/sarvamService');

const TARGET_WS_URL = "wss://semivolatile-marcy-unfalsified.ngrok-free.dev/ws/audio?token=5afbe74c1f81c541e5232444560e488d7935bca2cce7e732";

console.log("🚀 Testing CareDesk Voice Loop with Continuous Audio Clock...");

const ws = new WebSocket(TARGET_WS_URL);
const streamSid = "stream_" + Date.now();
const callSid = "call_" + Date.now();

let seq = 1;
let receivedAudioChunks = [];
let isCareDeskSpeaking = false;
let silenceTicker = null;

ws.on('open', () => {
    console.log("✅ WebSocket Connected!");

    // 1. Handshake
    ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));

    setTimeout(() => {
        ws.send(JSON.stringify({
            event: "start",
            sequence_number: String(seq++),
            stream_sid: streamSid,
            start: {
                stream_sid: streamSid,
                account_sid: "AC_caredesk_poc",
                call_sid: callSid,
                from: "+919876543210",
                to: "+918047360196",
                custom_parameters: {},
                media_format: { encoding: "audio/x-l16", sample_rate: 8000, channels: 1 }
            }
        }));

        console.log("📤 Sent 'start' frame. Starting audio clock (sending 20ms silence frames every 100ms)...");

        // Send 20ms silence frame every 100ms while listening
        silenceTicker = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN && !isCareDeskSpeaking) {
                const silence = Buffer.alloc(320); // 20ms @ 8kHz
                ws.send(JSON.stringify({
                    event: "media",
                    sequence_number: String(seq++),
                    stream_sid: streamSid,
                    media: {
                        chunk: String(seq),
                        timestamp: String(Date.now()),
                        payload: silence.toString('base64')
                    }
                }));
            }
        }, 100);
    }, 200);
});

ws.on('message', async (data) => {
    try {
        const parsed = JSON.parse(data.toString());
        if (parsed.event === 'media' && parsed.media?.payload) {
            isCareDeskSpeaking = true;
            const pcm = Buffer.from(parsed.media.payload, 'base64');
            receivedAudioChunks.push(pcm);
            process.stdout.write("🔊");
        } else if (parsed.event === 'mark') {
            console.log(`\n📍 [CareDesk Mark Received]: "${parsed.mark?.name}" (Finished speaking!)`);
            isCareDeskSpeaking = false;

            // Transcribe CareDesk's speech!
            if (receivedAudioChunks.length > 0) {
                const fullAudio = Buffer.concat(receivedAudioChunks);
                receivedAudioChunks = [];

                console.log(`\n🎙️ Transcribing ${fullAudio.length} bytes of CareDesk voice audio via Sarvam STT...`);
                try {
                    const wav = new WaveFile();
                    let aligned = fullAudio;
                    if (aligned.length % 2 !== 0) aligned = aligned.slice(0, aligned.length - 1);
                    const int16 = new Int16Array(aligned.buffer, aligned.byteOffset, aligned.length / 2);
                    wav.fromScratch(1, 8000, '16', int16);

                    const sttRes = await sarvamService.streamToText(wav.toBuffer(), 'English');
                    console.log(`\n🤖 [CAREDESK SPOKE]: "${sttRes.text}" (Language: ${sttRes.languageCode})`);

                    // Send patient response!
                    const patientReplyText = "Hello, I would like to book an appointment with Dr. Meena.";
                    console.log(`\n🧑 [AI PATIENT REPLIES]: "${patientReplyText}"`);
                    console.log(`   Synthesizing 8000 Hz PCM via Sarvam TTS...`);

                    const ttsWavBytes = await sarvamService.textToStream(patientReplyText, 'English', 'aditya');
                    const ttsWav = new WaveFile();
                    ttsWav.fromBuffer(ttsWavBytes);
                    if (ttsWav.fmt.sampleRate !== 8000) ttsWav.toSampleRate(8000);
                    if (ttsWav.fmt.bitsPerSample !== 16) ttsWav.toBitDepth('16');
                    const patientPcm = Buffer.from(ttsWav.data.samples);

                    console.log(`   Streaming ${patientPcm.length} bytes of patient voice to CareDesk...`);
                    // Stream in 3200-byte chunks
                    for (let i = 0; i < patientPcm.length; i += 3200) {
                        const chunk = patientPcm.slice(i, i + 3200);
                        ws.send(JSON.stringify({
                            event: "media",
                            sequence_number: String(seq++),
                            stream_sid: streamSid,
                            media: { payload: chunk.toString('base64') }
                        }));
                        await new Promise(r => setTimeout(r, 185));
                    }
                    console.log("   Finished streaming patient voice. Waiting for CareDesk response...");
                } catch (err) {
                    console.error("STT/TTS error:", err.message);
                }
            }
        }
    } catch {}
});

ws.on('close', (code, reason) => {
    if (silenceTicker) clearInterval(silenceTicker);
    console.log(`\n🔌 WebSocket Closed (${code}): ${reason}`);
    process.exit(0);
});

setTimeout(() => {
    if (silenceTicker) clearInterval(silenceTicker);
    console.log("\n⏱️ 25s test complete.");
    ws.close();
    process.exit(0);
}, 25000);
