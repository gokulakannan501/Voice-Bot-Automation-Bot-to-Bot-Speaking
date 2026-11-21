require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const llm = require('../services/llmService');

async function test() {
    const symptoms = [
        { category: 'heel pain', description: 'sharp heel pain and morning stiffness', woundOrInfection: 'It is severe heel pain, not an open wound.' },
        { category: 'foot wound', description: 'a small open wound on my right big toe that is not healing', woundOrInfection: 'It is a small wound on the bottom of my right big toe.' },
        { category: 'toenail infection', description: 'painful swelling and redness around my left toenail', woundOrInfection: 'It is an infection around my toenail.' }
    ];

    for (const sym of symptoms) {
        console.log(`\n=================== Testing: ${sym.category} ===================`);
        const state = {
            scenario: 'Booking',
            history: [
                { role: 'user', content: 'Welcome to Food Secure. Book appointment?' },
                { role: 'assistant', content: 'I want to book an appointment for myself.' },
                { role: 'user', content: 'May I know your name?' },
                { role: 'assistant', content: 'My name is Gokulakannan.' },
                { role: 'user', content: 'Do you have diabetes?' },
                { role: 'assistant', content: 'No, I do not have diabetes.' }
            ],
            footSymptom: sym,
            symptom: sym.description
        };

        const careDeskQuestion1 = "To help you find the right specialist, could you please tell me, is it a wound or an infection on the foot or some other issue?";
        const r1 = await llm.processCustomerIntent(careDeskQuestion1, state);
        console.log(`Q1: "${careDeskQuestion1}"`);
        console.log(`A1: "${r1.replyText}"`);

        state.history.push({ role: 'user', content: careDeskQuestion1 });
        state.history.push({ role: 'assistant', content: r1.replyText });

        const careDeskQuestion2 = "Could you please tell me a little more about the problem with your foot?";
        const r2 = await llm.processCustomerIntent(careDeskQuestion2, state);
        console.log(`Q2: "${careDeskQuestion2}"`);
        console.log(`A2: "${r2.replyText}"`);
    }
}

test().catch(console.error);
