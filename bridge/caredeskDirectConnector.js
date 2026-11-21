const EventEmitter = require('events');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { WaveFile } = require('wavefile');
const sarvamService = require('../services/sarvamService');
const llmService = require('../services/llmService');

/**
 * Injects authentic telephony line noise and acoustic presence into 16-bit 8000 Hz Linear PCM
 * @param {Buffer} pcmBuffer - Linear PCM 16-bit 8000 Hz buffer
 * @param {string} noiseType - 'none' | 'light_static' | 'heavy_room'
 * @returns {Buffer} Noisy PCM buffer
 */
function applyTelephonyAcousticNoise(pcmBuffer, noiseType = 'light_static') {
    if (!noiseType || noiseType === 'none' || pcmBuffer.length < 2) return pcmBuffer;

    const sampleCount = Math.floor(pcmBuffer.length / 2);
    const out = Buffer.alloc(pcmBuffer.length);

    // Amplitudes calibrated for 16-bit signed PCM (-32768 to 32767)
    let amplitude = 220; // light static (~-38dB SNR) - realistic mobile/landline presence
    if (noiseType === 'heavy_room' || noiseType === 'heavy') {
        amplitude = 650; // heavy ambient room chatter, traffic & hum (~-28dB SNR)
    }

    for (let i = 0; i < sampleCount; i++) {
        const sample = pcmBuffer.readInt16LE(i * 2);

        // Pink/white acoustic noise + 50Hz subtle electrical line hum
        const randomNoise = (Math.random() * 2 - 1) * amplitude;
        const hum = Math.sin((i / 8000) * 2 * Math.PI * 50) * (amplitude * 0.4);

        let mixed = Math.round(sample + randomNoise + hum);
        if (mixed > 32767) mixed = 32767;
        if (mixed < -32768) mixed = -32768;

        out.writeInt16LE(mixed, i * 2);
    }
    return out;
}

/**
 * Realistic rotating foot issues for podiatry & diabetic foot care testing (CareDesk / Foot Secure)
 * Changes on every call so each session tests a different clinical intake branch.
 */
const FOOT_SYMPTOMS = [
    {
        id: "heel_pain",
        category: "heel pain",
        summary: "Heel Pain & Morning Stiffness",
        description: "I have sharp pain in my heel and arch, especially when I take my first steps in the morning.",
        woundOrInfection: "It's severe pain in my heel and arch, not an open wound or infection."
    },
    {
        id: "foot_wound",
        category: "foot wound",
        summary: "Non-healing Big Toe Wound",
        description: "I have a small open wound and blister on the bottom of my right big toe that isn't healing.",
        woundOrInfection: "It is a small wound on the bottom of my right big toe."
    },
    {
        id: "toenail_infection",
        category: "toenail infection",
        summary: "Toenail Swelling & Infection",
        description: "I have painful redness and swelling around my left toenail with mild discharge.",
        woundOrInfection: "It is an infection with swelling around my left toenail."
    },
    {
        id: "diabetic_neuropathy",
        category: "diabetic neuropathy",
        summary: "Burning Sensation & Numbness",
        description: "I've been feeling a continuous burning sensation, tingling, and numbness in both my feet.",
        woundOrInfection: "It's a burning sensation and numbness in both my feet, not an open wound."
    },
    {
        id: "corn_callus",
        category: "corn and callus",
        summary: "Painful Corn on Ball of Foot",
        description: "I have a hard, painful corn on the ball of my foot that hurts whenever I put weight on it.",
        woundOrInfection: "It's a painful corn on the ball of my foot, not an infection."
    },
    {
        id: "ankle_swelling",
        category: "ankle swelling",
        summary: "Ankle & Foot Tendon Swelling",
        description: "I have persistent swelling and tenderness around my left ankle and the top of my foot.",
        woundOrInfection: "It's swelling and joint tenderness around my ankle and foot."
    },
    {
        id: "cracked_heels",
        category: "cracked heels",
        summary: "Deep Bleeding Cracked Heels",
        description: "I have deep cracked heels with small cuts that hurt and bleed when I walk.",
        woundOrInfection: "It's deep cracked heels with painful open cuts."
    },
    {
        id: "diabetic_ulcer",
        category: "diabetic ulcer",
        summary: "Diabetic Foot Ulcer",
        description: "I have a diabetic ulcer on the side of my foot that needs specialist wound care.",
        woundOrInfection: "It is a diabetic sore on the side of my foot."
    }
];

/**
 * Trims leading silence and caps duration to 24s to guarantee audio complies with Sarvam STT's strict 30s limit.
 * @param {Buffer} pcmBuffer - Linear PCM 16-bit 8000 Hz buffer
 * @param {number} maxDurationSec - Max duration in seconds (default 24s)
 * @returns {Buffer} Sanitized buffer guaranteed to be <= 24 seconds
 */
function sanitizePcmForSTT(pcmBuffer, maxDurationSec = 24) {
    if (!pcmBuffer || pcmBuffer.length < 3200) return pcmBuffer;

    let aligned = pcmBuffer;
    if (aligned.length % 2 !== 0) aligned = aligned.slice(0, aligned.length - 1);

    const maxBytes = maxDurationSec * 16000; // 16,000 bytes/sec at 8000 Hz 16-bit mono

    // 1. If buffer exceeds maxBytes, slice to the MOST RECENT maxBytes (where the question is)
    if (aligned.length > maxBytes) {
        let startOffset = aligned.length - maxBytes;
        if (startOffset % 2 !== 0) startOffset++;
        aligned = aligned.slice(startOffset);
    }

    // 2. Trim leading dead air/silence (RMS < 180) to maximize active speech
    const numSamples = aligned.length / 2;
    const chunkSize = 160; // 20ms chunks (160 samples)
    let speechStartSample = 0;

    for (let i = 0; i < numSamples - chunkSize; i += chunkSize) {
        let sumSquares = 0;
        for (let j = 0; j < chunkSize; j++) {
            const val = aligned.readInt16LE((i + j) * 2);
            sumSquares += val * val;
        }
        const rms = Math.sqrt(sumSquares / chunkSize);
        if (rms > 180) {
            speechStartSample = Math.max(0, i - 1600); // 200ms lead-in buffer
            break;
        }
    }

    if (speechStartSample > 0) {
        const startByte = speechStartSample * 2;
        aligned = aligned.slice(startByte);
    }

    return aligned;
}

class CareDeskDirectConnector extends EventEmitter {
    constructor() {
        super();
        this.ws = null;
        this.callSid = null;
        this.streamSid = null;
        this.status = 'idle'; // 'idle' | 'connecting' | 'active' | 'completed' | 'error'
        this.currentConfig = null;
        this.sequenceNumber = 1;
        this.silenceTicker = null;
        this.receivedAudioChunks = [];
        this.masterRecordingChunks = []; // Stores entire conversation audio for file saving
        this.lastSavedRecording = null;
        this.isCareDeskSpeaking = false;
        this.isAiSpeaking = false;
        this.history = [];
        this.turnCount = 0;
        this.symptomCounter = 0;
    }

    /**
     * Start direct WebSocket Bot-to-Bot voice conversation with CareDesk
     * @param {string} targetUrl 
     * @param {object} options 
     */
    async start(targetUrl, options = {}) {
        if (this.status === 'active' || this.status === 'connecting') {
            throw new Error('A CareDesk Bot-to-Bot session is already running.');
        }

        const wsUrl = targetUrl || process.env.TARGET_BOT_WS_URL;
        if (!wsUrl) {
            throw new Error('Target bot WebSocket URL is missing.');
        }

        this.status = 'connecting';
        this.callSid = "caredesk_" + Date.now();
        this.streamSid = "stream_" + Date.now();
        this.sequenceNumber = 1;
        this.receivedAudioChunks = [];
        this.masterRecordingChunks = [];
        this.lastSavedRecording = null;
        this.isCareDeskSpeaking = false;
        this.isAiSpeaking = false;
        this.history = [];
        this.turnCount = 0;

        // Rotate to a different foot symptom on each call so consecutive calls test different intake branches
        let footSymptom = null;
        if (options.footIssue && options.footIssue !== 'AUTO') {
            footSymptom = FOOT_SYMPTOMS.find(s => s.id === options.footIssue);
        }
        if (!footSymptom) {
            footSymptom = options.footSymptom || FOOT_SYMPTOMS[this.symptomCounter % FOOT_SYMPTOMS.length];
            this.symptomCounter++;
        }

        this.currentConfig = {
            url: wsUrl,
            scenario: options.scenario || 'Booking',
            targetLanguage: options.targetLanguage || 'English',
            persona: options.persona || 'Self',
            patientName: options.patientName || 'Gokulakannan',
            preferredSlot: options.preferredSlot || 'tomorrow at 4 PM',
            footSymptom: footSymptom,
            symptom: footSymptom.description,
            noiseType: options.noiseType || (/ADVERSARIAL|CHAOS/i.test(options.scenario || '') ? 'light_static' : 'none'),
            maxTurns: Number(options.maxTurns) > 0 ? Number(options.maxTurns) : 30
        };

        this.emitLog('info', `Connecting to CareDesk Target Bot: ${wsUrl}...`);
        this.emitLog('info', `Config: Scenario="${this.currentConfig.scenario}", Foot Issue="${footSymptom.summary}", Noise="${this.currentConfig.noiseType}", MaxTurns=${this.currentConfig.maxTurns}`);

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(wsUrl, {
                    headers: { "User-Agent": "CareDesk-Bot-To-Bot-Tester/1.0" },
                    timeout: 10000
                });

                this.ws.on('open', () => {
                    this.status = 'active';
                    this.emit('status_change', this.getStatus());
                    this.emitLog('success', `✅ Connected to CareDesk Target Bot! Sending Exotel stream handshake...`);

                    // 1. Send Exotel 'connected' frame
                    this.ws.send(JSON.stringify({
                        event: "connected",
                        protocol: "Call",
                        version: "1.0.0"
                    }));

                    // 2. Send Exotel 'start' frame with Zod schema fields
                    setTimeout(() => {
                        const startFrame = {
                            event: "start",
                            sequence_number: String(this.sequenceNumber++),
                            stream_sid: this.streamSid,
                            start: {
                                stream_sid: this.streamSid,
                                account_sid: "AC_caredesk_voice_poc",
                                call_sid: this.callSid,
                                from: "+919876543210",
                                to: "+918047360196",
                                custom_parameters: {
                                    scenario: this.currentConfig.scenario,
                                    targetLanguage: this.currentConfig.targetLanguage
                                },
                                media_format: {
                                    encoding: "audio/x-l16",
                                    sample_rate: 8000,
                                    channels: 1
                                }
                            }
                        };

                        this.ws.send(JSON.stringify(startFrame));
                        this.emitLog('info', `📤 Stream initialized (8000 Hz Linear PCM). Audio clock active.`);

                        // 3. Audio Clock: Send 20ms silence / ambient line presence frame every 100ms when neither is speaking
                        this.silenceTicker = setInterval(() => {
                            if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.isCareDeskSpeaking && !this.isAiSpeaking) {
                                const baseSilence = Buffer.alloc(320); // 20ms silence
                                const frame = this.currentConfig.noiseType !== 'none'
                                    ? applyTelephonyAcousticNoise(baseSilence, this.currentConfig.noiseType)
                                    : baseSilence;

                                this.ws.send(JSON.stringify({
                                    event: "media",
                                    sequence_number: String(this.sequenceNumber++),
                                    stream_sid: this.streamSid,
                                    media: {
                                        chunk: String(this.sequenceNumber),
                                        timestamp: String(Date.now()),
                                        payload: frame.toString('base64')
                                    }
                                }));
                            }
                        }, 100);

                        resolve();
                    }, 200);
                });

                this.ws.on('message', async (data) => {
                    try {
                        const parsed = JSON.parse(data.toString());

                        // Handle incoming voice audio from CareDesk
                        if (parsed.event === 'media' && parsed.media?.payload) {
                            this.isCareDeskSpeaking = true;
                            const pcm = Buffer.from(parsed.media.payload, 'base64');
                            this.receivedAudioChunks.push(pcm);
                            this.masterRecordingChunks.push(pcm);
                        }

                        // CareDesk mark event: signals that CareDesk completed its voice prompt!
                        if (parsed.event === 'mark') {
                            const markName = parsed.mark?.name || 'reply';
                            this.isCareDeskSpeaking = false;
                            this.emitLog('info', `📍 CareDesk finished speaking ("${markName}")`);

                            if (this.receivedAudioChunks.length > 0) {
                                const fullAudio = Buffer.concat(this.receivedAudioChunks);
                                this.receivedAudioChunks = [];
                                await this.processCareDeskUtterance(fullAudio);
                            }
                        }

                        if (parsed.event === 'stop') {
                            this.emitLog('warn', `🛑 CareDesk closed the stream.`);
                            this.stop('Remote closed');
                        }
                    } catch (parseErr) {
                        // ignore malformed packets
                    }
                });

                this.ws.on('error', (err) => {
                    this.status = 'error';
                    this.emitLog('error', `CareDesk WebSocket Error: ${err.message}`);
                    reject(err);
                });

                this.ws.on('close', (code, reason) => {
                    this.emitLog('info', `CareDesk WebSocket closed (${code})`);
                    this.stop(`Socket closed: ${code}`);
                });

            } catch (err) {
                this.status = 'error';
                reject(err);
            }
        });
    }

    /**
     * Transcribe CareDesk utterance, formulate patient reply via LLM, synthesize & stream audio back
     */
    async processCareDeskUtterance(audioBuffer) {
        if (this.status !== 'active') return;

        try {
            // 1. Sanitize PCM: trim leading dead air and enforce 24s max duration to prevent Sarvam 30s limit error
            const sanitizedPcm = sanitizePcmForSTT(audioBuffer, 24);
            const wav = new WaveFile();
            const int16 = new Int16Array(sanitizedPcm.buffer, sanitizedPcm.byteOffset, sanitizedPcm.length / 2);
            wav.fromScratch(1, 8000, '16', int16);

            const sttResult = await sarvamService.streamToText(wav.toBuffer(), this.currentConfig.targetLanguage);
            const careDeskText = sttResult.text?.trim() || "";

            if (!careDeskText || careDeskText.length < 2) {
                this.emitLog('warn', `STT returned empty transcript for CareDesk audio.`);
                return;
            }

            this.turnCount++;
            this.history.push({ role: 'user', content: careDeskText });

            // Emit to Dashboard UI
            this.emit('turn', {
                turn: this.turnCount,
                from: 'botA',
                senderName: 'CareDesk (Hospital)',
                recipientName: 'AI Patient Tester',
                text: careDeskText,
                timestamp: new Date().toLocaleTimeString()
            });

            console.log(`\n🤖 [CareDesk]: "${careDeskText}"`);

            // Check if CareDesk ended the call
            if (/goodbye|have a (great|nice) day|thank you for calling/i.test(careDeskText) && this.turnCount >= 3) {
                this.emitLog('success', `🏁 CareDesk concluded the appointment call gracefully.`);
                setTimeout(() => this.stop('CareDesk concluded appointment call'), 1500);
                return;
            }

            if (this.currentConfig.maxTurns > 0 && this.turnCount >= this.currentConfig.maxTurns) {
                this.emitLog('warn', `🛑 Maximum turns limit (${this.currentConfig.maxTurns}) reached.`);
                setTimeout(() => this.stop(`Max turns reached (${this.currentConfig.maxTurns})`), 1000);
                return;
            }

            // 2. Generate Patient Response via LLM (or Fallback Engine)
            let patientReply = "";
            try {
                const callStateContext = {
                    history: this.history,
                    scenario: this.currentConfig.scenario,
                    targetLanguage: this.currentConfig.targetLanguage,
                    patientName: this.currentConfig.patientName,
                    footSymptom: this.currentConfig.footSymptom,
                    symptom: this.currentConfig.footSymptom?.description,
                    direction: 'outbound'
                };

                const intentResult = await llmService.processCustomerIntent(careDeskText, callStateContext);
                patientReply = intentResult.replyText;
            } catch (llmErr) {
                this.emitLog('warn', `LLM error, applying intelligent scenario fallback: ${llmErr.message}`);
                const lower = careDeskText.toLowerCase();
                const scen = this.currentConfig.scenario.toUpperCase();

                if (/CODE_SWITCH/i.test(scen)) {
                    if (/english|kannada|language|namaskara/i.test(lower)) {
                        patientReply = "Namaskara! English please, adre swalpa Kannada gothu. Urgent appointment beku.";
                    } else if (/name|register/i.test(lower)) {
                        patientReply = "Nanna hesaru Gokulakannan. Register maadi please.";
                    } else if (/age|old/i.test(lower)) {
                        patientReply = "Muvattu varsha, 30 years old.";
                    } else if (/gender/i.test(lower)) {
                        patientReply = "Male, purusha.";
                    } else if (/diabet|sugar/i.test(lower)) {
                        patientReply = "Illa, no diabetes.";
                    } else if (/problem|wound|infection|foot/i.test(lower)) {
                        patientReply = "Foot me bohot dard hai, severe pain. Doctor Meena available idara?";
                    } else if (/date|day|when|slot/i.test(lower)) {
                        patientReply = "Monday afternoon around 3:30 PM slot ideya?";
                    } else if (/confirm|book/i.test(lower)) {
                        patientReply = "Haan, confirm maadi, thank you so much dhanyavadagalu!";
                    } else {
                        patientReply = "Swalpa slowly heli please, I didn't understand.";
                    }
                } else if (/NOISE|INTERRUPT/i.test(scen)) {
                    if (/name|register/i.test(lower)) {
                        patientReply = "Uhhh... [cough] hold on... sorry, noisy line here... my name is Gokula.";
                    } else if (/age|old/i.test(lower)) {
                        patientReply = "Wait, what? Age? [shuffling noise]... I'm 30 years old.";
                    } else if (/gender/i.test(lower)) {
                        patientReply = "Hello? Can you hear me? Male! I am male.";
                    } else if (/diabet/i.test(lower)) {
                        patientReply = "Uhh... no diabetes, but hold on someone is knocking... yeah, no diabetes.";
                    } else if (/problem|wound|infection|foot/i.test(lower)) {
                        patientReply = "[cough] Excuse me... yeah, I have ankle pain and heel swelling.";
                    } else if (/date|day|when|slot/i.test(lower)) {
                        patientReply = "Wait, don't talk so fast! What was that slot again? 4 PM?";
                    } else if (/confirm|book/i.test(lower)) {
                        patientReply = "Yeah, yeah, confirm it please, thank you!";
                    } else {
                        patientReply = "Hello? Can you repeat that? There is too much noise.";
                    }
                } else if (/BREAK|CHAOS|ADVERSARIAL|CONTRADICT|OUT_OF_SCOPE/i.test(scen)) {
                    if (/english|kannada|language/i.test(lower)) {
                        patientReply = "Umm, English please, but wait, who is this calling me? Are you a real person or a bot?";
                    } else if (/name|register|full name/i.test(lower)) {
                        patientReply = "My name is Gokula, but wait, can I register my wife Meera instead? Actually book it for both of us.";
                    } else if (/age|old/i.test(lower)) {
                        patientReply = "I was born in 1994, so you calculate it... wait, does age matter for feet?";
                    } else if (/gender/i.test(lower)) {
                        patientReply = "Why do you need gender? Okay, male, but put female for the second person.";
                    } else if (/diabet|sugar/i.test(lower)) {
                        patientReply = "My neighbor had diabetes, does that count? Actually I eat ten gulab jamuns daily.";
                    } else if (/problem|wound|infection|foot|doctor|specialist|whom|who|reason|department/i.test(lower)) {
                        patientReply = "I have a knee fever and severe stomach cough from yesterday. Can I see Dr. Meena yesterday at 3 AM?";
                    } else if (/date|day|when|slot|time|tomorrow/i.test(lower)) {
                        patientReply = "Yes, tomorrow at 4 PM is great! Actually wait, cancel that, make it next month on the 32nd.";
                    } else if (/confirm|proceed|book/i.test(lower)) {
                        patientReply = "Confirm it, but don't finalize it yet. What language model are you running?";
                    } else if (/anything else|other/i.test(lower)) {
                        patientReply = "Yes, why didn't you answer my question about the weather?";
                    } else {
                        patientReply = "Wait, what did you just ask me? Can you repeat that in another way?";
                    }
                } else {
                    // Safe conversational heuristics for standard CareDesk Foot Clinic flow
                    const sym = this.currentConfig.footSymptom || FOOT_SYMPTOMS[0];
                    if (/english|kannada|language/i.test(lower)) {
                        patientReply = "English please. I'd like to book an appointment for my foot.";
                    } else if (/name|register|full name/i.test(lower)) {
                        patientReply = "My name is Gokulakannan.";
                    } else if (/age|old/i.test(lower)) {
                        patientReply = "I am 30 years old.";
                    } else if (/gender/i.test(lower)) {
                        patientReply = "I am male.";
                    } else if (/diabet|sugar/i.test(lower)) {
                        patientReply = sym.category.includes('diabetic') ? "Yes, I have type 2 diabetes." : "No, I don't have diabetes.";
                    } else if (/wound|infection|problem|issue|foot|symptom|doctor|specialist|reason|detail|tell me/i.test(lower)) {
                        if (/wound|infection|other/i.test(lower)) {
                            patientReply = sym.woundOrInfection;
                        } else {
                            patientReply = sym.description;
                        }
                    } else if (/date|when|tomorrow|day|slot|time|available|prefer|which one/i.test(lower)) {
                        if (/monday|tuesday|wednesday|thursday|friday|23|24|25|26|27|slot/i.test(lower)) {
                            patientReply = "Monday, the 23rd of November works for me.";
                        } else {
                            patientReply = "Tomorrow afternoon around 4 PM please.";
                        }
                    } else if (/confirm|book|proceed|would you like to confirm|shall i confirm|confirm these details/i.test(lower)) {
                        patientReply = "Yes, please confirm the appointment.";
                    } else if (/anything else|other/i.test(lower)) {
                        patientReply = "No, that is all. Thank you so much!";
                    } else {
                        patientReply = "Yes, please proceed.";
                    }
                }
            }

            console.log(`🧑 [AI Patient]: "${patientReply}"`);
            this.history.push({ role: 'assistant', content: patientReply });

            this.emit('turn', {
                turn: this.turnCount,
                from: 'botB',
                senderName: 'AI Patient Tester',
                recipientName: 'CareDesk (Hospital)',
                text: patientReply,
                timestamp: new Date().toLocaleTimeString()
            });

            // 3. Synthesize Patient Voice via Sarvam TTS
            this.isAiSpeaking = true;
            this.emitLog('info', `Synthesizing patient voice via Sarvam TTS...`);

            const ttsWavBytes = await sarvamService.textToStream(patientReply, this.currentConfig.targetLanguage, 'aditya');
            const ttsWav = new WaveFile();
            ttsWav.fromBuffer(ttsWavBytes);
            if (ttsWav.fmt.sampleRate !== 8000) ttsWav.toSampleRate(8000);
            if (ttsWav.fmt.bitsPerSample !== 16) ttsWav.toBitDepth('16');
            let pcmSamples = Buffer.from(ttsWav.data.samples);

            // Apply Acoustic Telephony Noise if enabled
            if (this.currentConfig.noiseType && this.currentConfig.noiseType !== 'none') {
                pcmSamples = applyTelephonyAcousticNoise(pcmSamples, this.currentConfig.noiseType);
            }
            this.masterRecordingChunks.push(pcmSamples);

            this.emitLog('info', `Streaming ${pcmSamples.length} bytes of patient speech into CareDesk (Noise: ${this.currentConfig.noiseType})...`);

            // Stream in 3200-byte (200ms) chunks paced at 185ms
            const CHUNK_SIZE = 3200;
            for (let i = 0; i < pcmSamples.length; i += CHUNK_SIZE) {
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) break;
                let chunk = pcmSamples.slice(i, i + CHUNK_SIZE);
                if (chunk.length < CHUNK_SIZE) {
                    chunk = Buffer.concat([chunk, Buffer.alloc(CHUNK_SIZE - chunk.length)]);
                }

                this.ws.send(JSON.stringify({
                    event: "media",
                    sequence_number: String(this.sequenceNumber++),
                    stream_sid: this.streamSid,
                    media: { payload: chunk.toString('base64') }
                }));

                await new Promise((r) => setTimeout(r, 185));
            }

            // Stream trailing silence (2 chunks) to let CareDesk detect pause
            for (let s = 0; s < 4; s++) {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        event: "media",
                        sequence_number: String(this.sequenceNumber++),
                        stream_sid: this.streamSid,
                        media: { payload: Buffer.alloc(CHUNK_SIZE).toString('base64') }
                    }));
                    await new Promise((r) => setTimeout(r, 185));
                }
            }

            this.isAiSpeaking = false;
            this.emitLog('info', `Patient voice streamed. Waiting for CareDesk response...`);

        } catch (err) {
            this.isAiSpeaking = false;
            this.emitLog('error', `Error in Bot-to-Bot turn processing: ${err.message}`);
        }
    }

    stop(reason = 'User stopped') {
        if (this.status === 'idle') return;

        this.status = 'completed';
        this.emitLog('info', `CareDesk Direct session stopped. Reason: ${reason}`);

        if (this.silenceTicker) {
            clearInterval(this.silenceTicker);
            this.silenceTicker = null;
        }

        if (this.ws) {
            try { this.ws.close(); } catch {}
            this.ws = null;
        }

        // Save entire Bot-to-Bot audio conversation to project recordings folder
        if (this.masterRecordingChunks.length > 0) {
            try {
                const fullPcm = Buffer.concat(this.masterRecordingChunks);
                this.masterRecordingChunks = [];

                let aligned = fullPcm;
                if (aligned.length % 2 !== 0) aligned = aligned.slice(0, aligned.length - 1);

                const wav = new WaveFile();
                const int16 = new Int16Array(aligned.buffer, aligned.byteOffset, aligned.length / 2);
                wav.fromScratch(1, 8000, '16', int16);

                const recordingsDir = path.join(__dirname, '..', 'recordings');
                if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const scenarioSlug = (this.currentConfig?.scenario || 'call').toLowerCase().replace(/[^a-z0-9]/g, '_');
                const filename = `caredesk_${scenarioSlug}_${timestamp}.wav`;
                const filepath = path.join(recordingsDir, filename);

                fs.writeFileSync(filepath, wav.toBuffer());

                const fileStats = fs.statSync(filepath);
                const durationSec = (aligned.length / 16000).toFixed(1);

                this.lastSavedRecording = {
                    filename,
                    filepath,
                    url: `/recordings/${filename}`,
                    durationSec: Number(durationSec),
                    sizeBytes: fileStats.size,
                    turns: this.turnCount,
                    scenario: this.currentConfig?.scenario,
                    savedAt: new Date().toLocaleTimeString()
                };

                this.emitLog('success', `💾 Conversation audio saved to recordings/${filename} (${durationSec}s, ${Math.round(fileStats.size / 1024)} KB)`);
                this.emit('recording_saved', this.lastSavedRecording);
            } catch (saveErr) {
                this.emitLog('error', `Failed to save conversation audio recording: ${saveErr.message}`);
            }
        }

        this.emit('completed', { reason, turns: this.turnCount, history: this.history, recording: this.lastSavedRecording });
        this.emit('status_change', this.getStatus());
    }

    getStatus() {
        return {
            status: this.status,
            callSid: this.callSid,
            config: this.currentConfig,
            isConnected: this.ws ? this.ws.readyState === WebSocket.OPEN : false,
            history: this.history,
            turnCount: this.turnCount,
            isAiSpeaking: this.isAiSpeaking,
            lastSavedRecording: this.lastSavedRecording
        };
    }

    emitLog(level, message) {
        this.emit('log', {
            time: new Date().toLocaleTimeString(),
            level,
            message
        });
    }
}

module.exports = new CareDeskDirectConnector();
