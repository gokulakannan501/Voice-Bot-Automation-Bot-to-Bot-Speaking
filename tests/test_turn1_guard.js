const assert = require('assert');

// Turn-1 Greeting completion regex from callManager.js:
const hasGreetingQuestion = /how (can|may) (i|we) (help|assist)|what can (i|we) do|who would you like to speak|can i (help|assist) you with something|tell me how|state your query|am i (speaking|talking) with|is this [a-z]+|may i speak with|\?\s*$/i;
const isTruncated = /(and|in|to|the|of|with|for|managing|a|an|or|is|that|this|at|by|from|about)\s*$/i;

function checkTurn1Greeting(transcript) {
    const trimmed = transcript.trim();
    const hasQuestion = hasGreetingQuestion.test(trimmed);
    const truncated = isTruncated.test(trimmed);
    const isLongEnough = trimmed.length >= 25;
    return hasQuestion && !truncated && isLongEnough;
}

console.log("🧪 Testing Turn-1 Greeting Completion Logic...\n");

// Test 1: Partial greeting with "assist you" in the middle (SHOULD FAIL -> MUST WAIT)
const partial1 = "Hello Gokula Kannan, welcome to Medicare Healthcare. I can assist you in mana";
assert.strictEqual(checkTurn1Greeting(partial1), false, "Partial 1 must NOT be considered complete");
console.log("✅ Partial 1 (mid-word truncated) correctly blocked from speaking.");

// Test 2: Full first sentence with "assist you in managing your appointments" but NO concluding question yet (SHOULD FAIL -> MUST WAIT)
const partial2 = "Hello Gokula Kannan, welcome to Medicare Healthcare. I can assist you in managing your appointments";
assert.strictEqual(checkTurn1Greeting(partial2), false, "Partial 2 must NOT be considered complete");
console.log("✅ Partial 2 (no question yet) correctly blocked from speaking.");

// Test 3: Complete opening greeting ending with question (SHOULD PASS -> CAN SPEAK)
const complete1 = "Hello Gokula Kannan, welcome to Medicare Healthcare. I can assist you in managing your appointments. How can I help you today?";
assert.strictEqual(checkTurn1Greeting(complete1), true, "Complete 1 must be considered complete");
console.log("✅ Complete 1 (ending with 'How can I help you today?') correctly approved.");

// Test 4: Inbound identity check question (SHOULD PASS -> CAN SPEAK)
const identity1 = "Hello, am I speaking with Gokulakannan?";
assert.strictEqual(checkTurn1Greeting(identity1), true, "Identity check must be considered complete");
console.log("✅ Complete 2 (Identity check: 'am I speaking with...') correctly approved.");

// Test 5: Short intro without question (SHOULD FAIL -> MUST WAIT)
const shortIntro = "Hello Gokula Kannan";
assert.strictEqual(checkTurn1Greeting(shortIntro), false, "Short intro must NOT be considered complete");
console.log("✅ Short intro correctly blocked from speaking.");

console.log("\n🎉 ALL Turn-1 Greeting Guard Unit Tests PASSED!");
