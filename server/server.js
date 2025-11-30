/*
    Scamfie - AI-Powered Scam Detection
    Copyright (C) 2025 [Robbie Espaldon]

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); 

const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
});

const SYSTEM_PROMPT = `
You are 'Scamfie PH', a Forensic Marketplace Analyst.

### INPUT DATA
{ title, price, photo_count, joined_year, active_listings, rating_count, follower_count, seller_info }

### FORENSIC TRIANGULATION LOGIC

1. **THE "GARAGE SALE" DEFENSE (Strong Green Flag)**
   - IF (active_listings > 1) AND (Items seem random/used): VERDICT: SAFE.
   - *Reasoning:* Scammers rarely list low-value random items. They focus on high-value bait.

2. **THE "SOCIAL PROOF" DEFENSE (Strong Green Flag)**
   - IF (follower_count > 50) OR (rating_count > 5): VERDICT: SAFE/CAUTION (Not High Risk).
   - *Reasoning:* Accounts with followers/friends and ratings are likely real people, not burner bots.

3. **THE "HACKED ACCOUNT" PATTERN (Critical Red Flag)**
   - IF (Joined < 2018) AND (active_listings <= 1) AND (Item is High Value Electronics/Sneaker) AND (follower_count < 20):
   - **VERDICT:** HIGH RISK.
   - *Reasoning:* Dormant old account + 1 cheap high-value item + No social proof = Compromised Account.

### PRICE CONTEXT
- **Commodity Goods:** (Used shoes, clothes, furniture). Low price is usually SAFE.
- **Liquidity Goods:** (iPhone, iPad, Gold, Rolex). Low price is almost ALWAYS A SCAM.

### OUTPUT FORMAT (STRICT JSON)
{
  "risk_score": <0-100>,
  "verdict": <"SAFE" | "CAUTION" | "HIGH RISK" | "CRITICAL">,
  "prediction": <Forensic summary of behavior.>,
  "action_step": <Specific advice.>,
  "key_findings": [
     <String: "Inventory" -> "Result">,
     <String: "Identity" -> "Result">,
     <String: "Social Proof" -> "Result">
  ]
}
`;

app.post('/analyze', async (req, res) => {
    try {
        let { text } = req.body;
        let parsedInput;
        try { parsedInput = JSON.parse(text); } catch (e) { parsedInput = { raw_text: text }; }

        // --- ENHANCED DATA CLEANING ---
        // 1. Extract Price if missing
        if (parsedInput.price === "Unknown" && parsedInput.seller_info) {
             const priceMatch = parsedInput.seller_info.match(/(?:₱|PHP|Php)\s?[\d,]+/);
             if (priceMatch) parsedInput.price = priceMatch[0];
        }

        // 2. Extract Ratings 
        const ratingMatch = parsedInput.seller_info ? parsedInput.seller_info.match(/\((\d+)\)/) : null;
        parsedInput.rating_count = ratingMatch ? parseInt(ratingMatch[1]) : 0;
        
        console.log("==== FORENSIC ANALYSIS DATA ====");
        console.log(JSON.stringify(parsedInput, null, 2));

        const completion = await client.chat.completions.create({
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: JSON.stringify(parsedInput) }
            ],
            model: "llama-3.1-8b-instant", 
            temperature: 0.1, 
            response_format: { type: "json_object" }
        });

        const rawContent = completion.choices[0].message.content;
        let result = JSON.parse(rawContent.replace(/```json|```/g, '').trim());
        
        console.log("Verdict:", result.verdict);
        res.json(result);

    } catch (error) {
        console.error("Server Error:", error);
        if (error.status === 429) {
            res.status(429).json({ 
                error: "Rate Limit", 
                verdict: "Server Busy", 
                prediction: "System cooling down. Please wait 30s.",
                risk_score: 0,
                key_findings: []
            });
        } else {
            res.status(500).json({ error: "Analysis failed" });
        }
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`ScamGuard Server running on port ${process.env.PORT || 3000}`);
});