const WebSocket = require('ws');

class MockBotServers {
    constructor() {
        this.wssA = null; // Port 5001: Hospital Target Bot
        this.wssB = null; // Port 5002: Patient Tester Bot
        this.portA = 5001;
        this.portB = 5002;
        this.isRunning = false;
    }

    start(portA = 5001, portB = 5002) {
        if (this.isRunning) return;
        this.portA = portA;
        this.portB = portB;

        // -------------------------------------------------------------
        // Bot A: Hospital Bot (Port 5001)
        // -------------------------------------------------------------
        this.wssA = new WebSocket.Server({ port: this.portA }, () => {
            console.log(`🏥 [Mock Bot A] Hospital Bot WebSocket listening on ws://localhost:${this.portA}`);
        });

        this.wssA.on('connection', (ws) => {
            console.log(`🏥 [Mock Bot A] Client connected to Hospital Bot`);

            ws.on('message', (raw) => {
                let msgText = '';
                try {
                    const parsed = JSON.parse(raw.toString());
                    msgText = parsed.text || parsed.message || raw.toString();
                    if (parsed.event === 'start_conversation') {
                        // Initiator trigger
                        setTimeout(() => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    speaker: "Bot A (Hospital)",
                                    text: "Hello! Welcome to City Care Medical Center. How can I help you today?"
                                }));
                            }
                        }, 500);
                        return;
                    }
                } catch {
                    msgText = raw.toString();
                }

                console.log(`🏥 [Mock Bot A Received]: "${msgText}"`);

                // Simulated Hospital Bot Conversational Logic
                let reply = "";
                const lower = msgText.toLowerCase();

                if (/appointment|book|doctor|consult|checkup/i.test(lower)) {
                    reply = "I can certainly help you book an appointment. Which department or doctor would you like to consult with?";
                } else if (/meena|physician|cardio|specialist|general/i.test(lower)) {
                    reply = "Dr. Meena has an open consultation slot tomorrow at 4:00 PM. Would that time work for you?";
                } else if (/yes|works|perfect|confirm|4 pm|fine/i.test(lower)) {
                    reply = "Great! Your appointment with Dr. Meena is confirmed for tomorrow at 4:00 PM. Is there anything else I can assist you with?";
                } else if (/no|everything|that's all|thank you|thanks/i.test(lower)) {
                    reply = "You are most welcome! Thank you for choosing City Care Medical Center. Have a wonderful day, goodbye!";
                } else {
                    reply = "I understand. Could you please confirm if you would like to proceed with this booking?";
                }

                // Simulate human-like speech latency (600ms - 1000ms)
                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            speaker: "Bot A (Hospital)",
                            text: reply
                        }));
                    }
                }, 750);
            });
        });

        // -------------------------------------------------------------
        // Bot B: Patient Tester Bot (Port 5002)
        // -------------------------------------------------------------
        this.wssB = new WebSocket.Server({ port: this.portB }, () => {
            console.log(`🧑 [Mock Bot B] Patient Tester Bot WebSocket listening on ws://localhost:${this.portB}`);
        });

        this.wssB.on('connection', (ws) => {
            console.log(`🧑 [Mock Bot B] Client connected to Patient Tester Bot`);

            ws.on('message', (raw) => {
                let msgText = '';
                try {
                    const parsed = JSON.parse(raw.toString());
                    msgText = parsed.text || parsed.message || raw.toString();
                    if (parsed.event === 'start_conversation') {
                        setTimeout(() => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    speaker: "Bot B (Patient)",
                                    text: "Hello, I would like to book an appointment for a health checkup."
                                }));
                            }
                        }, 500);
                        return;
                    }
                } catch {
                    msgText = raw.toString();
                }

                console.log(`🧑 [Mock Bot B Received]: "${msgText}"`);

                // Simulated Patient Tester Conversational Logic
                let reply = "";
                const lower = msgText.toLowerCase();

                if (/help you|assist|welcome/i.test(lower)) {
                    reply = "Hello, I need to book a consultation with Dr. Meena for a general checkup.";
                } else if (/which department|which doctor|specialist/i.test(lower)) {
                    reply = "Dr. Meena, general physician please.";
                } else if (/slot|tomorrow|4:00|time work/i.test(lower)) {
                    reply = "Yes, tomorrow at 4:00 PM works perfectly for me.";
                } else if (/anything else|other/i.test(lower)) {
                    reply = "No, that is everything. Thank you so much for your assistance!";
                } else if (/goodbye|have a wonderful day|welcome/i.test(lower)) {
                    reply = "Thank you, goodbye!";
                } else {
                    reply = "Yes, please confirm that.";
                }

                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            speaker: "Bot B (Patient)",
                            text: reply
                        }));
                    }
                }, 850);
            });
        });

        this.isRunning = true;
    }

    stop() {
        if (!this.isRunning) return;
        if (this.wssA) {
            try { this.wssA.close(); } catch {}
            this.wssA = null;
        }
        if (this.wssB) {
            try { this.wssB.close(); } catch {}
            this.wssB = null;
        }
        this.isRunning = false;
        console.log("🛑 [Mock Bots] Mock Bot WebSocket servers stopped.");
    }
}

const mockServers = new MockBotServers();

if (require.main === module) {
    mockServers.start();
    console.log("Mock Bot servers running. Press Ctrl+C to terminate.");
}

module.exports = mockServers;

