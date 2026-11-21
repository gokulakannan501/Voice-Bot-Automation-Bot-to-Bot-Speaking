const axios = require('axios');
const FormData = require('form-data');

/**
 * Gnani.ai / Vachana.ai Voice Engine Service
 * STT: Prisma v3.0 (speech-to-text)
 * TTS: Timbre v3.0 (text-to-speech)
 */
class GnaniService {
    constructor() {
        this.apiKey = process.env.GNANI_API_KEY || 'vach_1ytE2CY5X2OfUyKAehEWKiQeMHtYXOEXu3OeBNxSS2L3EZI1lFCLl3wFJ8kuDHilMSYAP162hZKZJEBdnUoKWcroR27RtGvC_e73f6cca2caac1bd7ad4198f1f0d368e';
        this.ttsUrl = 'https://api.vachana.ai/api/v1/tts/inference';
        this.sttUrl = 'https://api.vachana.ai/stt/v3';
    }

    /**
     * Map friendly language name to ISO code
     */
    getLanguageCode(name = 'English') {
        const map = {
            'English': 'en-IN',
            'Hindi': 'hi-IN',
            'Kannada': 'kn-IN',
            'Tamil': 'ta-IN',
            'Telugu': 'te-IN',
            'Marathi': 'mr-IN',
            'Gujarati': 'gu-IN',
            'Bengali': 'bn-IN',
            'Malayalam': 'ml-IN'
        };
        return map[name] || (name.includes('-') ? name : 'en-IN');
    }

    /**
     * Converts raw audio stream from Exotel / CareDesk into Text (STT) via Prisma v3.0
     * @param {Buffer} audioBuffer - WAV audio buffer (8000 Hz, 16-bit mono)
     * @param {string} targetLanguageName - The english name of the language
     * @returns {Promise<{text: string, languageCode: string}>}
     */
    async streamToText(audioBuffer, targetLanguageName = 'English') {
        try {
            const langCode = this.getLanguageCode(targetLanguageName);
            const formData = new FormData();
            const nodeBuffer = Buffer.from(audioBuffer);

            formData.append('audio_file', nodeBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
            formData.append('model', 'prisma-v3.0');
            formData.append('language_code', langCode);

            const response = await axios.post(this.sttUrl, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'X-API-Key-ID': this.apiKey
                },
                timeout: 12000
            });

            const data = response.data || {};
            const transcript = data.transcript || data.text || (data.data && data.data.transcript) || '';
            const detectedLang = data.detected_language_code || langCode;

            return {
                text: transcript.trim(),
                languageCode: detectedLang
            };
        } catch (error) {
            const errDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            console.error('[Gnani STT] Error:', errDetail);
            return { text: '', languageCode: 'en-IN', error: errDetail };
        }
    }

    /**
     * Converts AI text response into 8000 Hz 16-bit Linear PCM / WAV via Timbre v3.0
     * @param {string} text - The text to speak
     * @param {string} targetLanguageName - Target language
     * @param {string} voice - Voice persona (e.g. 'Shivani')
     * @returns {Promise<Buffer>} - WAV audio bytes
     */
    async textToStream(text, targetLanguageName = 'English', voice = 'Shivani') {
        try {
            const langCode = this.getLanguageCode(targetLanguageName);

            const payload = {
                text: text,
                voice: voice || 'Shivani',
                model: 'timbre-v3.0',
                language: langCode,
                speed: 1.0,
                audio_config: {
                    encoding: 'linear_pcm',
                    container: 'wav',
                    num_channels: 1,
                    sample_rate: 8000,
                    sample_width: 2
                }
            };

            const response = await axios.post(this.ttsUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key-ID': this.apiKey
                },
                responseType: 'arraybuffer',
                timeout: 15000
            });

            return Buffer.from(response.data);
        } catch (error) {
            const errDetail = error.response?.data ? (Buffer.isBuffer(error.response.data) ? error.response.data.toString() : JSON.stringify(error.response.data)) : error.message;
            console.error('[Gnani TTS] Error:', errDetail);
            return Buffer.from([]);
        }
    }
}

module.exports = new GnaniService();

