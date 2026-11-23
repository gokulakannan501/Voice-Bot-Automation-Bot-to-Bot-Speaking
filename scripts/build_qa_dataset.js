/**
 * QA Scenarios Dataset Builder
 * Parses 501 test descriptions provided in the QA test plan into a structured JSON test matrix.
 */
const fs = require('fs');
const path = require('path');

const RAW_FILE = path.join(__dirname, '..', 'scenarios_raw.txt');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'qa_scenarios_dataset.json');

const rawText = fs.readFileSync(RAW_FILE, 'utf8');
const lines = rawText.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('<') && l !== 'Test Description' && l !== 'I want to test all these scenarios');

// Filter system trailer
const validLines = lines.filter(l => 
    !l.startsWith('The current local time') && 
    !l.startsWith('The user\'s current state') && 
    !l.startsWith('Active Document') && 
    !l.startsWith('Cursor is on') && 
    !l.startsWith('Other open documents') && 
    !l.startsWith('- c:') && 
    !l.startsWith('The user has uploaded') && 
    !l.startsWith('You can embed')
);

console.log(`Parsed ${validLines.length} valid scenario lines.`);

// Sample test sentences for acoustic/noise variations
const ACOUSTIC_SENTENCES = [
    "I want to book an appointment with Dr. Govindaraj for heel pain on Wednesday at 2 PM.",
    "My name is Gokulakannan, calling from Indiranagar, phone number is 9876543210.",
    "I have severe pain in my left heel since three days and cannot walk properly.",
    "Could you check if any orthopedic doctor is available on next Monday morning?",
    "I need to reschedule my consultation from November 25 to November 28 please.",
    "Is Dr. Rajesh available tomorrow at 4 PM for a diabetic foot checkup?",
    "My patient ID is 84920 and I need to cancel my appointment today.",
    "Do you accept cash payments or should I pay online via UPI at the clinic?",
    "Please send the booking confirmation SMS to my registered mobile number.",
    "I have numbness and tingling sensation in my toes for the past two weeks."
];

// Sample TTS evaluation sentences
const TTS_SENTENCES = [
    "Welcome to CareDesk Health Services. How may I assist with your appointment today?",
    "Dr. Govindaraj, Orthodontist, has an open consultation slot on Wednesday, November 25th at 2:00 PM.",
    "Your appointment has been successfully scheduled. Your confirmation token is CD-9482.",
    "For severe heel pain and suspected plantar fasciitis, we recommend bringing recent X-ray reports.",
    "Our clinic address is 100 Feet Road, HAL 2nd Stage, Indiranagar, Bengaluru, Karnataka 560038.",
    "Please arrive 15 minutes before your scheduled slot. For assistance, call 080 4736 0196.",
    "The total consultation fee is five hundred rupees, payable at the reception desk."
];

// Multilingual test mappings
const KANNADA_TRANSLATIONS = {
    'When does my policy end?': { kn: 'ನನ್ನ ಪಾಲಿಸಿ ಯಾವಾಗ ಮುಕ್ತಾಯವಾಗುತ್ತದೆ?', en: 'When does my policy end?' },
    'How do I get a new debit card?': { kn: 'ಹೊಸ ಡೆಬಿಟ್ ಕಾರ್ಡ್ ಪಡೆಯುವುದು ಹೇಗೆ?', en: 'How do I get a new debit card?' },
    'What is my loan EMI?': { kn: 'ನನ್ನ ಲೋನ್ ಇಎಂಐ ಎಷ್ಟು?', en: 'What is my loan EMI?' },
    'Will it be delivered today?': { kn: 'ಇವತ್ತು ಡೆಲಿವರಿ ಆಗುತ್ತಾ?', en: 'Will it be delivered today?' },
    'Broadband connection is cut.': { kn: 'ಬ್ರಾಡ್‌ಬ್ಯಾಂಡ್ ಸಂಪರ್ಕ ಕಡಿತಗೊಂಡಿದೆ.', en: 'Broadband connection is cut.' },
    'I need to change my plan.': { kn: 'ನನ್ನ ಪ್ಲಾನ್ ಬದಲಾಯಿಸಬೇಕು.', en: 'I need to change my plan.' },
    'Where is the nearest branch?': { kn: 'ಹತ್ತಿರದ ಶಾಖೆ ಎಲ್ಲಿದೆ?', en: 'Where is the nearest branch?' },
    'When is my return pickup?': { kn: 'ನನ್ನ ರಿಟರ್ನ್ ಪಿಕಪ್ ಯಾವಾಗ?', en: 'When is my return pickup?' },
    'Cashback has not come yet.': { kn: 'ಕ್ಯಾಶ್‌ಬ್ಯಾಕ್ ಇನ್ನೂ ಬಂದಿಲ್ಲ.', en: 'Cashback has not come yet.' },
    'Which documents are needed to open an account?': { kn: 'ಖಾತೆ ತೆರೆಯಲು ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು?', en: 'Which documents are needed to open an account?' },
    'Is my ticket confirmed?': { kn: 'ನನ್ನ ಟಿಕೆಟ್ ಖಚಿತವಾಗಿದೆಯೇ?', en: 'Is my ticket confirmed?' },
    'Stop the auto debit.': { kn: 'ಆಟೋ ಡೆಬಿಟ್ ನಿಲ್ಲಿಸಿ.', en: 'Stop the auto debit.' },
    'My data is getting over quickly.': { kn: 'ನನ್ನ ಡೇಟಾ ಬೇಗ ಮುಗಿಯುತ್ತಿದೆ.', en: 'My data is getting over quickly.' },
    'Guru, when will the order come?': { kn: 'ಗುರು, ಆರ್ಡರ್ ಯಾವಾಗ ಬರುತ್ತೆ?', en: 'Guru, when will the order come?' },
    'Where is my parcel?': { kn: 'ನನ್ನ ಪಾರ್ಸಲ್ ಎಲ್ಲಿದೆ?', en: 'Where is my parcel?' },
    'Money hasn\'t come yet.': { kn: 'ಹಣ ಇನ್ನೂ ಬಂದಿಲ್ಲ.', en: 'Money hasn\'t come yet.' },
    'Where is my order, sir?': { kn: 'ನನ್ನ ಆರ್ಡರ್ ಎಲ್ಲಿದೆ ಸಾರ್?', en: 'Where is my order, sir?' },
    'Please do it a bit fast.': { kn: 'ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಬೇಗ ಮಾಡಿ.', en: 'Please do it a bit fast.' },
    'Why is my bill so high?': { kn: 'ನನ್ನ ಬಿಲ್ ಏಕೆ ಇಷ್ಟು ಹೆಚ್ಚಾಗಿದೆ?', en: 'Why is my bill so high?' },
    'What happened to my refund status?': { kn: 'ನನ್ನ ಮರುಪಾವತಿ ಸ್ಥಿತಿಗೆ ಏನಾಯಿತು?', en: 'What happened to my refund status?' },
    'Payment failed but money was deducted.': { kn: 'ಪಾವತಿ ವಿಫಲವಾಗಿದೆ ಆದರೆ ಹಣ ಕಡಿತಗೊಂಡಿದೆ.', en: 'Payment failed but money was deducted.' },
    'Okay okay.': { kn: 'ಸರಿ ಸರಿ.', en: 'Okay okay.' }
};

const HINDI_TRANSLATIONS = {
    'Please hurry, it\'s very urgent.': { hi: 'कृपया जल्दी कीजिए, बहुत जरूरी है।', en: 'Please hurry, it\'s very urgent.' },
    'When will the technician arrive?': { hi: 'तकनीशियन कब आएगा?', en: 'When will the technician arrive?' },
    'Please cancel my booking.': { hi: 'कृपया मेरी बुकिंग रद्द करें।', en: 'Please cancel my booking.' },
    'My refund is not processed yet.': { hi: 'मेरा रिफंड अभी तक प्रोसेस नहीं हुआ है।', en: 'My refund is not processed yet.' }
};

const TELUGU_TRANSLATIONS = {
    'Please help quickly.': { te: 'దయచేసి త్వరగా సహాయం చేయండి.', en: 'Please help quickly.' },
    'Which branch is my account in?': { te: 'నా ఖాతా ఏ బ్రాంచ్‌లో ఉంది?', en: 'Which branch is my account in?' },
    'When will my order arrive?': { te: 'నా ఆర్డర్ ఎప్పుడు వస్తుంది?', en: 'When will my order arrive?' }
};

// Regional phonetic test sentences
const REGIONAL_PHONETIC_SENTENCES = {
    '/v/ and /w/': "Very few people carry their wallet in the West zone.",
    '/z/ pronounced as /j/ or /s/': "The zebra crossed zero traffic zones in the zoo.",
    '/f/ pronounced as /p/': "Please file four physical forms for family verification.",
    'Dental fricatives': "These three things are thorough and thankful for thirty days.",
    '/s/ and /ʃ/': "She sells shoe shine polish in the special shop.",
    'Epenthesis': "School students read the film script without stress.",
    'Vowel length': "He did not ship the sheep before six weeks.",
    'Retroflex stops': "Wait for that bus ticket at the counter right now.",
    'Spelled out': "My PAN card is ABCDE1234F and vehicle is KA01AB9876.",
    'Indianisms': "Kindly prepone my appointment only, I will do the needful itself.",
    'Code-mixing': "Tomorrow morning nanna delivery confirm aagutha please?",
    'Disfluencies': "Aah, umm, adu... actually I want to book on Wednesday not Tuesday.",
    'Short answers': "Yes. Confirm. Done. Cancel."
};

const dataset = validLines.map((desc, idx) => {
    const id = idx + 1;
    let category = 'other';
    let subCategory = '';
    let condition = 'Normal';
    let inputUtterance = '';
    let expectedOutput = '';
    let language = 'en-IN';
    let focus = '';

    if (/Speak the sentence and compare STT transcript/i.test(desc)) {
        category = 'acoustic_robustness';
        const match = desc.match(/\((.*?)\)/);
        condition = match ? match[1] : 'Quiet room, normal pace';
        inputUtterance = ACOUSTIC_SENTENCES[idx % ACOUSTIC_SENTENCES.length];
        expectedOutput = inputUtterance;
        subCategory = condition;
        focus = `Compare STT transcript word-by-word (WER) & character-by-character (CER) under ${condition}`;
    } else if (/Trigger a bot response containing the text; listen to TTS/i.test(desc)) {
        category = 'tts_pronunciation';
        inputUtterance = TTS_SENTENCES[idx % TTS_SENTENCES.length];
        expectedOutput = 'Clear pronunciation, natural cadence, 8kHz Linear PCM audio stream';
        subCategory = 'TTS Synthesis & Intelligibility';
        focus = 'Record TTS audio chunk, evaluate latency, clarity and phonetic pronunciation';
    } else if (/Verify silence \/ pause \/ timeout/i.test(desc)) {
        category = 'silence_and_timeout';
        subCategory = 'Telephony Session Guardrails';
        const pauseSecs = [3, 5, 8, 12, 15][idx % 5];
        condition = `${pauseSecs}s silence`;
        inputUtterance = `[SILENCE ${pauseSecs}s]`;
        expectedOutput = pauseSecs <= 8 ? 'Bot prompts caller ("Are you still there?")' : 'Bot gracefully terminates call / disconnect frame';
        focus = `Caller dead-air timeout handling at ${pauseSecs}s`;
    } else if (/In the middle of the '(.*?)' flow/i.test(desc)) {
        category = 'mid_flow_barge_in';
        const flowMatch = desc.match(/In the middle of the '(.*?)' flow/i);
        const flowName = flowMatch ? flowMatch[1] : 'Appointment Booking';
        subCategory = flowName;
        condition = 'Mid-call redirection after Turn 2';
        inputUtterance = 'Wait, cancel that! Actually I want to switch to a different service.';
        expectedOutput = 'Bot acknowledges redirection without crashing or repeating previous prompt';
        focus = `Barge-in and intent swap during ${flowName} flow`;
    } else if (/Speak in (Kannada|Hindi|Telugu)|Speak Kannada variant|Switch language|responding in Kannada/i.test(desc)) {
        category = 'multilingual_language_switch';
        if (/Kannada/i.test(desc)) {
            language = 'kn-IN';
            const phraseMatch = desc.match(/'(.*?)'/);
            const rawPhrase = phraseMatch ? phraseMatch[1] : 'Will it be delivered today?';
            const item = KANNADA_TRANSLATIONS[rawPhrase] || { kn: rawPhrase, en: rawPhrase };
            inputUtterance = item.kn;
            expectedOutput = `Bot responds in Kannada (kn-IN). Detected lang: kn-IN`;
            subCategory = 'Kannada Domain Query';
            focus = `Query: "${item.en}" -> Utterance: "${item.kn}"`;
        } else if (/Hindi/i.test(desc)) {
            language = 'hi-IN';
            const phraseMatch = desc.match(/'(.*?)'/);
            const rawPhrase = phraseMatch ? phraseMatch[1] : 'Please hurry, it\'s very urgent.';
            const item = HINDI_TRANSLATIONS[rawPhrase] || { hi: rawPhrase, en: rawPhrase };
            inputUtterance = item.hi;
            expectedOutput = `Bot responds in Hindi (hi-IN). Detected lang: hi-IN`;
            subCategory = 'Hindi Domain Query';
            focus = `Query: "${item.en}" -> Utterance: "${item.hi}"`;
        } else if (/Telugu/i.test(desc)) {
            language = 'te-IN';
            const phraseMatch = desc.match(/'(.*?)'/);
            const rawPhrase = phraseMatch ? phraseMatch[1] : 'Please help quickly.';
            const item = TELUGU_TRANSLATIONS[rawPhrase] || { te: rawPhrase, en: rawPhrase };
            inputUtterance = item.te;
            expectedOutput = `Bot responds in Telugu (te-IN). Detected lang: te-IN`;
            subCategory = 'Telugu Domain Query';
            focus = `Query: "${item.en}" -> Utterance: "${item.te}"`;
        } else {
            language = 'kn-IN';
            inputUtterance = 'ಹೌದು, please confirm my booking for tomorrow.';
            expectedOutput = 'Auto-detect code-mix (Kannada + English), continue dialogue seamlessly';
            subCategory = 'Code-Switching';
            focus = 'Mid-call multilingual transition';
        }
    } else if (/Team member from (.*?) reads the sentence/i.test(desc)) {
        category = 'regional_dialects_phonetics';
        const regionMatch = desc.match(/Team member from (.*?) reads the sentence/i);
        const region = regionMatch ? regionMatch[1].trim() : 'Karnataka';
        const focusMatch = desc.match(/Focus:\s*(.*)/i);
        const phoneticFocus = focusMatch ? focusMatch[1].trim() : 'Phonetic variation';
        
        let sentence = "I want to confirm my appointment for Wednesday at 2 PM.";
        for (const [key, sent] of Object.entries(REGIONAL_PHONETIC_SENTENCES)) {
            if (phoneticFocus.toLowerCase().includes(key.toLowerCase()) || desc.toLowerCase().includes(key.toLowerCase())) {
                sentence = sent;
                break;
            }
        }
        
        subCategory = region;
        inputUtterance = sentence;
        expectedOutput = sentence;
        condition = `Regional Accent: ${region}`;
        focus = phoneticFocus;
    } else {
        category = 'general_telephony';
        subCategory = 'Dialogue Protocol';
        inputUtterance = 'Hello, can you hear me?';
        expectedOutput = 'Bot acknowledges caller speech';
        focus = desc;
    }

    return {
        id,
        testNumber: `TC_${String(id).padStart(3, '0')}`,
        rawDescription: desc,
        category,
        subCategory,
        condition,
        language,
        inputUtterance,
        expectedOutput,
        focus
    };
});

// Group counts
const summary = {};
dataset.forEach(d => {
    summary[d.category] = (summary[d.category] || 0) + 1;
});

const output = {
    metadata: {
        totalTests: dataset.length,
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
        categories: summary
    },
    tests: dataset
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
console.log(`Successfully generated ${OUTPUT_FILE} with ${dataset.length} test cases!`);
console.log('Category distribution:', JSON.stringify(summary, null, 2));
