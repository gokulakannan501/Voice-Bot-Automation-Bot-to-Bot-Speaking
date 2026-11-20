# 🤖 Voice Bot-to-Bot QA Studio & WebSocket Orchestration POC

A specialized platform for connecting **two arbitrary WebSocket URLs** or directly connecting an **AI Patient Stress Tester** to a target hospital voice bot (e.g. CareDesk) over Exotel AgentStream 8000 Hz Linear PCM audio.

---

## 🌟 Key Features

* **Direct CareDesk Voice Testing (Zero Phone Call Cost)**:
  * Connects directly to CareDesk's `/ws/audio` WebSocket stream with full Exotel AgentStream protocol compatibility (`pcm_s16le, 8000 Hz`).
* **Adversarial Red-Team & Chaos Engine**:
  * 💥 **Extreme Chaos**: Contradictions, mind-changes, and bizarre medical complaints to probe state machine vulnerabilities.
  * 🌐 **Multilingual Code-Switching**: Mixes Kannada, English, and Hindi (Kanglish/Hinglish) to test speech recognition and translation limits.
  * 🔀 **Rapid Intent Flips**: Shifts between booking, cancellation, and rescheduling across turns.
  * 📢 **Acoustic & Conversational Noise Simulation**: Injects realistic telephony line static, 50 Hz hum, room murmurs, and conversational hesitations/interruptions.
  * 🛡️ **Guardrail Probing**: Attempts prompt injection and tests bot self-awareness boundaries.
* **Full Conversation Audio Recording**:
  * Stitches both sides of the live audio stream into a standard 16-bit 8000 Hz Linear PCM `.wav` file saved directly to `recordings/`.
  * Integrated in-browser playback scrubber and one-click download.
* **Dual-WebSocket Stream Bridge**:
  * Connects any two external WebSocket bots (`ws://` or `wss://`), relaying JSON text or raw PCM audio with turn-taking orchestration.
* **Modern Classic Studio UI**:
  * Interactive dark-mode dashboard with avatars, turn chips, live duration timer, and real-time SSE stream log.

---

## 📁 Project Structure

```
Bot-To-Bot-WebSocket-POC/
├── bridge/
│   ├── botBridge.js        # Core dual-WebSocket bridge engine
│   └── mockBots.js         # Built-in Hospital & Patient WebSocket servers (5001 & 5002)
├── public/
│   └── bridge.html         # Interactive split-screen Web Dashboard
├── server_bridge.js        # Express & SSE server for the POC (Port 4002)
├── tests/
│   └── test_bridge.js      # Automated unit test for WebSocket bridge
├── start_bridge.bat        # One-click Windows launcher
└── package.json
```

---

## 🚀 Quick Start (Local Demo with Mock Bots)

### 1. One-Click Launch (Windows)
Double-click `start_bridge.bat` or run:
```powershell
.\start_bridge.bat
```
This automatically:
1. Clears ports `4002`, `5001`, and `5002`.
2. Starts the Bridge server and both Mock Bots.
3. Opens `http://localhost:4002` in your default browser.

### 2. Manual CLI Launch
```bash
# Start server with mock bots pre-loaded:
npm start

# Or using Node directly:
node server_bridge.js --with-mocks
```

Open **http://localhost:4002** in your browser. Click **"🚀 Start Conversation"** to watch Bot A and Bot B converse!

---

## 🧪 Automated Test Verification

Run the automated end-to-end verification script:
```powershell
npm run test:bridge
```

---

## 🔌 Connecting to Real External Voice Bots

To test against your real target bot or telephony provider:

1. In the Web Dashboard (or in API request to `/api/bridge/start`):
   - Set **Bot A WS URL**: `wss://your-target-voicebot.com/stream`
   - Set **Bot B WS URL**: `wss://your-tester-bot.com/stream` (or your local tester server)
2. Select your **Mode** (`JSON / Transcript` or `Raw PCM Audio`).
3. Choose the **Initiator** (who speaks first).
4. Click **Start Conversation**.
