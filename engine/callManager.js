const llmService = require('../services/llmService');
const sarvamService = require('../services/sarvamService');
const { WaveFile } = require('wavefile');

class CallManager {
    constructor() {
        // activeCalls will hold conversational context for each Exotel Call SID
        this.activeCalls = new Map();
        this.watchdogTimers = new Map();       // Dedicated map for watchdog timer handles to prevent orphan timeouts
        this.manualOverrideResponse = null;
        this.latestReceivedOTP = null;         // Stores the last OTP injected via dashboard

        // Default Inbound Call Configuration (Patient answering hospital bot)
        this.inboundConfig = {
            scenario: 'INBOUND_CONFIRM', // 'INBOUND_CONFIRM' | 'INBOUND_RESCHEDULE' | 'INBOUND_CANCEL' | 'INBOUND_NO_ANSWER' | 'INBOUND_CUT_CALL'
            patientName: 'Gokulakannan',
            preferredSlot: 'Tomorrow at 4 PM',
            language: 'English'
        };
    }

    /**
     * Initializes a new call session
     * @param {string} callSid - Unique ID for the call
     * @param {WebSocket} ws - The active socket connection
     * @param {object} params - Custom parameters from Exotel (e.g. targetLanguage)
     */
    startCall(callSid, ws, params = {}) {
        const direction = params.direction || (params.scenario && !params.scenario.startsWith('INBOUND') ? 'outbound' : 'inbound');
        const scenario = params.scenario || (direction === 'inbound' ? this.inboundConfig.scenario : 'Booking');
        const targetLanguage = params.targetLanguage || (direction === 'inbound' ? this.inboundConfig.language : 'English');
        const persona = params.persona || 'Self';

        // Reset override for new call start
        this.manualOverrideResponse = null;

        // Clean up any stale active calls to avoid concurrent stream collisions
        for (const [existingSid] of this.activeCalls.entries()) {
            if (existingSid !== callSid) {
                console.log(`🧹 [Call Manager] Terminating concurrent stale call ${existingSid} to avoid stream collision.`);
                this.endCall(existingSid);
            }
        }

        console.log(`[Call Manager] Starting ${direction.toUpperCase()} Call session: ${callSid} | Scenario: ${scenario} | Lang: ${targetLanguage}`);

        // Assign a diverse random symptom for this phone call
        const symptomOptions = ['fever', 'severe headache', 'stomach ache', 'lower back pain', 'persistent cough', 'sore throat', 'knee pain', 'body fatigue', 'skin rash', 'mild chest pain'];
        const randomSymptom = symptomOptions[Math.floor(Math.random() * symptomOptions.length)];

        this.activeCalls.set(callSid, {
            history: [],
            isBookingConfirmed: false,
            direction: direction,
            inboundConfig: { ...this.inboundConfig },
            scenario: scenario,
            targetLanguage: targetLanguage,
            persona: persona,
            symptom: randomSymptom,   // Assigned to this specific call
            startTime: Date.now(),
            audioBuffer: [],          // Holds all audio chunks while the bot is speaking
            silenceTimer: null,       // The stopwatch waiting for silence
            hasSpoken: false,         // Tracks if the user has triggered VAD yet
            isProcessing: false,      // Tracks if the NLP pipeline is currently active
            isEnding: false,          // Prevents endCall from executing twice
            isInterrupted: false,     // Tracks if Exotel sent a 'clear' barge-in event
            ws: ws,                   // Store reference to close call if needed
            packetCount: 0,           // Debug: track packets received
            aiFinishedSpeakingAt: null, // Timestamp when AI finishes speaking
            latencies: [],            // Array to store turn-by-turn response delays
            outboundSequenceNumber: 10, // Exotel sequence number tracking
            outboundChunkNumber: 0,   // Exotel chunk index tracking
            isAiSpeaking: false,      // Half-duplex flag: true while AI audio is playing
            ignoreAudioUntil: 0,      // Timestamp to suppress line echo after speaking
            lastTargetSpeechTime: 0,  // Timestamp when target bot last produced audio above threshold
            bargeInCounter: 0         // Frame counter for software barge-in detection
        });

        // 2-Minute Initial Timeout for unreachable bot (Watchdog)
        this.resetWatchdog(callSid, 120000, "Target bot unreachable (no connection) for 2 minutes.");
    }

    /**
     * Handles Exotel barge-in / clear event when caller speaks over the AI
     */
    handleBargeIn(callSid) {
        const callState = this.activeCalls.get(callSid);
        if (!callState) return;
        console.log(`🧹 [Call Manager] Barge-in triggered for ${callSid}. Halting active speech playback and clearing audio queue.`);
        callState.isInterrupted = true;
        callState.isAiSpeaking = false;
        if (callState.silenceTimer) {
            clearTimeout(callState.silenceTimer);
            callState.silenceTimer = null;
        }
        if (callState.ws && callState.ws.readyState === 1) {
            const streamId = callState.ws.stream_sid || callState.ws.streamSid || callSid;
            try {
                callState.ws.send(JSON.stringify({
                    event: "clear",
                    stream_sid: streamId,
                    streamSid: streamId
                }));
            } catch (e) { }
        }
    }

    /**
     * Clears any active watchdog timer for a specific call
     */
    clearWatchdog(callSid) {
        if (this.watchdogTimers.has(callSid)) {
            clearTimeout(this.watchdogTimers.get(callSid));
            this.watchdogTimers.delete(callSid);
        }
    }

    /**
     * Resets or starts a watchdog timer for a specific call
     */
    resetWatchdog(callSid, ms, reason) {
        this.clearWatchdog(callSid);

        const timer = setTimeout(() => {
            this.watchdogTimers.delete(callSid);
            const callState = this.activeCalls.get(callSid);
            if (!callState || callState.isEnding) return;

            console.log(`🛑 [Watchdog] ${reason} | Call: ${callSid}`);
            callState.history.push({ role: "assistant", content: `[Auto-Terminated: ${reason}]` });
            this.endCall(callSid);
        }, ms);

        this.watchdogTimers.set(callSid, timer);
    }

    /**
     * Processes audio chunk from Exotel WEbSocket
     * @param {string} callSid 
     * @param {Buffer} audioChunk 
     * @param {WebSocket} ws 
     */
    async handleIncomingAudio(callSid, audioChunk, ws, rms = 0) {
        try {
            const callState = this.activeCalls.get(callSid);
            if (!callState) return;

            // 1. Software Barge-In: If AI is actively transmitting speech, detect if target bot speaks over us
            if (callState.isAiSpeaking) {
                // Speech on PSTN is typically RMS > 25 (line echo is usually < 15)
                if (rms >= 18) {
                    callState.bargeInCounter = (callState.bargeInCounter || 0) + 1;
                    if (callState.bargeInCounter >= 2) { // 2 consecutive chunks (~40ms) of active speech
                        console.log(`🧹 [Software Barge-In]: Target bot started speaking (RMS: ${rms.toFixed(0)}) while tester bot was speaking! Halting playback immediately.`);
                        this.handleBargeIn(callSid);
                        callState.bargeInCounter = 0;
                    }
                } else {
                    callState.bargeInCounter = 0;
                }
                return;
            }

            // Post-playback line echo suppression guard
            if (callState.ignoreAudioUntil && Date.now() < callState.ignoreAudioUntil) {
                return;
            }

            callState.packetCount++;
            if (callState.packetCount === 1) {
                console.log(`[Call Manager] First audio packet received for ${callSid}. RMS: ${rms.toFixed(0)}`);
            }

            // 1. Add newest chunk to the bucket
            callState.audioBuffer.push(audioChunk);

            // Keep rolling 2s pre-speech buffer so initial syllables are never clipped
            if (!callState.hasSpoken && callState.audioBuffer.length > 100) {
                callState.audioBuffer = callState.audioBuffer.slice(-100);
            }

            // Cap buffer at 25 seconds to prevent unbounded memory growth
            if (callState.hasSpoken && callState.audioBuffer.length > 1250) {
                callState.audioBuffer = callState.audioBuffer.slice(-1250);
            }

            const LOUDNESS_THRESHOLD = 18; // Speech threshold: PSTN background noise is < 12, voice is > 25

            // Diagnostic logging while waiting for bot response
            if (typeof callState.windowRmsMax === 'undefined') callState.windowRmsMax = 0;
            if (rms > callState.windowRmsMax) callState.windowRmsMax = rms;

            if ((!callState.lastWaitingRmsLog || Date.now() - callState.lastWaitingRmsLog > 2000)) {
                callState.lastWaitingRmsLog = Date.now();
                if (!callState.hasSpoken) {
                    console.log(`[Call Manager Audio In] Listening... Peak RMS: ${callState.windowRmsMax.toFixed(0)} | Current RMS: ${rms.toFixed(0)} (Threshold: ${LOUDNESS_THRESHOLD}) | Packets: ${callState.packetCount}`);
                }
                callState.windowRmsMax = 0;
            }

            // 2. Active Speech Detection: When target bot is speaking
            if (rms > LOUDNESS_THRESHOLD) {
                callState.lastTargetSpeechTime = Date.now();
                callState.consecutiveSpeechFrames = (callState.consecutiveSpeechFrames || 0) + 1;
                callState.totalSpeechFramesInUtterance = (callState.totalSpeechFramesInUtterance || 0) + 1;

                // Target bot is speaking: cancel any pending silence countdown IMMEDIATELY on any speech chunk
                if (callState.silenceTimer) {
                    clearTimeout(callState.silenceTimer);
                    callState.silenceTimer = null;
                }

                // Require at least 3 consecutive frames (~60ms) of sustained energy to confirm real speech
                // (filters out single-packet line clicks, connection pops, and audio glitches on WebSocket open)
                if (callState.consecutiveSpeechFrames >= 3) {
                    callState.hasSpoken = true;

                    this.clearWatchdog(callSid);

                    if (callState.aiFinishedSpeakingAt) {
                        const latency = (Date.now() - callState.aiFinishedSpeakingAt) / 1000;
                        console.log(`[Call Manager] Bot speech detected in ${latency.toFixed(2)}s (RMS: ${rms.toFixed(0)}, Threshold: ${LOUDNESS_THRESHOLD})`);
                        callState.latencies.push(latency);
                        callState.aiFinishedSpeakingAt = null;
                    }
                }
            } else {
                callState.consecutiveSpeechFrames = 0;
            }

            // 3. Silence Detection (End-of-Utterance):
            // When target bot has spoken and audio drops into sustained silence (2200ms on Turn 1; 1800ms on Turn 2+)
            if (rms <= LOUDNESS_THRESHOLD && callState.hasSpoken && !callState.silenceTimer) {
                const isFirstTurn = (callState.history.length === 0);

                // On Turn 1 (Initial Greeting): Ensure target bot actually spoke a real greeting 
                // (at least 20 speech frames / ~400ms) and didn't just produce a brief line chirp on connect
                if (isFirstTurn && (callState.totalSpeechFramesInUtterance || 0) < 20) {
                    callState.hasSpoken = false;
                    callState.totalSpeechFramesInUtterance = 0;
                    return; // Continue listening for the real greeting
                }

                const silenceDelay = isFirstTurn ? 2200 : 1800;

                callState.silenceTimer = setTimeout(async () => {
                    const processingStartTime = Date.now();
                    callState.isProcessing = true;
                    try {
                        // Combine all chunks recorded for this utterance
                        const fullPcmBuffer = Buffer.concat(callState.audioBuffer);

                        // Reset bucket for next turn
                        callState.audioBuffer = [];
                        callState.hasSpoken = false;
                        callState.consecutiveSpeechFrames = 0;
                        callState.totalSpeechFramesInUtterance = 0;

                        // Ensure 16-bit alignment (even number of bytes)
                        let alignedBuffer = fullPcmBuffer;
                        if (alignedBuffer.length % 2 !== 0) {
                            alignedBuffer = alignedBuffer.slice(0, alignedBuffer.length - 1);
                        }

                        // Create valid 16-bit 8000Hz WAV for STT
                        const uploadWav = new WaveFile();
                        const int16Samples = new Int16Array(
                            alignedBuffer.buffer,
                            alignedBuffer.byteOffset,
                            alignedBuffer.length / 2
                        );
                        uploadWav.fromScratch(1, 8000, '16', int16Samples);
                        const validWavBuffer = uploadWav.toBuffer();

                        // Transcribe with Sarvam STT
                        let { text: transcript, languageCode } = await sarvamService.streamToText(validWavBuffer, callState.targetLanguage);

                        // Overlap guard: Check if target bot resumed speaking while STT was running
                        if (callState.lastTargetSpeechTime > processingStartTime || callState.hasSpoken) {
                            console.log(`🛑 [Overlap Guard]: Target bot resumed speaking while STT was running. Resuming listening...`);
                            callState.audioBuffer = [fullPcmBuffer];
                            return;
                        }

                        if (!transcript || transcript.trim().length < 2) {
                            console.log(`[Call Manager] STT returned empty transcript. Resuming listening...`);
                            return;
                        }

                        // Filler Guard: Detect intermediate filler messages emitted by Bedrock/Voicebot while processing
                        // e.g. "Let me check availability for you", "Please hold on", "One moment", "Checking that for you"
                        // CRITICAL: Only consider it a filler if it does NOT contain an actual question or prompt!
                        // (e.g. "Let me check availability for you. Do you have a preferred doctor or would you like to tell me the reason for your visit?" is a complete turn prompt!)
                        const hasFillerPhrase = /check availability|please (hold|wait)|one moment|just a moment|give me a moment|let me check|looking (that )?up|checking (that )?for you|let me look|कृपया प्रतीक्षा|एक क्षण|தயவுசெய்து காத்திருக்க|ஒரு நிமிடம்/i.test(transcript.trim());
                        const hasQuestionOrPrompt = /\?|doctor|reason|visit|symptom|date|time|slot|department|which|who|what|when|where|how|would you|do you|can you|tell me/i.test(transcript.trim());
                        const isPureFiller = hasFillerPhrase && !hasQuestionOrPrompt;

                        if (isPureFiller) {
                            console.log(`🤖 [Target Bot Filler]: "${transcript}" (Waiting for final question/response...)`);
                            callState.audioBuffer = [];
                            callState.hasSpoken = false;
                            this.resetWatchdog(callSid, 35000, "Target bot hung after filler (no follow-up response within 35s).");
                            return; // Do NOT reply to pure fillers; keep listening for the actual question
                        }

                        // Turn-1 Completion Guard:
                        // On Turn 1, ensure the hospital voice bot has finished its ENTIRE opening greeting!
                        // Telephony voice bots deliver multi-sentence greetings with inter-sentence pauses.
                        // The greeting ALWAYS ends by asking for intent or identity (e.g. "How can I help you today?", "How may I assist?", "Am I speaking with...").
                        // It must NEVER trigger prematurely on "assist you" within descriptive sentences like:
                        // "I can assist you in managing your appointments".
                        if (isFirstTurn) {
                            const callDuration = Date.now() - callState.startTime;

                            // Greeting concluding question patterns:
                            const hasGreetingQuestion = /how (can|may) (i|we) (help|assist)|what can (i|we) do|who would you like to speak|can i (help|assist) you with something|tell me how|state your query|am i (speaking|talking) with|is this [a-z]+|may i speak with|\?\s*$/i.test(transcript);

                            // Detect incomplete/truncated sentence ending (dangling conjunction or preposition)
                            const isTruncated = /(and|in|to|the|of|with|for|managing|a|an|or|is|that|this|at|by|from|about)\s*$/i.test(transcript.trim());

                            // Full greeting is at least 25 characters
                            const isLongEnough = transcript.trim().length >= 25;

                            const isGreetingComplete = hasGreetingQuestion && !isTruncated && isLongEnough;

                            // If greeting is not complete and we are within the first 16 seconds of the call, KEEP LISTENING
                            if (!isGreetingComplete && callDuration < 16000) {
                                console.log(`⏳ [Turn-1 Guard]: Target bot greeting incomplete ("${transcript}"). Waiting for full question/prompt before responding... (Call duration: ${(callDuration/1000).toFixed(1)}s)`);
                                // Preserve audio so upcoming sentences append seamlessly
                                callState.audioBuffer = [fullPcmBuffer];
                                callState.hasSpoken = true;
                                return;
                            }
                        }

                        // Anti-hallucination check
                        const isObviousSpeech = transcript.length > 5 && /appointment|doctor|hospital|medicare|clinic|help|welcome|booking|name|date|time|person|consult|survey|feedback|participate|anything|else|all set|confirm|rate|scale|experience|score|thank you|attend|scheduled|reschedule|cancel|check|available|moment|hold|slot|suri/i.test(transcript);
                        let isFakeAudio = false;
                        if (!isObviousSpeech) {
                            isFakeAudio = await llmService.isHallucination(transcript, callState.targetLanguage, languageCode);
                        }

                        if (isFakeAudio) {
                            console.log(`⚠️ [Audio Filter]: LLM blocked dynamic STT hallucination: "${transcript}"`);
                            return;
                        }

                        console.log(`🤖 [Target Bot]: "${transcript}"`);

                        callState.history.push({ role: "user", content: transcript });

                        let replyText, updatedState;

                        // Scenario 1: INBOUND_NO_ANSWER (Patient ignores / does not pick up phone)
                        if (callState.scenario === 'INBOUND_NO_ANSWER') {
                            console.log(`📵 [Inbound Scenario: NO ANSWER]: Target bot spoke, but patient is ignoring/not answering the phone. Remaining completely silent...`);
                            this.resetWatchdog(callSid, 30000, "Inbound Unanswered Call: Target bot silence timeout passed.");
                            callState.hasSpoken = false; // Reset VAD state so buffer is dropped
                            return; // Do not speak!
                        }

                        // If target bot starts by checking patient identity, adjust scenario dynamically
                        const isIdentityCheck = /speaking with|is this|am i talking to|am i speaking|may i speak with/i.test(transcript);
                        if (isFirstTurn && isIdentityCheck) {
                            if (callState.scenario === 'Booking' || !callState.scenario.startsWith('INBOUND')) {
                                callState.scenario = this.inboundConfig.scenario || 'INBOUND_CONFIRM';
                                callState.direction = 'inbound';
                                console.log(`🔀 [Auto-Scenario Detection]: Target bot is calling patient for appointment verification. Switched scenario to: ${callState.scenario}`);
                            }
                        } else if (callState.scenario === 'INBOUND_CUT_CALL') {
                            // Scenario 2: INBOUND_CUT_CALL (Attended & spoke Turn 1, now abruptly cutting the call mid-conversation!)
                            const targetLang = (callState.targetLanguage || 'English').toLowerCase();
                            console.log(`\n✂️ [Inbound Scenario: CUT IN MIDDLE]: Patient attended and spoke Turn 1. Now abruptly cutting call mid-conversation!`);
                            const cutText = (targetLang === 'tamil') 
                                ? "மன்னிக்கவும், நான் வைக்கிறேன்—" 
                                : (targetLang === 'hindi') 
                                    ? "माफ़ कीजिए, मुझे अभी काटना पड़ रहा है—" 
                                    : "Wait, sorry, I have to go—";
                            
                            callState.history.push({ role: "assistant", content: `[Patient Spoke: "${cutText}" and Abruptly Disconnected Call Mid-Conversation]` });
                            await this.playAIResponse(callSid, cutText, ws, languageCode);
                            await new Promise(r => setTimeout(r, 600));
                            if (ws.readyState === 1) {
                                ws.close();
                            }
                            return;
                        } else if (this.manualOverrideResponse) {
                            replyText = this.manualOverrideResponse;
                            console.log(`🎛️ [Manual Override]: Intercepted turn. Using forced response: "${replyText}"`);

                            // Clear the override immediately
                            this.manualOverrideResponse = null;
                            updatedState = { ...callState, lastIntentProcessed: true };
                        } else {
                            // Ask Gemini what to say back (Pass the OTP if we have one)
                            const result = await llmService.processCustomerIntent(transcript, {
                                ...callState,
                                latestReceivedOTP: this.latestReceivedOTP
                            });
                            replyText = result.replyText;
                            updatedState = result.updatedState;
                        }

                        if (replyText.trim() === "WAIT") {
                            console.log(`⏳ [AI Tester] Detected incomplete sentence. Waiting for the target bot to finish...`);
                            if (updatedState) Object.assign(callState, updatedState);
                            return; // Do not speak, just keep listening
                        }

                        if (replyText.trim() === "END_CALL_LOOP") {
                            console.log(`🛑 [AI Tester] Detected target bot is stuck in a loop. Auto-terminating call...`);
                            callState.history.push({ role: "assistant", content: "[Auto-Terminated by Tester: Target bot is stuck in an infinite loop]" });
                            if (updatedState) Object.assign(callState, updatedState);

                            // Close the WebSocket connection to physically drop the Exotel call
                            if (ws.readyState === 1) ws.close();
                            return;
                        }

                        // Overlap guard: Check if target bot resumed speaking while LLM was processing
                        if (callState.lastTargetSpeechTime > processingStartTime || callState.hasSpoken) {
                            console.log(`🛑 [Overlap Guard]: Target bot resumed speaking while LLM was generating reply. Dropping response to continue listening.`);
                            callState.audioBuffer = [fullPcmBuffer, ...callState.audioBuffer];
                            return;
                        }

                        if (updatedState) Object.assign(callState, updatedState);
                        await this.playAIResponse(callSid, replyText, ws, languageCode);
                    } catch (timerError) {
                        console.error(`[Call Manager] Error during transcription/TTS flow: ${timerError.message}`);
                    } finally {
                        callState.isProcessing = false;
                        callState.silenceTimer = null;
                    }
                }, silenceDelay);
            }

        } catch (error) {
            console.error(`[Call Manager] Error handling audio for ${callSid}: ${error.message}`);
        }
    }

    async endCall(callSid) {
        this.clearWatchdog(callSid);
        const callState = this.activeCalls.get(callSid);
        if (callState) {
            // Prevent double execution from both 'stop' and 'close' WebSocket events
            if (callState.isEnding) return;
            callState.isEnding = true;

            // Immediately clear any pending silence timer so it does not fire into the next call
            if (callState.silenceTimer) {
                clearTimeout(callState.silenceTimer);
                callState.silenceTimer = null;
            }

            // Clear any pending timeouts
            if (callState.watchdogTimeout) {
                clearTimeout(callState.watchdogTimeout);
                callState.watchdogTimeout = null;
            }
            if (callState.nudgeTimer) {
                clearTimeout(callState.nudgeTimer);
                callState.nudgeTimer = null;
            }

            callState.isAiSpeaking = false;
            callState.isProcessing = false;

            // Send clear event to Exotel to flush any buffered audio and close cleanly
            if (callState.ws && callState.ws.readyState === 1) {
                const streamId = callState.ws.stream_sid || callState.ws.streamSid || callSid;
                try {
                    callState.ws.send(JSON.stringify({
                        event: "clear",
                        stream_sid: streamId,
                        streamSid: streamId
                    }));
                } catch (e) { }
                callState.ws.close();
            }

            console.log(`[Call Manager] Call ended cleanly: ${callSid}`);

            // Generate Test Report
            if (callState.history && callState.history.length > 0) {
                console.log(`\n📊 [Call Manager] Analyzing call history for Test Report (Language: ${callState.targetLanguage}, Scenario: ${callState.scenario})...`);
                try {
                    const report = await llmService.generateTestReport(callState);
                    console.log(`###REPORT###` + JSON.stringify({ callSid, scenario: callState.scenario, report }));

                    // Determine the scenario for the *next* call based on this call's success
                    if (callState.scenario === 'BOOKING' && report.isBookingConfirmed === true) {
                        this.nextScenario = 'CANCELLATION';
                        console.log(`[Call Manager] Booking was confirmed (even if test failed)! Next incoming call will trigger a CANCELLATION scenario.`);
                    } else {
                        // If booking wasn't confirmed, or we just finished a cancellation cycle, reset back to booking.
                        this.nextScenario = 'BOOKING';
                        console.log(`[Call Manager] Next incoming call will trigger a BOOKING scenario.`);
                    }

                } catch (e) {
                    console.error("[Call Manager] Failed to generate post-call report:", e.message);
                }
            } else {
                console.log(`###REPORT###` + JSON.stringify({
                    callSid,
                    report: {
                        status: "Skipped",
                        uxAnalysis: "Call ended before any conversation occurred.",
                        enhancements: []
                    }
                }));
            }

            this.activeCalls.delete(callSid);
        }
    }

    /**
     * Triggers an AI response without waiting for bot audio (e.g. for initial greeting)
     */
    async triggerAIResponse(callSid, initialText, ws) {
        const callState = this.activeCalls.get(callSid);
        if (!callState || callState.isEnding) return;

        console.log(`[Call Manager] Triggering AI initiative: "${initialText}"`);
        callState.history.push({ role: "assistant", content: `(System: Bot was silent. AI is taking initiative: ${initialText})` });

        const result = await llmService.processCustomerIntent(initialText, {
            ...callState,
            latestReceivedOTP: this.latestReceivedOTP
        });

        const langCode = callState.targetLanguage === 'English' ? 'en-IN' : 'hi-IN';
        await this.playAIResponse(callSid, result.replyText, ws, langCode);
    }

    /**
     * Converts text to speech and streams it to Exotel with jitter-resistant pacing
     */
    async playAIResponse(callSid, replyText, ws, languageCode) {
        const callState = this.activeCalls.get(callSid);
        if (!callState || callState.isEnding) return;

        if (callState.silenceTimer) {
            clearTimeout(callState.silenceTimer);
            callState.silenceTimer = null;
        }

        // --- RESTORE LOGS ---
        console.log(`🧑 [AI Tester]: "${replyText}"`);
        callState.history.push({ role: "assistant", content: replyText });

        // IMPORTANT: Reset hasSpoken to false so silence detection only restarts 
        // when the TARGET BOT begins speaking again.
        callState.hasSpoken = false;

        // Natural conversational Indian male voice for patient Gokulakannan
        const speaker = 'aditya';
        callState.isAiSpeaking = true;
        let replyAudioBuffer;
        try {
            const langParam = callState.targetLanguage || languageCode || 'English';
            replyAudioBuffer = await sarvamService.textToStream(replyText, langParam, speaker);
            if (!replyAudioBuffer || replyAudioBuffer.length === 0) {
                console.error(`❌ [Call Manager] Failed to generate TTS audio for: "${replyText}"`);
                callState.isAiSpeaking = false;
                return;
            }
        } catch (ttsErr) {
            console.error(`❌ [Call Manager] Error generating TTS audio: ${ttsErr.message}`);
            callState.isAiSpeaking = false;
            return;
        }

        const wav = new WaveFile();
        wav.fromBuffer(replyAudioBuffer);
        // Only resample if Sarvam returned a different rate than 8000Hz (preserves natural harmonics)
        if (wav.fmt.sampleRate !== 8000) {
            wav.toSampleRate(8000);
        }
        if (wav.fmt.bitsPerSample !== 16) {
            wav.toBitDepth('16');
        }

        // Extract raw 16-bit Linear PCM (slin) samples directly without clipping distortion
        const pcmBuffer = Buffer.from(wav.data.samples);

        // Reset barge-in interruption flag for new utterance
        callState.isInterrupted = false;

        // Exotel Chunk Constraints:
        // - Minimum chunk size: 3.2 KB (3200 bytes)
        // - Byte alignment: Must be an exact multiple of 320 bytes
        // 3200 bytes = exactly 10 * 320 bytes (200ms at 8kHz 16-bit mono)
        const CHUNK_SIZE_BYTES = 3200;
        let offset = 0;
        const streamIdentifier = ws.stream_sid || ws.streamSid || callSid;
        const totalChunks = Math.ceil(pcmBuffer.length / CHUNK_SIZE_BYTES);

        console.log(`📡 [Call Manager] Streaming ${totalChunks} audio chunks (${pcmBuffer.length} bytes, ${(pcmBuffer.length / 16000).toFixed(1)}s) to Exotel stream: ${streamIdentifier}...`);

        let sentChunks = 0;
        let totalBytesSent = 0;

        if (ws.readyState === 1) {
            const isFirstTurn = (callState.history.length <= 1);
            const callDuration = Date.now() - callState.startTime;

            // Turn-1 Minimum Silence Guard: Never speak in the first 5 seconds of the call under ANY circumstance
            if (isFirstTurn && callDuration < 5000) {
                console.log(`🛑 [Turn-1 Safety Guard]: Blocked premature speech (${(callDuration/1000).toFixed(1)}s into call). Target bot greeting takes priority.`);
                callState.isAiSpeaking = false;
                return;
            }

            // Collision guard: Check if target bot spoke within the last 1500ms
            if (callState.lastTargetSpeechTime && (Date.now() - callState.lastTargetSpeechTime < 1500)) {
                console.log(`🛑 [Overlap Prevention]: Target bot spoke ${Date.now() - callState.lastTargetSpeechTime}ms ago. Aborting speech playback to prevent collision.`);
                callState.isAiSpeaking = false;
                return;
            }

            callState.isAiSpeaking = true;
            try {
                // Natural conversational breathing pause: 600ms settling time after speech has ceased
                const preSpeechDelay = 600;
                await new Promise(r => setTimeout(r, preSpeechDelay));

                // Check again after preSpeechDelay in case target bot resumed speaking during the delay
                if (callState.isInterrupted || (callState.lastTargetSpeechTime && (Date.now() - callState.lastTargetSpeechTime < 600))) {
                    console.log(`🛑 [Overlap Prevention]: Target bot detected speaking during pre-speech delay. Halting.`);
                    return;
                }

                while (offset < pcmBuffer.length) {
                    // Honor barge-in if target bot speaks over us (after at least 1 chunk played)
                    if (ws.readyState !== 1 || (callState.isInterrupted && sentChunks > 1)) {
                        if (callState.isInterrupted) {
                            console.log(`🧹 [Call Manager] Interrupted by target bot (barge-in). Stopped streaming and flushed Exotel buffer.`);
                            try {
                                ws.send(JSON.stringify({
                                    event: "clear",
                                    stream_sid: streamIdentifier,
                                    streamSid: streamIdentifier
                                }));
                            } catch (e) { }
                        }
                        break;
                    }

                    let chunkBytes = pcmBuffer.slice(offset, offset + CHUNK_SIZE_BYTES);

                    // Ensure byte alignment is an exact multiple of 320 bytes
                    const remainder = chunkBytes.length % 320;
                    if (remainder !== 0) {
                        const padBytes = Buffer.alloc(320 - remainder);
                        chunkBytes = Buffer.concat([chunkBytes, padBytes]);
                    }

                    // If final tail chunk is smaller than 3.2KB, pad to 3200 bytes
                    if (chunkBytes.length < 3200) {
                        chunkBytes = Buffer.concat([chunkBytes, Buffer.alloc(3200 - chunkBytes.length)]);
                    }

                    // Exotel Voicebot Applet specification (dual stream_sid & streamSid):
                    const exotelMediaMessage = {
                        event: "media",
                        stream_sid: streamIdentifier,
                        streamSid: streamIdentifier,
                        media: {
                            payload: chunkBytes.toString('base64')
                        }
                    };

                    ws.send(JSON.stringify(exotelMediaMessage));
                    sentChunks++;
                    totalBytesSent += chunkBytes.length;

                    offset += CHUNK_SIZE_BYTES;

                    // 3200 bytes at 8000Hz 16-bit mono = 200ms of audio.
                    // Pace chunks at 185ms for continuous, jitter-free playback.
                    await new Promise(r => setTimeout(r, 185));
                }

                // AI speech finished: drop isAiSpeaking immediately so we hear bot responses
                callState.isAiSpeaking = false;

                // Arm the 60-second watchdog now that AI speech transmission is complete
                callState.aiFinishedSpeakingAt = Date.now();
                this.resetWatchdog(callSid, 60000, "Target bot hung (no response) for 60 seconds after AI spoke.");

                // Line echo suppression window: ignore line reverberation of tester voice for 350ms
                callState.ignoreAudioUntil = Date.now() + 350;

                // Stream 36 chunks (~2.5s) of trailing silence frames (pure PCM 0s).
                // Target bot (Wellzio.Bots) requires:
                // - PAUSE_DETECTION_MS = 2000 (2.0s of silence after speech)
                // - MIN_CONSECUTIVE_SILENT_CHUNKS = 30 (at least 30 consecutive silent chunks)
                // before its backend triggers FlushAsync() to finalize Sarvam STT.
                // Sending 36 chunks @ 70ms intervals satisfies both conditions seamlessly.
                if (!callState.isInterrupted && ws.readyState === 1) {
                    const silenceChunk = Buffer.alloc(CHUNK_SIZE_BYTES, 0);
                    const silenceBase64 = silenceChunk.toString('base64');
                    for (let s = 0; s < 36; s++) {
                        if (ws.readyState !== 1 || callState.isInterrupted || callState.hasSpoken) break;
                        ws.send(JSON.stringify({
                            event: "media",
                            stream_sid: streamIdentifier,
                            streamSid: streamIdentifier,
                            media: {
                                payload: silenceBase64
                            }
                        }));
                        await new Promise(r => setTimeout(r, 70));
                    }

                    // Send Exotel Mark event to confirm playback completed in the telephony channel
                    ws.send(JSON.stringify({
                        event: "mark",
                        stream_sid: streamIdentifier,
                        streamSid: streamIdentifier,
                        mark: {
                            name: "audio_complete"
                        }
                    }));
                }

                if (!callState.isInterrupted) {
                    console.log(`✅ [Call Manager] Successfully finished streaming ${sentChunks} audio chunks (${totalBytesSent} bytes) + mark event to Exotel.\n`);
                }
            } finally {
                // Ensure isAiSpeaking is dropped and clean buffer if bot has not spoken
                callState.isAiSpeaking = false;
                if (!callState.hasSpoken) {
                    callState.audioBuffer = [];
                    callState.hasSpoken = false;
                }
            }
        }
    }
}

module.exports = new CallManager();
