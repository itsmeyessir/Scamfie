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
You are 'Scamfie PH', a Forensic Marketplace Analyst. Your goal is to protect the buyer by providing objective risk assessment, not guarantees.

### INPUT DATA
{ title, price, photo_count, joined_year, active_listings, rating_count, follower_count, seller_info, platform, account_age_years }

### ACCOUNT AGE RULES (ABSOLUTE)
- Use the provided 'age_label' (NEW, YOUNG, ESTABLISHED). Do not calculate it.

### 1. DATA DISTINCTION
- **listing_age:** Item posted date (e.g. "3 days ago").
- **joined_year:** Seller join date (e.g. "2009", "2021").

### 2. IDENTIFY ITEM
- Extract clean item name (e.g. "Zotac RTX 5080").
- Estimate market value (PHP).

### 3. FORENSIC LOGIC (STRICT HIERARCHY)

**RULE #1: THE "POWER SELLER" OVERRIDE (Top Priority)**
- IF (rating_count > 20) OR (follower_count > 100):
  - **VERDICT:** SAFE.
  - **Reasoning:** State that the seller has strong social proof and cite their rating count.

**RULE #2: THE "GARAGE SALE" DEFENSE**
- IF (active_listings > 1) AND (rating_count < 20):
  - **VERDICT:** SAFE.
  - **Reasoning:** State that the seller has multiple active listings, which is typical behavior for a real user.

**RULE #3: THE "HACKED ACCOUNT" TRAP**
- IF (joined_year < 2019) AND (rating_count == 0) AND (active_listings <= 1) AND (Item Value > ₱5,000):
  - **VERDICT:** HIGH RISK.
  - **Reasoning:** State that the account is old but dormant (0 ratings, 1 active item). This matches the pattern of a compromised account.

**RULE #4: THE "TOO GOOD TO BE TRUE"**
- IF (price is < 60% of market value) AND (platform == "Facebook Marketplace" OR platform == "Carousell"):
  - **VERDICT:** HIGH RISK.
  - **Reasoning:** State that the price is significantly below market average, which is a major red flag.

  **RULE #5: THE "LAZY SCAMMER" SIGNAL (PHOTO CHECK)**
- IF (photo_count <= 1) AND (Item Value > ₱2,000) AND (rating_count < 5):
  - **VERDICT:** HIGH RISK.
  - **Reasoning:** "High-value item listed with only 1 photo. Genuine sellers usually provide multiple angles. If possible, request more photos or a video."

  **RULE #6: MANDATORY EVIDENCE REPORTING**
- You MUST mention the 'photo_count' in the 'key_findings' array.
- If photo_count > 1: "Listing includes photo_count > 1, allowing for visual inspection."
- If photo_count == 1: "Listing contains only 1 photo, which limits verification."

**RULE #7: CAROUSELL AUTHORITY**
- IF (platform == "Carousell") AND (rating_count > 0) AND (joined_year < 2021):
  - **VERDICT:** SAFE. (Overrides "Active Listings" check).
  - **Reasoning:** "Account has a long history (joined_year < 2019) and verified activity (rating_count < 20), indicating reliability."
  - *Note:* Do NOT penalize Carousell sellers for having "0 active listings" if they have good ratings. They likely just sold everything else.

**RULE #8: THE "POWER SELLER" OVERRIDE (Top Priority)**
- IF (rating_count > 15) OR (follower_count > 100):
  - **VERDICT:** SAFE.
  - **Reasoning:** "Seller has strong social proof with {rating_count} ratings."

**RULE #9: THE "VERIFIED LOCAL SELLER"**
- IF (active_listings > 1) AND (rating_count > 0):
  - **VERDICT:** SAFE.
  - **Reasoning:** "Seller has active listings and a history of feedback (rating_count > 0), which indicates a real user."

**RULE #10: THE "UNVERIFIED SLEEPER" (The Fix)**
- IF (active_listings > 1) AND (rating_count == 0):
  - **VERDICT:** CAUTION.
  - **Reasoning:** "Account has multiple listings but **0 ratings**. While the account is {age_label}, the lack of feedback requires you to verify identity before transferring money."

### 3. ADVICE TONE GUIDELINES (CRITICAL)
- **NEVER** say "Buy with confidence" or "This is safe."
- **Account Age:**
  - If joined_year < 2022: Describe as "Established" or "Old" account.
  - If joined_year >= 2024: Describe as "New" account.
  - **NEVER** call a 2009-2022 account "New" or "Relatively New".
- **ALWAYS** act as a cautious advisor. 
- **FOR SAFE VERDICTS:** Use phrases like:
  - "The account stats are healthy, but always inspect the item in person."
  - "Proceed with standard due diligence. Request a video timestamp."
  - "Seller appears legitimate, but ensure the transaction happens in a safe public place."
- **FOR HIGH RISK:** Be direct. "Do not send money first."

### OUTPUT FORMAT (JSON)
{
  "risk_score": <0-100 (0-20 for Safe)>,
  "verdict": <"SAFE" | "CAUTION" | "HIGH RISK" | "CRITICAL">,
  "item_name": <String: Clean name for search>,
  "market_price_range": <String: e.g. "₱30k - ₱40k">,
  "prediction": <String: A specific, forensic summary citing data points (e.g. 'Account is 8 years old with 5-star rating').>,
  "action_step": <String: Professional next step (e.g. 'Request a video call', 'Request for more photos', 'Meet in mall').>,
  "key_findings": [
     <String: Factual sentence. e.g. "Seller has a strong reputation with 200+ ratings.">,
     <String: Factual sentence. e.g. "Account established in 2009 with consistent activity.">
     <String: Factual sentence. e.g. "Seller provided only 1 photo, which restricts visual verification.">,
     <String: e.g. "Listing includes 6 photos, which is good for verification.">
  ]
}
`;

app.post('/analyze', async (req, res) => {
    try {
        let { text } = req.body;
        let parsedInput;
        try { parsedInput = JSON.parse(text); } catch (e) { parsedInput = { raw_text: text }; }

        // 1. Variable Normalization
        if (!parsedInput.joined_year && parsedInput.joined_date) {
            const match = String(parsedInput.joined_date).match(/(\d{4})/);
            if (match) parsedInput.joined_year = match[1];
        }

        // 2. Deterministic Age Logic
        const currentYear = new Date().getFullYear();
        parsedInput.account_age_years = 0; 
        parsedInput.age_label = "NEW"; 

        if (parsedInput.joined_year) {
            const j = Number(parsedInput.joined_year);
            if (!Number.isNaN(j)) {
                if (j > 2000 && j <= currentYear) {
                     parsedInput.account_age_years = currentYear - j;
                } else if (j < 100) {
                     parsedInput.account_age_years = j;
                }
            }
        }
        
        // Handle "4y ago" strings
        if (parsedInput.relative_date_string) {
             const match = parsedInput.relative_date_string.match(/(\d+)\s?y/);
             if (match) parsedInput.account_age_years = parseInt(match[1]);
        }

        // 3. Assign Label
        const age = parsedInput.account_age_years;
        if (age >= 5) parsedInput.age_label = "ESTABLISHED";
        else if (age >= 2) parsedInput.age_label = "YOUNG";
        else parsedInput.age_label = "NEW";

        console.log(`Analyzing: ${parsedInput.title} | Age: ${age} | Label: ${parsedInput.age_label}`);

        // Small fixups: ensure numeric fields exist
        parsedInput.rating_count = Number(parsedInput.rating_count || 0);
        parsedInput.active_listings = Number(parsedInput.active_listings || 0);
        parsedInput.follower_count = Number(parsedInput.follower_count || 0);
        
        console.log(`Analyzing: ${parsedInput.title} | Ratings: ${parsedInput.rating_count}`);

        const completion = await client.chat.completions.create({
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: JSON.stringify(parsedInput) }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0,
            response_format: { type: "json_object" }
        });

        const rawContent = completion.choices[0].message.content;
        let result = JSON.parse(rawContent.replace(/```json|```/g, '').trim());

        // SANITY CHECK: Make sure account_age_class/years match our computed values
        try {
            // Ensure numeric account_age_years exists in the result; if not, trust our computed value
            const aiYears = Number(result.account_age_years);
            const computedYears = parsedInput.account_age_years;
            // If model returned no account_age_years or mismatch with computed years, override it
            if (!Number.isFinite(aiYears) && computedYears != null) {
                result.account_age_years = computedYears;
            }

            // Class mapping must be canonical per the prompt
            const years = Number(result.account_age_years || computedYears || 0);
            let computedClass = "ESTABLISHED";
            if (years <= 1) computedClass = "NEW";
            else if (years >= 2 && years <= 4) computedClass = "YOUNG";
            else computedClass = "ESTABLISHED";

            // If model used ambiguous language, force canonical mapping for clarity
            if (result.account_age_class !== computedClass) {
                result.account_age_class = computedClass;
            }

            // If the model wrote "relatively new" or contradictory language in prediction, patch it:
            if (result.prediction && /\brelatively new\b/i.test(result.prediction) && computedClass === "ESTABLISHED") {
                result.prediction = result.prediction.replace(/\brelatively new\b/ig, "established");
            }
        } catch (e) {
            // Do not fail if sanity check throws; just log
            console.log("Sanity check patch skipped:", e);
        }

        res.json(result);

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: "Analysis failed" });
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`Scamfie Server running on port ${process.env.PORT || 3000}`);
});