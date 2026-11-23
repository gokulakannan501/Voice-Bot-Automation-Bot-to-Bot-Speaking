require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const botBridge = require('./bridge/botBridge');
const mockBots = require('./bridge/mockBots');
const caredeskConnector = require('./bridge/caredeskDirectConnector');
const qaBatchRunner = require('./engine/qaBatchRunner');

const app = express();
const PORT = process.env.BRIDGE_PORT || 4002;

process.on('uncaughtException', (err) => {
    console.error('⚠️ [Server] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ [Server] Unhandled Rejection:', reason);
});

app.use(express.json());
// Root route loads the Bridge Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bridge.html'));
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/recordings', express.static(path.join(__dirname, 'recordings')));
app.use('/reports', express.static(path.join(__dirname, 'reports')));

// SSE Clients for real-time UI streaming
const sseClients = new Set();

function broadcastSSE(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(payload);
        } catch {
            sseClients.delete(client);
        }
    }
}

// Intercept console.log to broadcast speech turns to dashboard in real-time
const originalConsoleLog = console.log;
console.log = function (...args) {
    originalConsoleLog(...args);
    const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');

    // Detect Target Bot or AI Tester spoken turn
    if (text.includes('🤖 [Target Bot]:') || text.includes('🤖 [Target Bot Opening]:')) {
        const clean = text.replace(/🤖 \[(Target Bot.*?)]: /g, '').replace(/^"|"$/g, '').trim();
        broadcastSSE('turn', {
            turn: 'Target Bot',
            from: 'botA',
            senderName: 'CareDesk (Hospital)',
            recipientName: 'AI Patient Tester',
            text: clean,
            timestamp: new Date().toLocaleTimeString()
        });
    } else if (text.includes('🧑 [AI Tester]:')) {
        const clean = text.replace(/🧑 \[AI Tester]: /g, '').replace(/^"|"$/g, '').trim();
        broadcastSSE('turn', {
            turn: 'AI Patient',
            from: 'botB',
            senderName: 'AI Patient Tester',
            recipientName: 'CareDesk (Hospital)',
            text: clean,
            timestamp: new Date().toLocaleTimeString()
        });
    }

    broadcastSSE('log', {
        time: new Date().toLocaleTimeString(),
        level: 'info',
        message: text
    });
};

// Subscribe to BotBridge Events
botBridge.on('status_change', (status) => broadcastSSE('status', status));
botBridge.on('turn', (turn) => broadcastSSE('turn', turn));
botBridge.on('log', (log) => broadcastSSE('log', log));
botBridge.on('audio_chunk', (chunk) => broadcastSSE('audio_chunk', chunk));
botBridge.on('completed', (result) => broadcastSSE('completed', result));

// Subscribe to CareDesk Connector Events
caredeskConnector.on('log', (log) => broadcastSSE('log', log));
caredeskConnector.on('turn', (turn) => broadcastSSE('turn', turn));
caredeskConnector.on('status_change', (status) => broadcastSSE('caredesk_status', status));
caredeskConnector.on('completed', (result) => broadcastSSE('completed', result));
caredeskConnector.on('recording_saved', (rec) => broadcastSSE('recording_saved', rec));

// Subscribe to QA Batch Runner Events
qaBatchRunner.on('start', (data) => broadcastSSE('qa_start', data));
qaBatchRunner.on('test_start', (data) => broadcastSSE('qa_test_start', data));
qaBatchRunner.on('test_complete', (data) => broadcastSSE('qa_test_complete', data));
qaBatchRunner.on('finish', (data) => broadcastSSE('qa_finish', data));
qaBatchRunner.on('log', (data) => broadcastSSE('log', data));

// SSE Endpoint
app.get('/api/bridge/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 2000\n\n');

    // Send initial status immediately
    res.write(`event: status\ndata: ${JSON.stringify(botBridge.getStatus())}\n\n`);
    res.write(`event: mock_status\ndata: ${JSON.stringify({ isRunning: mockBots.isRunning })}\n\n`);
    res.write(`event: caredesk_status\ndata: ${JSON.stringify(caredeskConnector.getStatus())}\n\n`);
    res.write(`event: qa_status\ndata: ${JSON.stringify(qaBatchRunner.getStatus())}\n\n`);

    sseClients.add(res);

    req.on('close', () => {
        sseClients.delete(res);
    });
});

// Start CareDesk Direct Voice Bot-to-Bot Session
app.post('/api/caredesk/start', async (req, res) => {
    try {
        const targetUrl = req.body.targetUrl || process.env.TARGET_BOT_WS_URL;
        const options = req.body.options || {};
        await caredeskConnector.start(targetUrl, options);
        res.json({ success: true, message: 'CareDesk Direct session started', status: caredeskConnector.getStatus() });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Stop CareDesk Direct Session
app.post('/api/caredesk/stop', (req, res) => {
    try {
        caredeskConnector.stop('User stopped from Dashboard UI');
        res.json({ success: true, message: 'CareDesk Direct session stopped' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/caredesk/status', (req, res) => {
    res.json(caredeskConnector.getStatus());
});

// List all saved conversation audio recordings
app.get('/api/recordings', (req, res) => {
    try {
        const dir = path.join(__dirname, 'recordings');
        if (!fs.existsSync(dir)) return res.json({ recordings: [] });
        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.wav'))
            .map(f => {
                const stat = fs.statSync(path.join(dir, f));
                const durationSec = Math.max(0, (stat.size - 44) / 16000).toFixed(1);
                return {
                    filename: f,
                    url: `/recordings/${f}`,
                    durationSec: Number(durationSec),
                    sizeBytes: stat.size,
                    sizeKb: Math.round(stat.size / 1024),
                    createdAt: stat.birthtime
                };
            })
            .sort((a, b) => b.createdAt - a.createdAt);
        res.json({ recordings: files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// QA BATCH RUNNER AUTOMATED SUITE ENDPOINTS
// ==========================================
app.get('/api/qa/scenarios', (req, res) => {
    try {
        const dataset = qaBatchRunner.getDataset();
        res.json({
            metadata: dataset.metadata,
            categories: dataset.metadata.categories,
            tests: dataset.tests
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/qa/run', async (req, res) => {
    try {
        const { category, ids, limit, targetBotUrl } = req.body;
        // Background execution so HTTP returns immediately
        qaBatchRunner.run({ category, ids, limit, targetBotUrl }).catch(err => {
            console.error('[QA Runner Error]:', err.message);
        });
        res.json({ success: true, message: 'QA Batch run initiated', status: qaBatchRunner.getStatus() });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

app.post('/api/qa/stop', (req, res) => {
    try {
        qaBatchRunner.stop();
        res.json({ success: true, message: 'QA run stop requested' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/qa/status', (req, res) => {
    res.json(qaBatchRunner.getStatus());
});

app.get('/api/qa/reports', (req, res) => {
    try {
        const dir = path.join(__dirname, 'reports');
        if (!fs.existsSync(dir)) return res.json({ reports: [] });
        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const fullPath = path.join(dir, f);
                const stat = fs.statSync(fullPath);
                try {
                    const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                    return {
                        id: f.replace('.json', ''),
                        summary: content.summary,
                        createdAt: stat.birthtime,
                        jsonUrl: `/reports/${f}`,
                        mdUrl: `/reports/${f.replace('.json', '.md')}`
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean)
            .sort((a, b) => b.createdAt - a.createdAt);
        res.json({ reports: files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/qa/report/:id', (req, res) => {
    try {
        const { id } = req.params;
        const jsonPath = path.join(__dirname, 'reports', `${id}.json`);
        const mdPath = path.join(__dirname, 'reports', `${id}.md`);
        if (fs.existsSync(jsonPath)) {
            const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
            res.json({ success: true, data, markdown: md });
        } else {
            res.status(404).json({ error: 'Report not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Start Generic Bridge Session
app.post('/api/bridge/start', async (req, res) => {
    try {
        const { botAUrl, botBUrl, mode, initiator, maxTurns, nameA, nameB } = req.body;
        await botBridge.start({ botAUrl, botBUrl, mode, initiator, maxTurns, nameA, nameB });
        res.json({ success: true, message: 'Bridge started successfully', status: botBridge.getStatus() });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Stop Generic Bridge Session
app.post('/api/bridge/stop', (req, res) => {
    try {
        botBridge.stop('Manually stopped from Dashboard UI');
        res.json({ success: true, message: 'Bridge stopped', status: botBridge.getStatus() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Current Bridge Status
app.get('/api/bridge/status', (req, res) => {
    res.json({
        bridge: botBridge.getStatus(),
        mocks: {
            isRunning: mockBots.isRunning,
            portA: mockBots.portA,
            portB: mockBots.portB
        },
        caredesk: caredeskConnector.getStatus()
    });
});

// Start Mock Bots
app.post('/api/mocks/start', (req, res) => {
    try {
        const portA = req.body.portA || 5001;
        const portB = req.body.portB || 5002;
        mockBots.start(portA, portB);
        broadcastSSE('mock_status', { isRunning: true, portA, portB });
        res.json({ success: true, message: `Mock bots started on ports ${portA} and ${portB}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Stop Mock Bots
app.post('/api/mocks/stop', (req, res) => {
    try {
        mockBots.stop();
        broadcastSSE('mock_status', { isRunning: false });
        res.json({ success: true, message: 'Mock bots stopped' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Optional: auto-start mocks with CLI flag --with-mocks
if (process.argv.includes('--with-mocks')) {
    mockBots.start(5001, 5002);
}

const server = app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🤖 WebSocket Bot-to-Bot Bridge POC Server`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`🎯 Target Bot: ${process.env.TARGET_BOT_WS_URL || 'configured in UI'}`);
    console.log(`======================================================\n`);
});

// Clean shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    botBridge.stop('Server shutdown');
    caredeskConnector.stop('Server shutdown');
    mockBots.stop();
    server.close(() => process.exit(0));
});
