const axios = require('axios');

class ExotelService {
    constructor() {
        this.accountSid = process.env.EXOTEL_ACCOUNT_SID;
        this.apiKey = process.env.EXOTEL_API_KEY;
        this.apiToken = process.env.EXOTEL_API_TOKEN;
        this.subdomain = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';
        this.callerId = process.env.EXOTEL_CALLER_ID; // ExoPhone virtual number
        this.appId = process.env.EXOTEL_APP_ID; // Flow App ID
    }

    /**
     * Get Basic Auth header for Exotel API
     */
    getAuthHeader() {
        const credentials = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
        return `Basic ${credentials}`;
    }

    /**
     * Helper to format numbers in E.164 (+91...) format
     */
    formatE164(number) {
        if (!number) return '';
        let clean = number.toString().trim();
        if (clean.startsWith('+')) return clean;
        if (clean.startsWith('0')) return '+91' + clean.substring(1);
        if (clean.length === 10) return '+91' + clean;
        return '+' + clean;
    }

    /**
     * Initiates an outbound call to connect a customer/target to Exotel Flow App (Voicebot Applet)
     * @param {object} options
     * @param {string} options.to - Target bot phone number
     * @param {string} options.callerId - ExoPhone virtual number
     * @param {string} options.appId - Exotel Flow ID
     * @param {object} options.customParameters - Parameters like language, persona, scenario
     * @param {string} options.statusCallback - Webhook URL for status updates
     * @returns {Promise<object>}
     */
    async initiateCall({ to, callerId, appId, customParameters = {}, statusCallback = '' }) {
        try {
            const destinationNumber = this.formatE164(to || process.env.TARGET_BOT_NUMBER || '');
            if (!destinationNumber) {
                throw new Error("Target bot phone number is missing. Please enter the number in the Dashboard UI.");
            }
            const sourceCallerId = (callerId || this.callerId || '').toString().trim();
            const flowId = appId || this.appId;

            console.log(`\n📞 [Exotel API] Initiating outbound call to ${destinationNumber} via ExoPhone ${sourceCallerId}...`);

            const url = `https://${this.subdomain}/v1/Accounts/${this.accountSid}/Calls/connect.json`;

            const params = new URLSearchParams();
            // In Exotel Call-to-Flow API, 'From' is the destination to dial, and 'Url' is the destination flow
            params.append('From', destinationNumber);
            params.append('CallerId', sourceCallerId);
            params.append('CallType', 'trans');

            if (flowId) {
                // Connect call directly to the App Bazaar Voicebot Flow
                params.append('Url', `http://my.exotel.com/${this.accountSid}/exoml/start_voice/${flowId}`);
            }

            if (customParameters && Object.keys(customParameters).length > 0) {
                params.append('CustomField', JSON.stringify(customParameters));
            }

            if (statusCallback) {
                params.append('StatusCallback', statusCallback);
            }

            // Safety limit (e.g., 10 minutes max duration)
            params.append('TimeLimit', '600');

            const response = await axios.post(url, params.toString(), {
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                }
            });

            const callData = response.data?.Call || response.data;
            console.log(`✅ [Exotel API] Call created successfully. Call SID: ${callData.Sid || callData.sid}`);
            return callData;

        } catch (error) {
            const errorDetails = error.response?.data || error.message;
            console.error(`❌ [Exotel API] Failed to initiate call:`, errorDetails);
            throw new Error(typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : errorDetails);
        }
    }
}

module.exports = new ExotelService();
