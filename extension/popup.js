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
  const analyzeBtn = document.getElementById("analyzeBtn");
  
  if(resultDiv) resultDiv.classList.add("hidden");
  if(loadingDiv) loadingDiv.classList.remove("hidden");
  if(analyzeBtn) analyzeBtn.style.display = 'none';

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
        rating_count: 0,
        platform: "Generic"
    };

    // =========================================================
    // STRATEGY A: FACEBOOK MARKETPLACE
    // =========================================================
    if (hostname.includes("facebook.com")) {
        extracted.platform = "Facebook";
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
            
            // WAIT LOOP
            let popupFound = false;
            let combinedText = "";

            for (let i = 0; i < 20; i++) { // Wait up to 4 seconds
                await sleep(200);
                
                const dialogs = document.querySelectorAll('div[role="dialog"]');
                for (let d of dialogs) {
                    const txt = d.innerText;
                    if (txt.includes("active listing") || txt.includes("followers") || txt.includes("friends")) {
                        combinedText = txt;
                        extracted.seller_info = txt; 
                        popupFound = true;
                        
                        const closeBtn = d.querySelector('[aria-label="Close"]');
                        if (closeBtn) closeBtn.click();
                        break;
                    }
                }
                if (popupFound) break;
            }

            // PARSE THE RICH DATA
            if (popupFound) {
                const joinedMatch = combinedText.match(/Joined Facebook in\s?(\d{4})/i);
                if (joinedMatch) extracted.joined_date = joinedMatch[1];
                
                const listingsMatch = combinedText.match(/(\d+)\s?active listing/i);
                if (listingsMatch) extracted.active_listings = parseInt(listingsMatch[1]);
                
                const followerMatch = combinedText.match(/(\d+)\s?(?:followers|friends)/i);
                if (followerMatch) extracted.follower_count = parseInt(followerMatch[1]);
                
                const ratingMatch = combinedText.match(/\((\d+)\)/);
                if (ratingMatch) extracted.rating_count = parseInt(ratingMatch[1]);
            }
        } 
        
        // FALLBACK
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

    // =========================================================
    // STRATEGY B: CAROUSELL "DEEP DIVE" SCRAPER (Final)
    // =========================================================
    else if (hostname.includes("carousell")) {
        extracted.platform = "Carousell";
        extracted.description = document.body.innerText.substring(0, 3000);

        // 1. VISIBLE DATA (Title)
        const titleEl = document.querySelector('p[data-testid="listing-card-text-title"], h1');
        if (titleEl) extracted.title = titleEl.innerText;
        
        // 2. PRICE (Aggressive Search)
        // Find largest price text near top of page to avoid "shipping fee" confusion
        const allElements = Array.from(document.querySelectorAll('p, h3, h2, span'));
        for (let el of allElements) {
            if (el.innerText && el.innerText.match(/^(?:₱|PHP|Php)\s?[\d,]+$/)) {
                const rect = el.getBoundingClientRect();
                // Must be visible and near top
                if (rect.top < 600 && rect.height > 0) {
                    const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
                    if (fontSize > 16) {
                        extracted.price = el.innerText;
                        break; 
                    }
                }
            }
        }

        // 3. IMAGE COUNT (Badge Strategy)
        // Look for "1 of 5" or "5 images" badges
        const allDivs = document.querySelectorAll('div, span, button');
        for (let el of allDivs) {
            if (el.innerText && /^\d+\s+images?$/.test(el.innerText)) {
                extracted.image_count = parseInt(el.innerText);
                break;
            }
        }
        // Fallback: Slides
        if (extracted.image_count <= 1) {
             const slides = document.querySelectorAll('li[data-testid^="listing-gallery-image"]');
             if (slides.length > 0) extracted.image_count = slides.length;
        }

        // 4. FIND PROFILE URL
        let profileUrl = null;
        const sellerCard = document.querySelector('div[data-testid="listing-card-seller-info"], a[data-testid="listing-card-text-seller-name"]');
        
        if (sellerCard) {
            extracted.seller_info = sellerCard.innerText; 
            if (sellerCard.tagName === 'A') profileUrl = sellerCard.href;
            else {
                const link = sellerCard.querySelector('a');
                if (link) profileUrl = link.href;
            }
        } else {
            const userLink = document.querySelector('a[href*="/u/"]');
            if (userLink) {
                profileUrl = userLink.href;
                extracted.seller_info = userLink.innerText;
            }
        }

        // 5. DEEP DIVE: FETCH HIDDEN JSON DATA
        // This gets the REAL listing count and join date from the database
        if (profileUrl) {
            try {
                const response = await fetch(profileUrl);
                const htmlText = await response.text();
                
                // METHOD A: Parse React State (__NEXT_DATA__)
                const jsonMatch = htmlText.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
                
                if (jsonMatch && jsonMatch[1]) {
                    const jsonData = JSON.parse(jsonMatch[1]);
                    const rawString = JSON.stringify(jsonData);
                    
                    // Regex the JSON for exact stats
                    const listCount = rawString.match(/"listingCount":\s*(\d+)/);
                    if(listCount) extracted.active_listings = parseInt(listCount[1]);

                    const followCount = rawString.match(/"followersCount":\s*(\d+)/);
                    if(followCount) extracted.follower_count = parseInt(followCount[1]);

                    const revCount = rawString.match(/"reviewCount":\s*(\d+)/);
                    if(revCount) extracted.rating_count = parseInt(revCount[1]);

                    const joinMatch = rawString.match(/"dateJoined":\s*"(\d{4})/);
                    if(joinMatch) extracted.joined_date = joinMatch[1];
                    
                    extracted.seller_info += ` | JSON VERIFIED DATA FOUND`;
                } 
                else {
                    // METHOD B: Fallback to Meta Tags
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlText, "text/html");
                    
                    const metaDesc = doc.querySelector('meta[name="description"]');
                    if (metaDesc) {
                        const descContent = metaDesc.getAttribute("content");
                        const metaMatch = descContent.match(/(\d+)\s+listings?/i);
                        if (metaMatch) extracted.active_listings = parseInt(metaMatch[1]);
                    }
                }

        // =========================================================
        // PATCH: VISUAL FALLBACK FOR DATES (Fixes the "Unknown" date issue)
        // =========================================================
        if (extracted.joined_date === "Unknown") {
            // Find any element saying "Joined Xy ago"
            const allText = document.body.innerText;
            const relativeMatch = allText.match(/Joined\s+(\d+)([ym])/i); // Matches "Joined 4y" or "Joined 2m"
            
            if (relativeMatch) {
                const num = parseInt(relativeMatch[1]);
                const unit = relativeMatch[2]; // 'y' or 'm'
                
                if (unit === 'y') {
                    // Send the raw number for the server to handle
                    extracted.joined_year = num; // We pass age as year temporarily, server logic (above) will catch it
                    extracted.relative_date_string = `${num}y`; 
                } else {
                    // Months/days = New account
                    extracted.relative_date_string = "0y";
                }
            }
        }

            } catch (err) {
                console.log("JSON Parse failed:", err);
            }
        }
    }

    return JSON.stringify(extracted);
}

function displayResult(data) {
  const resultDiv = document.getElementById("result");
  const loadingDiv = document.getElementById("loading");
  const analyzeBtn = document.getElementById("analyzeBtn");
  
  loadingDiv.classList.add("hidden");
  resultDiv.classList.remove("hidden");
  if(analyzeBtn) analyzeBtn.style.display = 'none';

  if (!data) data = {};
  
  // 1. Logic: Map Verdict to Exact Visuals
  // We ignore the raw 'risk_score' if it conflicts with the verdict to ensure consistency.
  let visualScore = 10; // Default Safe
  let color = "#10B981"; // Green
  let bgClass = "bg-safe";
  let verdictText = (data.verdict || "SAFE").toUpperCase();

  if (verdictText.includes("CAUTION")) {
      visualScore = 38; // Force to Yellow segment
      color = "#F59E0B";
      bgClass = "bg-caution";
  } else if (verdictText.includes("HIGH")) {
      visualScore = 63; // Force to Orange segment
      color = "#F97316";
      bgClass = "bg-high-risk";
  } else if (verdictText.includes("CRITICAL")) {
      visualScore = 88; // Force to Red segment
      color = "#EF4444";
      bgClass = "bg-critical";
  } else {
      // Safe
      visualScore = 10; 
      color = "#10B981";
      bgClass = "bg-safe";
  }

  // 2. Update Header & Bar
  const verdictEl = document.getElementById("verdict");
  verdictEl.innerText = verdictText;
  verdictEl.style.color = color;

  const scoreFill = document.getElementById("score-fill");
  setTimeout(() => {
    scoreFill.style.width = `${visualScore}%`;
    scoreFill.style.backgroundColor = color;
  }, 100);

  // 3. Render Cards
  const list = document.getElementById("flags");
  const actionHighlight = (verdictText === "SAFE") ? "background: #ECFDF5;" : 
                          (verdictText === "CRITICAL") ? "background: #FEF2F2;" : "";

  let keyFindingsHtml = '';
  if(data.key_findings) {
      keyFindingsHtml = `<ul class="card-list" style="padding-left:0; list-style:none; margin:0;">
        ${data.key_findings.map(flag => {
            const text = typeof flag === 'object' ? Object.values(flag).join(" ") : flag;
            return `<li>${text}</li>`;
        }).join('')}
      </ul>`;
  }

  // Google Search Button Logic
  const searchTerm = data.item_name || "marketplace item";
  const marketPriceHtml = data.market_price_range ? `
    <div class="info-card" style="background: #eff6ff; border-left: 4px solid #3b82f6;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
            <span class="box-label" style="color: #3b82f6; margin:0;">💰 Market Price</span>
        </div>
        <div style="font-size: 15px; font-weight: 700; color: #1e3a8a; margin-bottom: 8px;">
            ${data.market_price_range}
        </div>
        <div style="font-size: 11px;">
            <a href="https://www.google.com/search?q=${encodeURIComponent(searchTerm)}+price+philippines" target="_blank" style="color: #2563eb; text-decoration: none; font-weight: 600;">
                🔎 Verify "${searchTerm}" &rarr;
            </a>
        </div>
    </div>
  ` : '';

  list.innerHTML = `
    <div class="info-card ${bgClass}">
        <span class="box-label">Prediction</span>
        <div class="card-content">${data.prediction || "Check complete."}</div>
    </div>

    ${marketPriceHtml}

    <div class="info-card ${bgClass}" style="${actionHighlight}">
        <span class="box-label">Recommended Action</span>
        <div class="card-content" style="font-weight: 700;">${data.action_step}</div>
    </div>

    <div class="info-card" style="border-left: 4px solid #E5E7EB;">
        <span class="box-label">Key Findings</span>
        ${keyFindingsHtml}
    </div>
  `;
}