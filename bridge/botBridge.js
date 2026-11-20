const EventEmitter = require('events');
const WebSocket = require('ws');

class BotBridge extends EventEmitter {
    constructor() {
        super();
        this.wsA = null;
        this.wsB = null;
        this.status = 'idle'; // 'idle' | 'connecting' | 'active' | 'completed' | 'error'
        this.config = null;
        this.turnCount = 0;
        this.history = [];
        this.activeSpeaker = null;
        this.stats = {
            packetsAtoB: 0,
            packetsBtoA: 0,
            bytesAtoB: 0,
            bytesBtoA: 0,
            turns: 0,
            startTime: null,
            endTime: null
        };
        this.audioSilenceTimer = null;
    }

    /**
     * Start the Bot-to-Bot WebSocket Bridge
     * @param {object} options
     * @param {string} options.botAUrl - WebSocket URL for Bot A (e.g. Target Bot)
     * @param {string} options.botBUrl - WebSocket URL for Bot B (e.g. Tester Bot)
     * @param {string} [options.mode='json'] - 'json' | 'audio'
     * @param {string} [options.initiator='botA'] - 'botA' | 'botB'
     * @param {number} [options.maxTurns=10] - Maximum conversation turns before auto-stop
     * @param {string} [options.nameA='Bot A (Target)']
     * @param {string} [options.nameB='Bot B (Tester)']
     */
    async start(options = {}) {
        if (this.status === 'active' || this.status === 'connecting') {
            throw new Error('A Bot-to-Bot session is already running.');
        }

        this.config = {
            botAUrl: options.botAUrl || process.env.TARGET_BOT_WS_URL || 'ws://localhost:5001',
            botBUrl: options.botBUrl || 'ws://localhost:5002',
            mode: options.mode || 'json',
            initiator: options.initiator || 'botA',
            maxTurns: parseInt(options.maxTurns, 10) || 10,
            nameA: options.nameA || 'Bot A (Target)',
            nameB: options.nameB || 'Bot B (Tester)'
        };

        this.status = 'connecting';
        this.turnCount = 0;
        this.history = [];
        this.activeSpeaker = null;
        this.stats = {
            packetsAtoB: 0,
            packetsBtoA: 0,
            bytesAtoB: 0,
            bytesBtoA: 0,
            turns: 0,
            startTime: Date.now(),
            endTime: null
        };

        this.emitLog('info', `Connecting WebSocket bridge between:`, {
            botA: this.config.botAUrl,
            botB: this.config.botBUrl,
            mode: this.config.mode,
            initiator: this.config.initiator
        });

        try {
            await Promise.all([
                this.connectBotA(),
                this.connectBotB()
            ]);

            this.status = 'active';
            this.emitStatus();
            this.emitLog('success', `Both Bot WebSockets connected successfully! Starting conversation...`);

            // Kick-off initiator turn
            this.triggerInitiator();
        } catch (err) {
            this.status = 'error';
            this.emitLog('error', `Bridge connection failed: ${err.message}`);
            this.stop(err.message);
            throw err;
        }
    }

    connectBotA() {
        return new Promise((resolve, reject) => {
            try {
                this.wsA = new WebSocket(this.config.botAUrl);

                this.wsA.on('open', () => {
                    this.emitLog('info', `✅ Connected to ${this.config.nameA} [${this.config.botAUrl}]`);
                    this.emit('socket_open', { target: 'botA' });
                    resolve();
                });

                this.wsA.on('message', (data, isBinary) => {
                    this.handleMessageFromA(data, isBinary);
                });

                this.wsA.on('close', (code, reason) => {
                    this.emitLog('warn', `${this.config.nameA} disconnected (code: ${code})`);
                    if (this.status === 'active') {
                        this.stop(`Bot A disconnected (code ${code})`);
                    }
                });

                this.wsA.on('error', (err) => {
                    this.emitLog('error', `${this.config.nameA} socket error: ${err.message}`);
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    connectBotB() {
        return new Promise((resolve, reject) => {
            try {
                this.wsB = new WebSocket(this.config.botBUrl);

                this.wsB.on('open', () => {
                    this.emitLog('info', `✅ Connected to ${this.config.nameB} [${this.config.botBUrl}]`);
                    this.emit('socket_open', { target: 'botB' });
                    resolve();
                });

                this.wsB.on('message', (data, isBinary) => {
                    this.handleMessageFromB(data, isBinary);
                });

                this.wsB.on('close', (code, reason) => {
                    this.emitLog('warn', `${this.config.nameB} disconnected (code: ${code})`);
                    if (this.status === 'active') {
                        this.stop(`Bot B disconnected (code ${code})`);
                    }
                });

                this.wsB.on('error', (err) => {
                    this.emitLog('error', `${this.config.nameB} socket error: ${err.message}`);
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    triggerInitiator() {
        const isBotA = this.config.initiator === 'botA';
        const targetWs = isBotA ? this.wsA : this.wsB;
        const targetName = isBotA ? this.config.nameA : this.config.nameB;

        this.emitLog('info', `🚀 Signaling Initiator: ${targetName}`);

        if (this.config.mode === 'json') {
            const initPayload = JSON.stringify({
                event: 'start_conversation',
                role: 'initiator',
                message: 'Hello'
            });
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(initPayload);
            }
        } else {
            // In audio mode, signal start frame
            const initAudioFrame = JSON.stringify({
                event: 'start',
                streamSid: `bridge_${Date.now()}`
            });
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(initAudioFrame);
            }
        }
    }

    handleMessageFromA(data, isBinary) {
        if (this.status !== 'active') return;

        this.stats.packetsAtoB++;
        const byteLen = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
        this.stats.bytesAtoB += byteLen;
        this.activeSpeaker = 'botA';

        if (this.config.mode === 'json') {
            this.handleJsonTurn('botA', data);
        } else {
            this.handleAudioRelay('botA', data, isBinary);
        }
    }

    handleMessageFromB(data, isBinary) {
        if (this.status !== 'active') return;

        this.stats.packetsBtoA++;
        const byteLen = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
        this.stats.bytesBtoA += byteLen;
        this.activeSpeaker = 'botB';

        if (this.config.mode === 'json') {
            this.handleJsonTurn('botB', data);
        } else {
            this.handleAudioRelay('botB', data, isBinary);
        }
    }

    handleJsonTurn(from, rawData) {
        let text = '';
        let parsed = null;
        const rawStr = rawData.toString();

        try {
            parsed = JSON.parse(rawStr);
            text = parsed.text || parsed.message || parsed.transcript || parsed.content || rawStr;
        } catch {
            text = rawStr;
            parsed = { text: rawStr };
        }

        // Avoid blank or internal control messages
        if (!text || typeof text !== 'string' || text.trim().length === 0) return;
        if (parsed && (parsed.event === 'ping' || parsed.event === 'pong' || parsed.event === 'ack')) return;

        const isFromA = from === 'botA';
        const senderName = isFromA ? this.config.nameA : this.config.nameB;
        const recipientWs = isFromA ? this.wsB : this.wsA;
        const recipientName = isFromA ? this.config.nameB : this.config.nameA;

        this.turnCount++;
        this.stats.turns = this.turnCount;

        const turnRecord = {
            turn: this.turnCount,
            from: isFromA ? 'botA' : 'botB',
            senderName,
            recipientName,
            text: text.trim(),
            timestamp: new Date().toLocaleTimeString()
        };

        this.history.push(turnRecord);
        this.emit('turn', turnRecord);
        this.emitLog('turn', `[Turn ${this.turnCount}] ${senderName} ➔ ${recipientName}: "${text.trim()}"`);

        // Check for max turns
        if (this.turnCount >= this.config.maxTurns) {
            this.emitLog('warn', `🛑 Maximum conversation turns (${this.config.maxTurns}) reached. Ending session.`);
            setTimeout(() => this.stop('Max turns reached'), 500);
            return;
        }

        // Check for farewell/termination intent
        if (/\b(goodbye|bye bye|have a great day|call you later|thank you goodbye)\b/i.test(text) && this.turnCount >= 4) {
            this.emitLog('info', `🏁 Concluding phrase detected ("${text.trim()}"). Conversation completed successfully.`);
            setTimeout(() => this.stop('Conversation concluded naturally'), 1200);
        }

        // Relay to other bot
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            // Forward payload format
            const payload = JSON.stringify({
                event: 'user_utterance',
                speaker: senderName,
                text: text.trim()
            });
            recipientWs.send(payload);
        }
    }

    handleAudioRelay(from, data, isBinary) {
        const isFromA = from === 'botA';
        const recipientWs = isFromA ? this.wsB : this.wsA;

        // Relay raw binary or framed JSON chunk
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            recipientWs.send(data, { binary: isBinary });
        }

        this.emit('audio_chunk', {
            from: isFromA ? 'botA' : 'botB',
            bytes: Buffer.isBuffer(data) ? data.length : data.length
        });

        // Simple turn tracker based on audio packet stream pauses
        if (this.audioSilenceTimer) clearTimeout(this.audioSilenceTimer);
        this.audioSilenceTimer = setTimeout(() => {
            this.activeSpeaker = null;
            this.emit('speech_pause', { lastSpeaker: from });
        }, 800);
    }

    stop(reason = 'User stopped') {
        if (this.status === 'idle') return;

        this.status = 'completed';
        this.stats.endTime = Date.now();
        this.activeSpeaker = null;

        if (this.audioSilenceTimer) {
            clearTimeout(this.audioSilenceTimer);
            this.audioSilenceTimer = null;
        }

        if (this.wsA) {
            try { this.wsA.close(); } catch {}
            this.wsA = null;
        }
        if (this.wsB) {
            try { this.wsB.close(); } catch {}
            this.wsB = null;
        }

        this.emitLog('info', `Bridge session stopped. Reason: ${reason}`);
        this.emit('completed', {
            reason,
            turns: this.turnCount,
            history: this.history,
            stats: this.stats
        });
        this.emitStatus();
    }

    getStatus() {
        return {
            status: this.status,
            config: this.config,
            turnCount: this.turnCount,
            activeSpeaker: this.activeSpeaker,
            stats: this.stats,
            history: this.history,
            sockets: {
                botA: this.wsA ? this.wsA.readyState === WebSocket.OPEN : false,
                botB: this.wsB ? this.wsB.readyState === WebSocket.OPEN : false
            }
        };
    }

    emitStatus() {
        this.emit('status_change', this.getStatus());
    }

    emitLog(level, message, data = null) {
        const logEntry = {
            time: new Date().toLocaleTimeString(),
            level,
            message,
            data
        };
        this.emit('log', logEntry);
    }
}

module.exports = new BotBridge();

