require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const llm = require('../services/llmService');

async function testNegotiation() {
    console.log('Testing Patient Date/Time Negotiation...');

    const state = {
        scenario: 'Booking',
        history: [
            { role: 'user', content: 'Welcome to Food Secure. Would you like to book an appointment?' },
            { role: 'assistant', content: 'I would like to book an appointment for myself.' },
            { role: 'user', content: 'May I know your full name?' },
            { role: 'assistant', content: 'My name is Gokulakannan.' },
            { role: 'user', content: 'Could you please tell me your age?' },
            { role: 'assistant', content: 'I am 30 years old.' },
            { role: 'user', content: 'Could you please tell me your gender?' },
            { role: 'assistant', content: 'I am male.' },
            { role: 'user', content: 'Do you have diabetes?' },
            { role: 'assistant', content: 'No, I do not have diabetes.' },
            { role: 'user', content: 'Is it a wound or an infection on the foot or some other issue?' },
            { role: 'assistant', content: 'I have sharp pain in my heel and arch, especially when I walk in the morning.' },
            { role: 'user', content: 'When would you like to schedule your appointment?' },
            { role: 'assistant', content: 'I would like to come in on Sunday, November 29.' }
        ],
        footSymptom: {
            category: 'heel pain',
            summary: 'Heel Pain & Morning Stiffness',
            description: 'sharp pain in my heel and arch, especially when I take my first steps in the morning',
            woundOrInfection: "It's severe pain in my heel and arch, not an open wound or infection."
        }
    };

    // Turn 10: CareDesk says November 29 is unavailable and offers alternative dates
    const careDeskOffer = "I apologize, but there are no doctors available on the 29th of November. The next available dates are Monday, the 23rd of November, Tuesday, the 24th, and Wednesday, the 25th. Which one would you prefer?";
    console.log('\n🤖 CareDesk:', careDeskOffer);

    const reply1 = await llm.processCustomerIntent(careDeskOffer, state);
    console.log('🧑 AI Patient:', reply1.replyText);

    // Verify it negotiated and didn't stubbornly repeat Nov 29
    if (/specifically need|only november 29|insist/i.test(reply1.replyText)) {
        console.error('❌ FAILED: AI patient still rigidly insisted on November 29!');
        process.exit(1);
    }
    console.log('✅ Negotiation test passed: AI patient did not rigidly refuse!');

    // Turn 12: CareDesk offers slot with doctor
    state.history.push({ role: 'user', content: careDeskOffer });
    state.history.push({ role: 'assistant', content: reply1.replyText });

    const careDeskSlot = "The available slot with Dr. Govind Raj on Monday, the 23rd of November is at 9:00 in the morning. Would you like to confirm this appointment?";
    console.log('\n🤖 CareDesk:', careDeskSlot);

    const reply2 = await llm.processCustomerIntent(careDeskSlot, state);
    console.log('🧑 AI Patient:', reply2.replyText);

    if (!/confirm|yes|works|please/i.test(reply2.replyText)) {
        console.error('❌ FAILED: AI patient did not confirm slot!');
        process.exit(1);
    }
    console.log('✅ Confirmation test passed: AI patient confirmed slot gracefully!');

    console.log('\n🎉 Negotiation & booking confirmation verified successfully!');
}

testNegotiation().catch(console.error);
