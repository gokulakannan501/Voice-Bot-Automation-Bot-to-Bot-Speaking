const axios = require('axios');
const FormData = require('form-data');
const { WaveFile } = require('wavefile');

class SarvamService {
    constructor() {
        this.apiKey = process.env.SARVAM_API_KEY;
        this.baseUrl = 'https://api.sarvam.ai';
    }

    /**
     * Converts raw audio stream from Exotel into Text (STT)
     * @param {Buffer} audioBuffer - the raw audio bytes
     * @param {string} targetLanguageName - The english name of the language (e.g., 'Tamil')
     * @returns {Promise<{text: string, languageCode: string}>} - The transcribed text and detected language code
     */
    async streamToText(audioBuffer, targetLanguageName = "English") {
        try {
            // console.log('[Sarvam] Transcribing audio chunk...');

            const languageCodeMap = {
                'English': 'en-IN',
                'Hindi': 'hi-IN',
                'Tamil': 'ta-IN',
                'Telugu': 'te-IN',
                'Kannada': 'kn-IN',
                'Marathi': 'mr-IN',
                'Gujarati': 'gu-IN'
            };
            const targetLanguageCode = languageCodeMap[targetLanguageName] || 'en-IN';

            const formData = new FormData();

            // Ensure it is a true Node Buffer (since wavefile.toBuffer returns a Uint8Array)
            let nodeBuffer = Buffer.from(audioBuffer);

            // Guard: Sarvam STT strictly rejects audio > 30 seconds. Trim to last 24 seconds if needed.
            try {
                const wav = new WaveFile();
                wav.fromBuffer(nodeBuffer);
                const sampleRate = wav.fmt.sampleRate || 8000;
                const numChannels = wav.fmt.numChannels || 1;
                const bytesPerSample = (wav.fmt.bitsPerSample || 16) / 8;
                const bytesPerSec = sampleRate * numChannels * bytesPerSample;
                const durationSec = wav.data.samples.length / bytesPerSec;

                if (durationSec > 25) {
                    const keepBytes = Math.floor(24 * bytesPerSec);
                    let start = wav.data.samples.length - keepBytes;
                    if (start % 2 !== 0) start++;
                    wav.data.samples = wav.data.samples.slice(start);
                    nodeBuffer = Buffer.from(wav.toBuffer());
                }
            } catch (wErr) {
                // If not standard WAV container, fallback to raw buffer
            }

            // Mocking a filename for the buffer as Sarvam expects a file upload
            formData.append('file', nodeBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
            formData.append('model', 'saaras:v3');
            formData.append('mode', 'transcribe');
            formData.append('language_code', targetLanguageCode); // Force Language output

            const response = await axios.post(`${this.baseUrl}/speech-to-text`, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'api-subscription-key': this.apiKey,
                },
            });

            // console.log('[Sarvam] Raw API Response:', JSON.stringify(response.data));

            // The Sarvam v1 schema used .transcript, but newer versions might use .text
            const resultText = response.data.transcript || response.data.text || "";
            const languageCode = response.data.language_code || targetLanguageCode;

            return {
                text: resultText.trim(),
                languageCode: languageCode
            };
        } catch (error) {
            console.error('[Sarvam] STT Error:', error.response?.data || error.message);
            return { text: "", languageCode: "en-IN" };
        }
    }

    /**
     * Converts bot text response into raw audio stream for Exotel (TTS)
     * @param {string} text - The text to speak
     * @param {string} targetLanguageName - The english name of the language (e.g., 'Tamil')
     * @returns {Promise<Buffer>} - The audio bytes
     */
    async textToStream(text, targetLanguageName = "English", speaker = "aditya") {
        try {
            const languageCodeMap = {
                'English': 'en-IN',
                'Hindi': 'hi-IN',
                'Tamil': 'ta-IN',
                'Telugu': 'te-IN',
                'Kannada': 'kn-IN',
                'Marathi': 'mr-IN',
                'Gujarati': 'gu-IN'
            };

            const targetLanguageCode = languageCodeMap[targetLanguageName] || 'en-IN';

            const payload = {
                inputs: [text],
                target_language_code: targetLanguageCode,
                speaker: speaker || "aditya",
                pace: 1.0,                   // 1.0 is natural, relaxed human speaking pace (1.05 sounded rushed/robotic)
                speech_sample_rate: 8000,    // Native 8kHz 16-bit PCM for 100% distortion-free Exotel telephony
                enable_preprocessing: true,
                model: "bulbul:v3"
            };

            const response = await axios.post(`${this.baseUrl}/text-to-speech`, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'api-subscription-key': this.apiKey,
                }
            });

            // Sarvam TTS returns base64 string in 'audios' array
            const base64Audio = response.data.audios[0];
            return Buffer.from(base64Audio, 'base64');

        } catch (error) {
            console.error('[Sarvam] TTS Error:', error.response?.data || error.message);
            return Buffer.from([]);
        }
    }
}

module.exports = new SarvamService();
