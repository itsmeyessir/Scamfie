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

document.getElementById("analyzeBtn").addEventListener("click", async () => {
  const resultDiv = document.getElementById("result");
  const loadingDiv = document.getElementById("loading");
  
  if(resultDiv) resultDiv.classList.add("hidden");
  if(loadingDiv) loadingDiv.classList.remove("hidden");

  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: getPageText,
  }, async (results) => {
    if (!results || !results[0]) {
      loadingDiv.innerText = "Error: Cannot read page.";
      return;
    }
    
    try {
      // 30s timeout because we are clicking and waiting
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); 

      const response = await fetch("http://localhost:3000/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: results[0].result }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const data = await response.json();
      displayResult(data);
    } catch (err) {
      console.error(err);
      loadingDiv.innerText = "Server Error. Is Node running?";
    }
  });
});

async function getPageText() {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const hostname = window.location.hostname;
    
    let extracted = {
        title: document.title,
        price: "Unknown",
        description: "",
        seller_info: "Not found",
        joined_date: "Unknown",
        image_count: 1, 
        active_listings: 0,
        follower_count: 0,
        rating_count: 0
    };

    if (hostname.includes("facebook.com")) {
        const mainBox = document.querySelector('div[role="main"]');
        
        if (mainBox) {
            extracted.description = mainBox.innerText;

            // 1. TITLE (H1 Strategy)
            const h1 = mainBox.querySelector('h1');
            if (h1) extracted.title = h1.innerText;

            // 2. PRICE (Anchor Strategy)
            if (h1) {
                const titleRect = h1.getBoundingClientRect();
                const allCandidates = mainBox.querySelectorAll('span, div, h2');
                let closestDist = 99999;

                allCandidates.forEach(el => {
                    const txt = el.innerText.trim();
                    if (/^(?:₱|PHP|Php|P)\s?[\d,]+/.test(txt) && txt.length < 20) {
                        const elRect = el.getBoundingClientRect();
                        const distY = elRect.top - titleRect.bottom;
                        if (distY >= 0 && distY < 600) { 
                            if (distY < closestDist) {
                                closestDist = distY;
                                extracted.price = txt;
                            }
                        }
                    }
                });
            }

            // 3. IMAGE COUNTER
            const thumbs = document.querySelectorAll('[aria-label^="Thumbnail"]');
            if (thumbs.length > 0) {
                 const last = thumbs[thumbs.length - 1].getAttribute("aria-label");
                 const match = last.match(/of\s+(\d+)/i);
                 if (match) extracted.image_count = parseInt(match[1]);
                 else extracted.image_count = thumbs.length;
            } else {
                 const allNodes = mainBox.querySelectorAll('*');
                 let thumbCount = 0;
                 allNodes.forEach(el => {
                     const r = el.getBoundingClientRect();
                     if (r.width >= 24 && r.width <= 120 && r.height >= 24 && r.height <= 120) {
                         const style = window.getComputedStyle(el);
                         if (el.tagName === 'IMG' || (style.backgroundImage && style.backgroundImage.includes('url'))) {
                             thumbCount++;
                         }
                     }
                 });
                 if (thumbCount > 2) extracted.image_count = Math.ceil(thumbCount / 2);
            }
        }

        // 4. SELLER DETAILS (The "Aggressive Clicker")
        
        // Find ANY element containing "Seller details"
        // We use XPath to find the text node because class names are random
        const xPathResult = document.evaluate(
            "//span[contains(text(), 'Seller details')]", 
            document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        let sellerBtn = xPathResult.singleNodeValue;

        if (sellerBtn) {
            // Click the parent div because the span might not be the button itself
            sellerBtn.click();
            if(sellerBtn.parentElement) sellerBtn.parentElement.click();
            if(sellerBtn.parentElement.parentElement) sellerBtn.parentElement.parentElement.click();
            
            // WAIT LOOP: Wait for the popup to actually render text
            // We look for "followers" or "friends" which only appears in the popup
            let popupFound = false;
            let combinedText = "";

            for (let i = 0; i < 20; i++) { // Wait up to 4 seconds
                await sleep(200);
                
                // Get all dialogs/modals
                const dialogs = document.querySelectorAll('div[role="dialog"]');
                for (let d of dialogs) {
                    const txt = d.innerText;
                    // Check if this is the right popup
                    if (txt.includes("active listing") || txt.includes("followers") || txt.includes("friends")) {
                        combinedText = txt;
                        extracted.seller_info = txt; // Capture rich data
                        popupFound = true;
                        
                        // Close it immediately
                        const closeBtn = d.querySelector('[aria-label="Close"]');
                        if (closeBtn) closeBtn.click();
                        break;
                    }
                }
                if (popupFound) break;
            }

            // PARSE THE RICH DATA
            if (popupFound) {
                // Joined Date
                const joinedMatch = combinedText.match(/Joined Facebook in\s?(\d{4})/i);
                if (joinedMatch) extracted.joined_date = joinedMatch[1];
                
                // Listings Count
                const listingsMatch = combinedText.match(/(\d+)\s?active listing/i);
                if (listingsMatch) extracted.active_listings = parseInt(listingsMatch[1]);
                
                // Followers
                const followerMatch = combinedText.match(/(\d+)\s?(?:followers|friends)/i);
                if (followerMatch) extracted.follower_count = parseInt(followerMatch[1]);
                
                // Ratings
                const ratingMatch = combinedText.match(/\((\d+)\)/);
                if (ratingMatch) extracted.rating_count = parseInt(ratingMatch[1]);
            }
        } 
        
        // FALLBACK: If click failed, scrape whatever is visible in sidebar
        if (extracted.seller_info === "Not found" || extracted.active_listings === 0) {
            const sidebar = document.querySelector('div[role="complementary"]');
            if (sidebar) {
                 const txt = sidebar.innerText;
                 extracted.seller_info = txt;
                 const jm = txt.match(/Joined Facebook in\s?(\d{4})/i);
                 if (jm) extracted.joined_date = jm[1];
            }
        }

        // Backup Price
        if (extracted.price === "Unknown" && extracted.seller_info) {
             const backupMatch = extracted.seller_info.match(/(?:₱|PHP|Php)\s?[\d,]+/);
             if (backupMatch) extracted.price = backupMatch[0];
        }
    } 

    return JSON.stringify(extracted);
}

function displayResult(data) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("result").classList.remove("hidden");

  if (!data) data = {};
  const score = Math.max(0, Math.min(100, Number(data.risk_score || 0)));
  const verdictText = String((data.verdict || "SAFE")).toUpperCase().trim();

  // Always use verdict string for color and label
  const LEVELS = [
    { key: "SAFE", color: "#28a745", class: "safe" },
    { key: "CAUTION", color: "#d39e00", class: "caution" },
    { key: "HIGH RISK", color: "#fd7e14", class: "high-risk" },
    { key: "CRITICAL", color: "#dc3545", class: "critical" }
  ];

  // Find the level index by verdict string
  let activeIndex = LEVELS.findIndex(lvl => verdictText.includes(lvl.key));
  if (activeIndex === -1) {
    // fallback to score buckets
    activeIndex = Math.min(3, Math.floor(score / 25));
  }
  const level = LEVELS[activeIndex];

  // Set verdict label and color
  const verdictEl = document.getElementById("verdict");
  verdictEl.innerText = level.key;
  verdictEl.className = "";
  verdictEl.classList.add(level.class);

  // Set progress bar fill
  const scoreFill = document.getElementById("score-fill");
  scoreFill.style.width = `${score}%`;
  scoreFill.style.backgroundColor = level.color;

  // Highlight the active segment
  const segments = document.querySelectorAll("#score-bar .score-segment");
  segments.forEach((s, idx) => s.classList.toggle("active", idx === activeIndex));

  // Render analysis, action plan, and key findings (as you already do)
  const list = document.getElementById("flags");
  const actionBg = (level.class === 'safe') ? '#e6f4ea' : (level.class === 'caution') ? '#fff3cd' : '#fff4e6';
  list.innerHTML = `
    <span class="box-label">Analysis</span>
    <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; border-left: 4px solid ${level.color}; margin-bottom: 10px;">
        <span style="font-size: 13px; color: #333; line-height: 1.4;">${data.prediction || "Check complete."}</span>
    </div>

    <span class="box-label">Action Plan</span>
    <div style="background: ${actionBg}; padding: 10px; border-radius: 4px; margin-bottom: 15px;">
        <span style="font-size: 13px; font-weight: bold; color: #111">${data.action_step}</span>
    </div>

    <span class="box-label">Key Findings</span>
  `;

  if(data.key_findings) {
      data.key_findings.forEach(flag => {
        const li = document.createElement("li");
        li.style.marginBottom = "8px"; 
        li.innerText = typeof flag === 'object' && flag !== null
          ? Object.values(flag).join(": ")
          : flag;
        list.appendChild(li);
      });
  }
}