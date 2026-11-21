require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const gnaniService = require('../services/gnaniService');

async function testGnani() {
    console.log('Testing Gnani Voice Engine Integration...');
    console.log('API Key configured:', gnaniService.apiKey ? `${gnaniService.apiKey.substring(0, 10)}...` : 'MISSING');

    // 1. Test TTS
    const testText = "Hello, this is a test of Gnani Timbre voice synthesis.";
    console.log('\n1. Testing TTS with text:', testText);
    const wavBytes = await gnaniService.textToStream(testText, 'English', 'Shivani');
    console.log(`TTS Response: ${wavBytes.length} bytes received.`);

    if (wavBytes.length === 0) {
        console.error('❌ TTS test failed!');
        process.exit(1);
    }
    console.log('✅ TTS test passed! Audio format starts with:', wavBytes.slice(0, 4).toString());

    // 2. Test STT
    console.log('\n2. Testing STT with synthesized audio buffer...');
    const sttResult = await gnaniService.streamToText(wavBytes, 'English');
    console.log('STT Response:', JSON.stringify(sttResult));

    if (sttResult.text) {
        console.log(`✅ STT test passed! Recognized: "${sttResult.text}"`);
    } else {
        console.error('❌ STT test failed!');
        process.exit(1);
    }

    console.log('\n🎉 Gnani.ai integration verified successfully!');
}

testGnani().catch(console.error);
