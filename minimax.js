require('dotenv').config();
const axios = require('axios');
const MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M2.7';
const MINIMAX_URL ="https://api.minimax.chat/v1/text/chatcompletion_v2";
const SYSTEM_PROMPT =
    'You are an expense-categorization assistant. ' +
    'Always return strictly valid JSON that conforms to the provided schema. ' +
    'No prose, no markdown fences, no explanations.';
const singaporeTime = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Singapore' });
// Returns: "2026-06-28 10:00:00"

async function generateExpense(description, categoryList, userId, schema) {
    const prompt = `
You are a virtual assistant. Refer to the description, category list, and JSON schema to generate an expense.

Today's date (Singapore Time, UTC+8): ${singaporeTime}
description: ${description}
category list: ${categoryList}
user ID: ${userId}
Generated expense schema: ${JSON.stringify(schema)}

Rules:
1. Return only valid JSON, no explanation, no code fences.
2. Pick the most appropriate category from the provided list.
3. Use ISO 8601 for the date (UTC).
4. Use the ISO 4217 currency code (e.g. SGD, USD).
    `.trim();

    const response = await axios.post(
        MINIMAX_URL,
        {
            model: MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: prompt }
            ],
            ThoughtDisabled: true, // disable thinking process
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.MINIMAX_API_KEY}`
            },
        }
    );

    // Check for API-level errors
    const baseResp = response.data?.base_resp;
    if (baseResp && baseResp.status_code !== 0 && baseResp.status_code !== undefined) {
        throw new Error(`MiniMax API error ${baseResp.status_code}: ${baseResp.status_msg}`);
    }

    // Extract content from the correct response path
    const rawContent = response.data?.choices?.[0]?.message?.content;

    if (!rawContent) {
        throw new Error(
            'MiniMax returned empty content: ' + JSON.stringify(response.data)
        );
    }

    // Parse MiniMax's JSON response
    let parsedExpense;
    try {
        // Remove any markdown code fences if present
        const jsonMatch = rawContent.match(/```(?:json)?\n?([\s\S]*?)\n?```/)?.[1] || rawContent;
        parsedExpense = JSON.parse(jsonMatch);
    } catch (error) {
        throw new Error('Failed to parse AI response: ' + error.message);
    }

    // Validate required fields
    if (!parsedExpense.title || !parsedExpense.amount) {
        const err = new Error('AI could not extract title or amount from description');
        err.code = 'AI_INCOMPLETE';
        err.partial = parsedExpense;
        throw err;
    }

    return parsedExpense;
}

// share with other JavaScript files
module.exports = { MODEL, generateExpense };
