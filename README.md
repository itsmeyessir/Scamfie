# Scamfie (Open-Source)

![License](https://img.shields.io/badge/license-GPLv3-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Status](https://img.shields.io/badge/status-MVP-orange.svg)

Scamfie is a browser extension + backend that analyzes marketplace listings and provides a clear verdict and guidance — SAFE, CAUTION, HIGH RISK, or CRITICAL. The extension scrapes page data, sends structured input to an LLM-powered backend, and displays a 4-segment progress bar plus analysis, action plan, and key findings.

---

## Visual Demo

<div align="center">
  <video 
    src="https://github.com/user-attachments/assets/68df858a-fa65-4cb2-868b-9b765cead50f"
    width="100%" 
    autoplay 
    loop 
    muted 
    playsinline 
  ></video>
</div>

> **Note:** If the video above does not play, [click here to watch it directly](https://github.com/user-attachments/assets/68df858a-fa65-4cb2-868b-9b765cead50f).
> 
---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Risk Flags & Progress Bar](#risk-flags--progress-bar)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting a Groq API Key](#getting-a-groq-api-key)
- [Setup & Run](#setup--run)
- [API (server)](#api-server)
- [Example Request & Response](#example-request--response)
- [Debugging & Troubleshooting](#debugging--troubleshooting)
- [Recommended improvements](#recommended-improvements)
- [Security & Privacy](#security--privacy)
- [License](#license)

---

## Features

- Real-time marketplace listing analysis
- Price intelligence and image forensics
- Seller background checks (joined date, followers, ratings)
- Actionable advice (clear next steps)
- 4-level risk verdict + segmented progress bar visualization

---

## Tech Stack

- Frontend: Chrome Extension Manifest V3, vanilla JavaScript, CSS
- Backend: Node.js, Express.js
- AI Engine: OpenAI/Groq-compatible endpoint via `openai` SDK or equivalent

---

## Risk Flags & Progress Bar

- Verdict levels and colors:
  - SAFE — green (#28a745)
  - CAUTION — yellow/gold (#d39e00)
  - HIGH RISK — orange (#fd7e14)
  - CRITICAL — red (#dc3545)

- Progress bar behavior:
  - The bar is visually split into 4 equal muted segments representing each verdict level.
  - Fill width is controlled by `risk_score` (0–100).
  - Color and label are determined by the `verdict` string returned by the server. If the server returns no `verdict`, the UI falls back to 25% buckets:
    - 0–24: SAFE
    - 25–49: CAUTION
    - 50–74: HIGH RISK
    - 75–100: CRITICAL
  - Active highlighted segment corresponds to the verdict (preferred) or the score bucket.

---

## Project structure

Expected repo layout:

```
scamfie/
├─ extension/
│  ├─ manifest.json
│  ├─ popup.html
│  ├─ popup.js
│  └─ styles.css
├─ server/
│  ├─ server.js
   ├─ .env (local, not commited)
│  └─ package.json (recommended)
└─ README.md
```

- `extension/`: Browser UI and logic; popup UI and CSS.
- `server/`: Node/Express backend that wraps the LLM call and returns a strict JSON contract to the extension.
- `.env`: Holds API keys and PORT; DO NOT commit.

---

## Prerequisites

- Node 18+ and npm
- Google Chrome (Manifest V3)
- Groq/OpenAI-compatible API key (stored in `.env`, named `GROQ_API_KEY`)
- Basic familiarity with Chrome DevTools

---

## Getting a Groq API Key

To use ScamGuard, you need a Groq API key for LLM-powered analysis.

1. Visit [https://console.groq.com/](https://console.groq.com/)
2. Sign up or log in.
3. Navigate to the API Keys section.
4. Create a new API key and copy it.
5. Paste it into your `.env` file as `GROQ_API_KEY=your_key_here`

---

## Setup & Run

1) Clone the repo:

```bash
git clone https://github.com/yourusername/scamfie.git
cd scamfie
```

2) Server dependencies:

```bash
cd server
npm install
```

3) Create a `.env` in repository root (DO NOT COMMIT!!!):

```
GROQ_API_KEY=your_groq_api_key_here
PORT=3000
```

4) Start the server:

```bash
cd server
node server/server.js
# or add "start": "node server/server.js" to package.json and run
npm start
```

5) Load the extension:

- Open Chrome → `chrome://extensions`
- Toggle Developer mode ON
- Click "Load unpacked", select the `extension/` folder
- Visit a marketplace listing and click the extension popup → "Analyze Page"

---

## API (server)
Endpoint: POST /analyze

- Input: The extension sends JSON via `{ text: "<stringified JSON>" }` — server attempts to parse it and validate.

- Output: The server must return a JSON object with these fields:

```json
{
  "risk_score": 0-100,
  "verdict": "SAFE" | "CAUTION" | "HIGH RISK" | "CRITICAL",
  "prediction": "Forensic summary as a short string",
  "action_step": "Concrete advice to the user",
  "key_findings": ["string", "string", {"Inventory":"..."}]
}
```

Important:

- Return `verdict` as one of the exact strings above for deterministic UI mapping.
- `risk_score` controls the progress width.
- Convert `key_findings` to readable strings if possible. The UI can format objects, but consistent strings are recommended.

---

## Example Request & Response

Example curl test:

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"text":"{\"title\":\"iPhone 16\",\"price\":\"₱5,000\",\"joined_year\":2016,\"active_listings\":1,\"rating_count\":0,\"follower_count\":2}"}'
```

Example response:

```json
{
  "risk_score": 88,
  "verdict": "CRITICAL",
  "prediction": "Low price + old account + low social proof indicates high likelihood of scam.",
  "action_step": "Do not purchase. Verify identity and request a live video.",
  "key_findings": ["Inventory: High value at suspiciously low price", "Social Proof: Low followers and no reviews"]
}
```

---

## Debugging & Troubleshooting

- Color or label mismatches:
  - Confirm server returns the exact `verdict` string.
  - If `verdict` is missing, the UI falls back to `risk_score` buckets.

- Progress bar appears unsegmented:
  - `.score-fill` may overlay borders. Adjust CSS to only round the left side of the fill (`border-radius: 8px 0 0 8px`), or reduce overlay opacity to keep segment separators visible.

- `key_findings` show `[object Object]`:
  - Ensure server returns readable strings in `key_findings` or the UI should format object entries into strings (e.g., `Inventory: Multiple high-value items`).

- Network issues:
  - Check server logs for incoming request payloads.
  - Inspect the extension popup console: Open the popup → right click → Inspect → Console/Network.

- 429 / rate limit errors from LLM:
  - Implement retry/backoff on server or adjust plan limits.

---

## Recommended improvements

- Add server-side JSON schema validation (e.g., using Ajv).
- Normalize `key_findings` server-side to a consistent string format.
- Add unit tests for `popup.js` and backend endpoint behavior.
- Add E2E test for the extension + backend interaction.
- Add a small caching layer or rate limiter to reduce duplicated LLM calls.

---

## Security & Privacy

- Do not check in `.env` — always store API keys locally.
- Be mindful of user data: avoid sending photos or personally identifiable information to the server where not necessary.
- Consider adding consent/opt-out prompts for the extension.

---

## License

GNU GPLv3 — See LICENSE file.

---
