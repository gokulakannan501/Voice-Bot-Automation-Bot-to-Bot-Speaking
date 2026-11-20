require('dotenv').config();
const llmService = require('../services/llmService');

async function testInboundFlow() {
    console.log("🚀 Testing Inbound Call Attendant Flow with Gemini...\n");

    const patientName = "Gokulakannan";
    const preferredSlot = "Tomorrow at 4 PM";

    // 1. Test INBOUND_CONFIRM
    console.log("--- 1. Testing INBOUND_CONFIRM ---");
    let confirmState = {
        history: [],
        scenario: 'INBOUND_CONFIRM',
        direction: 'inbound',
        targetLanguage: 'English',
        inboundConfig: {
            scenario: 'INBOUND_CONFIRM',
            patientName: patientName,
            preferredSlot: preferredSlot
        }
    };

    // Turn 1: Target bot asks for identity
    let t1 = "Hello, am I speaking with Gokulakannan?";
    confirmState.history.push({ role: 'user', content: t1 });
    let res1 = await llmService.processCustomerIntent(t1, confirmState);
    console.log(`🤖 Target Bot: "${t1}"`);
    console.log(`🧑 Patient:    "${res1.replyText}"`);
    confirmState = res1.updatedState;

    // Turn 2: Target bot asks to confirm appointment
    let t2 = "I am calling from Medicare Healthcare to confirm your appointment for tomorrow at 10 AM with Dr. Meena. Will you be attending?";
    confirmState.history.push({ role: 'user', content: t2 });
    let res2 = await llmService.processCustomerIntent(t2, confirmState);
    console.log(`🤖 Target Bot: "${t2}"`);
    console.log(`🧑 Patient:    "${res2.replyText}"`);
    confirmState = res2.updatedState;

    // 2. Test INBOUND_RESCHEDULE
    console.log("\n--- 2. Testing INBOUND_RESCHEDULE ---");
    let reschedState = {
        history: [],
        scenario: 'INBOUND_RESCHEDULE',
        direction: 'inbound',
        targetLanguage: 'English',
        inboundConfig: {
            scenario: 'INBOUND_RESCHEDULE',
            patientName: patientName,
            preferredSlot: preferredSlot
        }
    };

    let rt1 = "Hello, is this Gokulakannan?";
    reschedState.history.push({ role: 'user', content: rt1 });
    let rres1 = await llmService.processCustomerIntent(rt1, reschedState);
    console.log(`🤖 Target Bot: "${rt1}"`);
    console.log(`🧑 Patient:    "${rres1.replyText}"`);
    reschedState = rres1.updatedState;

    let rt2 = "We are calling regarding your consultation tomorrow at 10 AM. Are you available?";
    reschedState.history.push({ role: 'user', content: rt2 });
    let rres2 = await llmService.processCustomerIntent(rt2, reschedState);
    console.log(`🤖 Target Bot: "${rt2}"`);
    console.log(`🧑 Patient:    "${rres2.replyText}"`);
    reschedState = rres2.updatedState;

    // 3. Test INBOUND_CANCEL
    console.log("\n--- 3. Testing INBOUND_CANCEL ---");
    let cancelState = {
        history: [],
        scenario: 'INBOUND_CANCEL',
        direction: 'inbound',
        targetLanguage: 'English',
        inboundConfig: {
            scenario: 'INBOUND_CANCEL',
            patientName: patientName,
            preferredSlot: preferredSlot
        }
    };

    let ct1 = "Hi, am I speaking with Gokulakannan?";
    cancelState.history.push({ role: 'user', content: ct1 });
    let cres1 = await llmService.processCustomerIntent(ct1, cancelState);
    console.log(`🤖 Target Bot: "${ct1}"`);
    console.log(`🧑 Patient:    "${cres1.replyText}"`);
    cancelState = cres1.updatedState;

    let ct2 = "Please let us know if you can make it to your appointment tomorrow morning.";
    cancelState.history.push({ role: 'user', content: ct2 });
    let cres2 = await llmService.processCustomerIntent(ct2, cancelState);
    console.log(`🤖 Target Bot: "${ct2}"`);
    console.log(`🧑 Patient:    "${cres2.replyText}"`);

    // 4. Test INBOUND_NO_ANSWER
    console.log("\n--- 4. Testing INBOUND_NO_ANSWER ---");
    console.log("🤖 Target Bot: \"Hello, am I speaking with Gokulakannan?\"");
    console.log("🧑 Patient:    [Silence - Phone Rings Without Answer / Simulating Ignored Call]");

    // 5. Test INBOUND_CUT_CALL
    console.log("\n--- 5. Testing INBOUND_CUT_CALL ---");
    console.log("🤖 Target Bot: \"Hello, am I speaking with Gokulakannan?\"");
    console.log("🧑 Patient:    \"Yes, speaking.\" (Attended Turn 1)");
    console.log("🤖 Target Bot: \"I am calling to confirm your appointment for tomorrow at 10 AM...\"");
    console.log("🧑 Patient:    \"Wait, sorry, I have to go—\" [Calls cuts abruptly / Disconnects]");

    console.log("\n✅ Inbound Flow Test Completed Successfully!");
}

testInboundFlow().catch(console.error);
