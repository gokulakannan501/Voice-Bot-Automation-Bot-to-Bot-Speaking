require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

process.on('uncaughtException', (err) => {
    console.error('⚠️ [Server] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [Server] Unhandled Rejection:', reason);
});

// ---------------------------------------------------------
// REAL-TIME DASHBOARD LOG STREAMING (SSE)
// ---------------------------------------------------------
const sseClients = new Set();

// Intercept console.log to broadcast internal engine logs to the dashboard
const originalConsoleLog = console.log;
console.log = function (...args) {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    // Suppress internal audio telemetry from spamming the terminal console
    if (!message.startsWith('###AUDIO_RMS###')) {
        originalConsoleLog(message);
    }

    const sseMessage = message.split('\n').map(line => `data: ${line}`).join('\n') + '\n\n';

    // Broadcast to dashboard without crashing if a write fails
    sseClients.forEach(client => {
        try {
            client.write(sseMessage);
        } catch (err) {
            // Quietly ignore failed writes to disconnected clients
        }
    });
};

const originalConsoleError = console.error;
console.error = function (...args) {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    originalConsoleError(message);

    const sseMessage = message.split('\n').map(line => `data: ❌ ERROR: ${line}`).join('\n') + '\n\n';
    sseClients.forEach(client => {
        try {
            client.write(sseMessage);
        } catch (err) { }
    });
};

const callManager = require('./engine/callManager');
const exotelService = require('./services/exotelService');

// Middleware to parse multipart/form-data webhooks from Exotel
app.use((req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
        let rawData = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { rawData += chunk; });
        req.on('end', () => {
            req.body = req.body || {};
            const regex = /name="([^"]+)"[\r\n\s]+([^\r\n-]+)/g;
            let match;
            while ((match = regex.exec(rawData)) !== null) {
                req.body[match[1]] = match[2].trim();
            }
            next();
        });
    } else {
        next();
    }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Exotel Dynamic Voicebot Endpoint Resolver for root URL
app.get('/', (req, res, next) => {
    // If Exotel Voicebot Applet is resolving the dynamic stream endpoint
    if (req.query?.CallSid || req.query?.call_sid || req.query?.From || req.query?.CustomField) {
        let host = req.headers?.host || 'localhost:4001';
        if (process.env.PUBLIC_URL) {
            host = process.env.PUBLIC_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
        }

        let customField = {};
        try {
            if (req.query.CustomField) {
                let raw = req.query.CustomField;
                if (typeof raw === 'string') raw = raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                customField = typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
        } catch (e) { }

        // Detect if this is an incoming call hitting our ExoPhone
        const isInbound = (req.query?.Direction === 'incoming' || req.query?.CallType === 'inbound' || (!customField.scenario && !req.query?.scenario));
        const direction = isInbound ? 'inbound' : 'outbound';

        const lang = customField.language || req.query?.language || (isInbound ? callManager.inboundConfig.language : 'English');
        const persona = customField.persona || req.query?.persona || 'Self';
        const scenario = customField.scenario || req.query?.scenario || (isInbound ? callManager.inboundConfig.scenario : 'Booking');

        const queryParams = `?targetLanguage=${encodeURIComponent(lang)}&persona=${encodeURIComponent(persona)}&scenario=${encodeURIComponent(scenario)}&direction=${encodeURIComponent(direction)}&sample-rate=8000`;
        const wssUrl = `wss://${host}/${queryParams}`;

        console.log(`\n📲 [Exotel Voicebot Applet] ${direction.toUpperCase()} Call detected! From: ${req.query?.From || 'caller'} | Scenario: ${scenario} | Lang: ${lang}`);
        console.log(`📡 [Stream URL]: ${wssUrl}`);
        return res.json({
            url: wssUrl,
            sample_rate: 8000
        });
    }
    next();
});

// Inbound Assistant Configuration Endpoints
app.get('/inbound-config', (req, res) => {
    res.json({
        ...callManager.inboundConfig,
        callerId: process.env.EXOTEL_CALLER_ID || ''
    });
});

app.post('/inbound-config', (req, res) => {
    const { scenario, patientName, preferredSlot, language } = req.body;
    if (scenario) callManager.inboundConfig.scenario = scenario;
    if (patientName) callManager.inboundConfig.patientName = patientName;
    if (preferredSlot) callManager.inboundConfig.preferredSlot = preferredSlot;
    if (language) callManager.inboundConfig.language = language;

    console.log(`\n🎛️ [Inbound Config Updated] Scenario: ${callManager.inboundConfig.scenario} | Patient: ${callManager.inboundConfig.patientName} | Slot: ${callManager.inboundConfig.preferredSlot}`);
    res.json({ success: true, config: callManager.inboundConfig });
});

// Serve the Dashboard UI and static assets
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------
// EXOTEL VOICE WEBHOOK & CONFIGURATION
// ---------------------------------------------------------
// Exotel Voicebot Applet endpoint (Returns WebSocket URL or ExML stream directive)
app.all(['/exotel-webhook', '/voice-webhook', '/twilio-webhook'], (req, res) => {
    try {
        const requestedLanguage = req.query?.language || req.body?.language || 'English';
        const persona = req.query?.persona || req.body?.persona || 'Self';
        const scenario = req.query?.scenario || req.body?.scenario || 'Booking';

        console.log(`\n📞 [Exotel Voice Webhook] Handshake received. Lang: ${requestedLanguage}, Persona: ${persona}, Scenario: ${scenario}.`);

        // Determine host URL for WebSocket connection
        let host = req.headers?.host || 'localhost:4001';
        if (process.env.PUBLIC_URL) {
            host = process.env.PUBLIC_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
        }

        const queryParams = `?targetLanguage=${encodeURIComponent(requestedLanguage)}&persona=${encodeURIComponent(persona)}&scenario=${encodeURIComponent(scenario)}&sample-rate=8000`;
        const wssUrl = `wss://${host}/${queryParams}`;

        // If caller requests ExML / XML format
        if (req.headers?.accept?.includes('xml') || req.query?.format === 'xml') {
            res.type('text/xml');
            return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream url="${wssUrl}" />
</Response>`);
        }

        // Default: JSON response containing the stream URL for Exotel Voicebot Applet
        return res.json({
            url: wssUrl,
            sample_rate: 8000
        });
    } catch (err) {
        console.error('❌ [Exotel Webhook Error]:', err.message);
        return res.status(200).json({ error: err.message });
    }
});

// Exotel Outbound Call Status Callback Endpoint
app.all('/exotel-call-status', (req, res) => {
    try {
        const body = req.body || {};
        const query = req.query || {};
        const callSid = body.CallSid || body.Sid || body.call_sid || query.CallSid || query.Sid || 'Update';
        const status = body.Status || body.call_status || query.Status || query.call_status || 'received';
        const duration = body.ConversationDuration || body.Duration || query.ConversationDuration || '0';
        const cause = body.RecordingUrl || body.FailedReason || body.DetailedStatus || '';

        console.log(`📡 [Exotel Call Update] SID: ${callSid} | Status: ${status} | Duration: ${duration}s ${cause ? '| Info: ' + cause : ''}`);
        return res.status(200).send('OK');
    } catch (e) {
        console.error(`❌ [Exotel Status Callback Error]:`, e.message);
        return res.status(200).send('OK');
    }
});

// ---------------------------------------------------------
// DASHBOARD SSE & MANUAL CONTROLS
// ---------------------------------------------------------
// SSE Endpoint for Dashboard Log Stream
app.get('/logs-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    sseClients.add(res);

    req.on('close', () => {
        sseClients.delete(res);
    });
});

// Manual OTP Injection Route (Triggered from Dashboard)
app.post('/inject-otp', (req, res) => {
    const otpCode = req.body.otp;

    if (otpCode) {
        console.log(`\n💉 [Manual Injection] User injected OTP: ${otpCode}`);
        callManager.latestReceivedOTP = otpCode;
        res.sendStatus(200);
    } else {
        res.status(400).send("No OTP provided");
    }
});

// Manual Response Override Route (Triggered from Dashboard)
app.post('/override-response', (req, res) => {
    const overrideText = req.body.text;

    if (overrideText) {
        console.log(`\n🎛️ [Manual Override] User set NEXT AI response: "${overrideText}"`);
        callManager.manualOverrideResponse = overrideText;
        res.sendStatus(200);
    } else {
        res.status(400).send("No text provided");
    }
});

// Trigger Exotel Outbound Test (From Dashboard)
app.all(['/run-test', '/run-tests'], async (req, res) => {
    const requestedLanguage = req.body?.language || req.query?.language || 'English';
    const persona = req.body?.persona || req.query?.persona || 'Self';
    const scenario = req.body?.scenario || req.query?.scenario || 'Booking';
    const targetNumber = req.body?.targetNumber || req.query?.targetNumber || '';
    const patientName = req.body?.patientName || req.query?.patientName;
    const preferredSlot = req.body?.preferredSlot || req.query?.preferredSlot;

    if (patientName) callManager.inboundConfig.patientName = patientName;
    if (preferredSlot) callManager.inboundConfig.preferredSlot = preferredSlot;

    console.log(`\n> Dashboard triggered new Exotel outbound test. Target: ${targetNumber || 'default'}, Lang: ${requestedLanguage}, Persona: ${persona}, Scenario: ${scenario}${patientName ? ` | Patient: ${patientName}` : ''}`);

    // Auto-terminate any existing active calls to prevent dual-stream collision
    const existingCalls = [...callManager.activeCalls.keys()];
    if (existingCalls.length > 0) {
        console.log(`🧹 [Server] Ending ${existingCalls.length} previous active call(s) before launching new test...`);
        for (const sid of existingCalls) {
            try {
                await callManager.endCall(sid);
            } catch (err) {
                console.error(`Error ending previous call ${sid}:`, err.message);
            }
        }
    }

    // Spawn the Exotel dialer script using the current Node binary path
    const args = ['test_call_exotel.js', requestedLanguage, persona, scenario];
    if (targetNumber) args.push(targetNumber);
    const child = spawn(process.execPath, args);

    child.on('error', (err) => {
        console.error(`❌ [Server] Failed to start test_call_exotel.js: ${err.message}`);
    });

    child.on('exit', (code) => {
        if (code !== 0) {
            console.error(`❌ [Server] test_call_exotel.js exited with code ${code}`);
        } else {
            console.log(`✅ [Server] test_call_exotel.js finished successfully.`);
        }
    });

    // Pipe dialer output into Server Console to broadcast via SSE to UI
    child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        lines.forEach(line => console.log(line));
    });

    child.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        lines.forEach(line => console.error(line));
    });

    res.sendStatus(200);
});

// End an active Call Endpoint (From Dashboard)
app.post('/end-test', async (req, res) => {
    console.log(`\n> Dashboard requested to end active calls...`);
    const activeCalls = [...callManager.activeCalls.keys()];

    if (activeCalls.length === 0) {
        console.log(`> No active calls found in CallManager.`);
        return res.sendStatus(200);
    }

    try {
        for (const sid of activeCalls) {
            console.log(`> Terminating Exotel Call SID: ${sid}`);
            await callManager.endCall(sid);
        }
        res.sendStatus(200);
    } catch (e) {
        console.error(`> Error terminating call:`, e.message);
        res.status(500).send(e.message);
    }
});

// ---------------------------------------------------------
// EXOTEL AGENTSTREAM WEBSOCKET (VOICEBOT APPLET)
// ---------------------------------------------------------
wss.on('connection', (ws, req) => {
    console.log('🎧 Exotel AgentStream WebSocket Connected');
    let callSid = "exotel-call-" + Date.now();
    let streamSid = null;

    // Extract query parameters from connection URL if provided
    let urlParams = {};
    try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        urlParams = Object.fromEntries(parsedUrl.searchParams.entries());
    } catch (e) { }

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            const eventType = data.event;

            if (eventType === 'connected') {
                console.log('📡 [Exotel] Stream Handshake Connected.');
                return;
            }

            if (eventType === 'start') {
                const streamSid = data.stream_sid || data.streamSid || data.start?.stream_sid || data.start?.streamSid || ('stream-' + Date.now());
                callSid = data.call_sid || data.callSid || data.start?.call_sid || data.start?.callSid || streamSid;

                ws.stream_sid = streamSid;
                ws.streamSid = streamSid;

                let customParams = data.custom_parameters || data.customParameters || data.start?.custom_parameters || data.start?.customParameters || {};

                // If Exotel serialized custom parameters into a JSON string key: {"{...}": ""} or {"{&quot;...&quot;}": ""}
                for (const [key, val] of Object.entries(customParams)) {
                    if (typeof key === 'string') {
                        const unescaped = key.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
                        if (unescaped.startsWith('{') && unescaped.endsWith('}')) {
                            try {
                                const parsed = JSON.parse(unescaped);
                                customParams = { ...customParams, ...parsed };
                            } catch (e) { }
                        }
                    }
                }

                const mergedParams = { ...urlParams, ...customParams };
                if (mergedParams.language && !mergedParams.targetLanguage) {
                    mergedParams.targetLanguage = mergedParams.language;
                }

                const mediaFormat = data.media_format || data.start?.media_format || {};

                console.log(`\n\n📡 Exotel Stream Started! Call SID: ${callSid} | Stream SID: ${streamSid}`);
                console.log(`📡 [Exotel Format]: ${JSON.stringify(mediaFormat)} | Params:`, mergedParams);

                // Start call in CallManager
                callManager.startCall(callSid, ws, mergedParams);
                return;
            }

            // Exotel streams raw 16-bit Linear PCM (slin) mono in Base64
            if (eventType === 'media' && data.media && data.media.payload) {
                if (!ws.receivedFirstMedia) {
                    ws.receivedFirstMedia = true;
                    console.log(`📡 [Exotel Media In] Receiving audio stream for ${callSid}...`);
                }
                if (data.stream_sid && !ws.stream_sid) {
                    ws.stream_sid = data.stream_sid;
                }
                const pcmAudioBuffer = Buffer.from(data.media.payload, 'base64');

                // Interpret as 16-bit PCM samples directly (no mu-law transcoding needed)
                const pcmSamples = new Int16Array(
                    pcmAudioBuffer.buffer,
                    pcmAudioBuffer.byteOffset,
                    pcmAudioBuffer.length / 2
                );

                // Compute RMS Volume for Voice Activity Detection (VAD)
                let sumSquares = 0;
                for (let i = 0; i < pcmSamples.length; i++) {
                    sumSquares += pcmSamples[i] * pcmSamples[i];
                }
                const rms = pcmSamples.length > 0 ? Math.sqrt(sumSquares / pcmSamples.length) : 0;

                // Broadcast live RMS to dashboard every 150ms for the dual-channel monitor
                const now = Date.now();
                if (!ws.lastRmsBroadcast || now - ws.lastRmsBroadcast > 150) {
                    ws.lastRmsBroadcast = now;
                    const activeCall = callManager.activeCalls.get(callSid);
                    const isAi = Boolean(activeCall && activeCall.isAiSpeaking);
                    console.log(`###AUDIO_RMS###${JSON.stringify({ rms: Math.round(rms), isAi })}`);
                }

                await callManager.handleIncomingAudio(callSid, pcmAudioBuffer, ws, rms);
            }

            // Exotel Mark Confirmation Event
            if (eventType === 'mark') {
                const markName = data.mark?.name || data.name || 'audio_complete';
                console.log(`📍 [Exotel] Playback mark completed: "${markName}" for CallSid: ${callSid}`);
            }

            // Exotel Clear Event (Barge-in / User Interruption)
            if (eventType === 'clear') {
                console.log('🧹 [Exotel] Received clear event (Barge-in / interruption from caller).');
                callManager.handleBargeIn(callSid);
            }

            if (eventType === 'stop') {
                const stopDetails = data.stop || data;
                console.log(`🛑 Exotel stream stopped by remote. Details:`, JSON.stringify(stopDetails));
                await callManager.endCall(callSid);
            }

            if (!['connected', 'start', 'media', 'mark', 'clear', 'stop'].includes(eventType)) {
                console.log(`📡 [Exotel Event]: ${eventType}`, JSON.stringify(data));
            }
        } catch (e) {
            console.error('Error parsing WebSocket message from Exotel:', e.message);
        }
    });

    ws.on('close', async (code, reason) => {
        const reasonText = reason ? reason.toString() : 'None';
        console.log(`Exotel WebSocket Disconnected physically. Code: ${code} | Reason: ${reasonText}`);
        await callManager.endCall(callSid);
    });
});

const PORT = process.env.PORT || 4001;
server.listen(PORT, () => {
    console.log(`🚀 Exotel Native Webhook & WebSocket Server running on port ${PORT}`);
});
