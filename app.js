// Set up PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAgyfmyHdr9dJxngBe3deUhHqLO4CFW-Go",
  authDomain: "geonix-desk.firebaseapp.com",
  databaseURL: "https://geonix-desk-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "geonix-desk",
  storageBucket: "geonix-desk.firebasestorage.app",
  messagingSenderId: "246548457312",
  appId: "1:246548457312:web:fc3b2da650e78481c56005",
  measurementId: "G-G85Q4PDZ9G"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Toast Notification
function showToast(message, type = 'success') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-solid fa-circle-check' : (type === 'warning' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-info');
    toast.innerHTML = `
        <i class="${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, 4500);
}

// Database Layer using LocalStorage & Firebase Cloud Real-Time Sync
function getLocalRecords() {
    const data = localStorage.getItem('geonix_reconciled_db');
    return data ? JSON.parse(data) : [];
}

// Save locally and push to Realtime Database shared path
function saveLocalRecords(records) {
    localStorage.setItem('geonix_reconciled_db', JSON.stringify(records));
    
    db.ref('shared/workspace').set({ records: records })
        .catch(error => {
            console.error("Realtime DB cloud sync write error:", error);
            showToast("Cloud sync failed. Local copy saved.", "warning");
        });
}

// Initialize Real-Time Sync listener
function initRealTimeSync() {
    showToast('Connecting to Firebase Real-time Cloud...', 'info');
    
    db.ref('shared/workspace').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data && data.records !== undefined) {
            const remoteRecords = data.records;
            localStorage.setItem('geonix_reconciled_db', JSON.stringify(remoteRecords));
            renderFeed();
            showToast('Real-time database updated.', 'success');
        } else {
            // First time setup: If Realtime DB is empty, initialize it with current local storage cache
            const localData = localStorage.getItem('geonix_reconciled_db');
            const initialRecords = localData ? JSON.parse(localData) : [];
            db.ref('shared/workspace').set({ records: initialRecords })
                .then(() => {
                    showToast('Initialized Realtime Database.', 'success');
                    renderFeed();
                })
                .catch(err => {
                    console.error("Realtime DB init error:", err);
                    renderFeed();
                });
        }
    }, (error) => {
        console.error("Realtime DB sync error:", error);
        showToast("Cloud connection error. Running offline.", "warning");
        renderFeed();
    });
}

// Start Real-Time Sync
initRealTimeSync();

// Extract PDF text content
// Extract PDF text content (preserving structural layout line breaks!)
async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        // Convert and map items to check coordinates
        const items = textContent.items.map(item => ({
            str: item.str,
            x: item.transform[4],
            y: item.transform[5]
        }));
        
        // Sort items: top-to-bottom (Y descending), then left-to-right (X ascending)
        items.sort((a, b) => {
            if (Math.abs(a.y - b.y) > 5) {
                return b.y - a.y;
            }
            return a.x - b.x;
        });

        // Group items by Y coordinate (within 5 units) to form lines
        const lines = [];
        let currentLine = [];
        let lastY = null;
        
        for (const item of items) {
            if (lastY !== null && Math.abs(item.y - lastY) > 5) {
                if (currentLine.length > 0) {
                    lines.push(currentLine);
                }
                currentLine = [];
            }
            currentLine.push(item);
            lastY = item.y;
        }
        if (currentLine.length > 0) {
            lines.push(currentLine);
        }

        let pageText = '';
        for (const lineItems of lines) {
            // Separate line items into left (x < 280) and right (x >= 280) columns
            const leftItems = [];
            const rightItems = [];
            for (const item of lineItems) {
                if (item.x < 280) {
                    leftItems.push(item);
                } else {
                    rightItems.push(item);
                }
            }
            
            let lineText = '';
            if (leftItems.length > 0 && rightItems.length > 0) {
                const leftStr = leftItems.map(item => item.str).join(' ').trim();
                const rightStr = rightItems.map(item => item.str).join(' ').trim();
                // Put ||| to distinguish the two columns in side-by-side layouts
                lineText = leftStr + ' ||| ' + rightStr;
            } else {
                lineText = lineItems.map(item => item.str).join(' ').trim();
            }
            pageText += lineText + '\n';
        }
        
        fullText += pageText + '\n';
    }
    return fullText;
}

// Helper function to deduplicate a side-by-side column line (like Bill To + Ship To side-by-side duplicates)
function deduplicateMergedLine(line) {
    if (!line) return '';
    line = line.trim();
    
    // Clean trailing punctuation like commas
    const cleanStr = line.replace(/,+$/, '').trim();
    
    // Word-level split
    const words = cleanStr.split(/\s+/);
    if (words.length >= 2 && words.length % 2 === 0) {
        const mid = words.length / 2;
        const firstHalf = words.slice(0, mid).join(' ');
        const secondHalf = words.slice(mid).join(' ');
        if (firstHalf.toUpperCase() === secondHalf.toUpperCase()) {
            return secondHalf;
        }
    }
    
    // Character-level split
    const midChar = Math.floor(cleanStr.length / 2);
    const part1 = cleanStr.substring(0, midChar).trim().replace(/,+$/, '').trim();
    const part2 = cleanStr.substring(midChar).trim().replace(/,+$/, '').trim();
    if (part1.toUpperCase() === part2.toUpperCase() || 
        part1.replace(/[^A-Z0-9]/ig, '') === part2.replace(/[^A-Z0-9]/ig, '')) {
        return part2; // Return the Ship To (second) half!
    }
    
    // Comma-separated split
    if (cleanStr.includes(',')) {
        const parts = cleanStr.split(',').map(p => p.trim()).filter(p => p.length > 0);
        if (parts.length >= 2 && parts.length % 2 === 0) {
            const mid = parts.length / 2;
            const firstHalf = parts.slice(0, mid).join(', ');
            const secondHalf = parts.slice(mid).join(', ');
            if (firstHalf.toUpperCase() === secondHalf.toUpperCase() || 
                firstHalf.replace(/[^A-Z0-9]/ig, '') === secondHalf.replace(/[^A-Z0-9]/ig, '')) {
                return secondHalf;
            }
        }
    }
    
    return line;
}

// Helper function to clean side-by-side merged text (removes right-column metadata keywords)
function cleanSideBySideText(line, columnSelect = null) {
    if (!line) return '';
    
    // Split by column separator first if requested and present
    if (columnSelect && line.includes('|||')) {
        const parts = line.split('|||');
        if (columnSelect === 'left') {
            line = parts[0].trim();
        } else if (columnSelect === 'right') {
            line = parts[1].trim();
        }
    }
    
    const keywords = [
        /Sales\s*Order/i, /Order\s*Date/i, /Total\s*Qty/i, /Number\s*of\s*Boxes/i, 
        /Weight/i, /Invoice\s*Date/i, /Invoice\s*Number/i, /Due\s*Date/i, 
        /E-Way\s*Bill/i, /Carrier/i, /Tracking/i, /GSTIN/i, /PAN/i
    ];
    for (const kw of keywords) {
        const match = line.match(kw);
        if (match) {
            line = line.substring(0, match.index).trim();
        }
    }
    
    // Deduplicate any side-by-side duplicate columns
    line = deduplicateMergedLine(line);
    
    return line.trim();
}

// Helper function to deduplicate customer names extracted from side-by-side columns
function cleanDuplicatedName(name) {
    if (!name) return name;
    name = name.trim();
    
    // Strip leading Bill-To or Ship-To prefixes (including optional colons, spaces, hyphens)
    name = name.replace(/^(?:Bill|Ship)[\s\-]?To\s*[:\-]?\s*/i, '').trim();
    
    // Split by whitespace and check word-level repetition
    const words = name.split(/\s+/);
    if (words.length >= 2 && words.length % 2 === 0) {
        const mid = words.length / 2;
        const firstHalf = words.slice(0, mid).join(' ');
        const secondHalf = words.slice(mid).join(' ');
        if (firstHalf.toUpperCase() === secondHalf.toUpperCase()) {
            return firstHalf;
        }
    }
    
    // Check character-level repetition
    const midChar = Math.floor(name.length / 2);
    const part1 = name.substring(0, midChar).trim();
    const part2 = name.substring(midChar).trim();
    if (part1.toUpperCase() === part2.toUpperCase()) {
        return part1;
    }
    
    return name;
}

// Helper function to isolate Ship-To address from vertically merged address blocks
function isolateShipToAddress(block, customerName) {
    if (!block || block === 'N/A') return block;
    
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return block;
    
    // If it contains column separator |||, it's already split
    if (block.includes('|||')) {
        return block;
    }
    
    // 1. Look for the last occurrence of the customer name (case-insensitive) starting from line 2
    if (customerName && customerName !== 'Unknown Customer') {
        const lowerName = customerName.toLowerCase();
        let lastIdx = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].toLowerCase() === lowerName || lines[i].toLowerCase().includes(lowerName)) {
                lastIdx = i;
            }
        }
        if (lastIdx !== -1) {
            return lines.slice(lastIdx).join('\n');
        }
    }
    
    // 2. Fallback: Look for last occurrence of standard Bill To end markers (GSTIN, PAN, Phone)
    let lastMarkerIdx = -1;
    const markers = [/GSTIN\b/i, /PAN\b/i, /Phone\b/i, /\+91/i, /\b\d{10}\b/];
    for (let i = 0; i < lines.length; i++) {
        for (const marker of markers) {
            if (marker.test(lines[i])) {
                lastMarkerIdx = i;
                break;
            }
        }
    }
    if (lastMarkerIdx !== -1 && lastMarkerIdx + 1 < lines.length) {
        return lines.slice(lastMarkerIdx + 1).join('\n');
    }
    
    return block;
}

// Advanced Document Details Parser
function parseDocumentText(text) {
    const isInvoice = text.includes('TAX INVOICE') || text.includes('Invoice Number');
    const isShipment = text.includes('SHIPMENT ORDER') || text.includes('Shipment Order#');

    const result = {
        type: isInvoice ? 'invoice' : (isShipment ? 'shipment' : 'unknown'),
        customer_name: 'Unknown Customer',
        items: [],
        total_qty: 0
    };

    // Strip column separator for general regex parsing to prevent breaking item/qty matches
    const textNoSeparators = text.replace(/\|\|\|/g, ' ');

    // 1. Get Customer Name
    const knownCustomers = [
        'SRI SAI LAXMI CABLES', 
        'BALAJI ELECTRONICS', 
        'KRISHNA ENTERPRISES', 
        'DYNAMIC INFOTECH', 
        'SABARMATI SYSTEMS', 
        'AANIKA INFOTECH', 
        'SHRI BALAJI CABLE TRONICS', 
        'SKYLINE SYSTEM AND TECHNOLOGIES'
    ];
    let foundCustomer = '';
    for (const customer of knownCustomers) {
        if (textNoSeparators.toUpperCase().includes(customer)) {
            foundCustomer = customer;
            break;
        }
    }
    if (foundCustomer) {
        result.customer_name = foundCustomer;
    } else {
        // Try regex match using suffix patterns in Bill To or Ship To (strictly matching words, no address punctuation)
        const billToRegex = /Bill[\s\-]?To\s*[:\-]?\s*([A-Z0-9\s&.\-]{4,}(?:CABLES|ELECTRONICS|ENTERPRISES|INFOTECH|SYSTEMS|LTD|PVT|CO|CORP|TRONICS|TECHNOLOGIES|TECHNOLOGY|SYSTEM|TECH|SERVICES|SERVICE|COMMUNICATION|COMMUNICATIONS|NETWORKS|NETWORK|SOLUTIONS|SOLUTION|GLOBAL|RETAIL|SALES|DISTRIBUTORS|DISTRIBUTOR))/i;
        const shipToRegex = /Ship[\s\-]?To\s*[:\-]?\s*([A-Z0-9\s&.\-]{4,}(?:CABLES|ELECTRONICS|ENTERPRISES|INFOTECH|SYSTEMS|LTD|PVT|CO|CORP|TRONICS|TECHNOLOGIES|TECHNOLOGY|SYSTEM|TECH|SERVICES|SERVICE|COMMUNICATION|COMMUNICATIONS|NETWORKS|NETWORK|SOLUTIONS|SOLUTION|GLOBAL|RETAIL|SALES|DISTRIBUTORS|DISTRIBUTOR))/i;
        
        const billMatch = textNoSeparators.match(billToRegex);
        const shipMatch = textNoSeparators.match(shipToRegex);
        
        let candidateName = '';
        if (billMatch && billMatch[1]) {
            candidateName = billMatch[1].trim();
        } else if (shipMatch && shipMatch[1]) {
            candidateName = shipMatch[1].trim();
        }
        
        if (!candidateName) {
            // Robust Fallback: extract the first line of the Bill To or Ship To block (matching original text coordinates)
            const billBlockMatch = text.match(/Bill[\s\-]?To\s*[:\-]?\s*([^]+?)(?=\s*(?:\n\s*#\s|\s+#\s|Item & Description|Bank Details|Terms|\n\s*Ship[\s\-]?To|$))/i);
            const shipBlockMatch = text.match(/Ship[\s\-]?To\s*[:\-]?\s*([^]+?)(?=\s*(?:\n\s*#\s|\s+#\s|Item & Description|Bank Details|Terms|\n\s*Bill[\s\-]?To|$))/i);
            
            if (billBlockMatch && billBlockMatch[1]) {
                const billLines = billBlockMatch[1].trim().split(/\r?\n/)
                    .map(l => cleanSideBySideText(l, 'left'))
                    .map(l => l.trim())
                    .filter(l => l.length > 0);
                if (billLines.length > 0) {
                    candidateName = billLines[0];
                }
            }
            if (!candidateName && shipBlockMatch && shipBlockMatch[1]) {
                const shipLines = shipBlockMatch[1].trim().split(/\r?\n/)
                    .map(l => cleanSideBySideText(l, isInvoice ? 'right' : 'left'))
                    .map(l => l.trim())
                    .filter(l => l.length > 0);
                if (shipLines.length > 0) {
                    candidateName = shipLines[0];
                }
            }
        }

        if (candidateName) {
            result.customer_name = cleanDuplicatedName(candidateName);
        }
    }

    // 2. Parse Items & Quantities
    const cleanText = textNoSeparators.replace(/\s+/g, ' ');

    // Isolate the item table block to avoid matching numbers in headers, addresses, or tax summaries
    let tableText = cleanText;
    const startKeywords = [/Item\s*&\s*Description/i, /Description\s+of\s+Goods/i, /Description/i, /HSN\/SAC/i];
    const endKeywords = [/Amount\s+Chargeable/i, /Company's\s+Bank\s+Details/i, /Bank\s+Details/i, /Taxable\s+Value/i, /Total\s+CGST/i, /Total\s+SGST/i, /Total\s+IGST/i, /Total\s+Tax/i, /Total\s+Amount/i, /Declaration/i, /Terms/i];
    
    // Find start of table
    let startIdx = 0;
    for (const rx of startKeywords) {
        const m = cleanText.match(rx);
        if (m) {
            startIdx = m.index;
            break;
        }
    }
    
    // Find end of table (relative to start of table)
    let endIdx = cleanText.length;
    const postStartText = cleanText.substring(startIdx);
    for (const rx of endKeywords) {
        const m = postStartText.match(rx);
        if (m) {
            endIdx = startIdx + m.index;
            break;
        }
    }
    
    // Crop the clean text to ONLY contain the item table
    const tableCleanText = cleanText.substring(startIdx, endIdx);

    // Enhanced regex supporting standard special characters (like commas, slashes, ampersands, pluses, percents, etc.) in the description,
    // HSN sizes from 6 to 8 digits, and optional units/pcs, followed by rate.
    const itemRegex = /(?:\b\d+\b)\s+([A-Za-z0-9\s()."*#\-&/+,%':@]+?)\s+(\d{6,8})\s+(\d+)\s*(?:pcs|nos|units|qty|box|boxes)?\s*([\d,]+\.\d{2})?/gi;
    let match;
    let foundItems = false;
    
    while ((match = itemRegex.exec(tableCleanText)) !== null) {
        const name = match[1].trim();
        const qty = parseInt(match[3]);
        const rate = match[4] ? match[4].trim() : 'N/A';
        result.items.push({ name, qty, rate });
        result.total_qty += qty;
        foundItems = true;
    }

    // Try alternate regex inside table text if HSN is missing but units (pcs/nos/etc.) are mentioned
    if (!foundItems) {
        const altItemRegex = /(?:\b\d+\b)\s+([A-Za-z0-9\s()."*#\-&/+,%':@]+?)\s+(\d+)\s*(?:pcs|nos|units|qty|box|boxes)?\s*([\d,]+\.\d{2})?/gi;
        while ((match = altItemRegex.exec(tableCleanText)) !== null) {
            const name = match[1].trim();
            const qty = parseInt(match[2]);
            const rate = match[3] ? match[3].trim() : 'N/A';
            result.items.push({ name, qty, rate });
            result.total_qty += qty;
            foundItems = true;
        }
    }

    if (!foundItems) {
        // Robust fallback matching for "Qty 40", "Total Qty: 40", or "Quantity \n 40" from the full text
        const qtyMatch = textNoSeparators.match(/Quantity\s*[:\-]?\s*(\d+)/i) ||
                         textNoSeparators.match(/Qty\s*[:\-]?\s*(\d+)/i) || 
                         textNoSeparators.match(/Total\s+Qty\s*[:\-]?\s*(\d+)/i) || 
                         textNoSeparators.match(/Total\s+Quantity\s*[:\-]?\s*(\d+)/i);
        const qtyVal = qtyMatch ? parseInt(qtyMatch[1]) : 1;
        
        let itemName = 'Warehouse Material Pack';
        if (textNoSeparators.toUpperCase().includes('MONITOR')) {
            itemName = 'MONITOR Geonix 18.5" LED (HDMI)';
        } else if (textNoSeparators.toUpperCase().includes('RAM')) {
            itemName = 'GEONIX RAM 8GB DDR4';
        } else if (textNoSeparators.toUpperCase().includes('SSD')) {
            itemName = 'GEONIX SSD 512GB SATA';
        }
        
        result.items.push({ name: itemName, qty: qtyVal, rate: 'N/A' });
        result.total_qty = qtyVal;
    }

    // Parse Ship To details strictly from Ship To block (for both types!)
    const shipToMatch = text.match(/Ship[\s\-]?To\s*[:\-]?\s*([^]+?)(?=\s*(?:\n\s*#\s|\s+#\s|Item & Description|Bank Details|Terms|$))/i);
    if (shipToMatch) {
        const rawBlock = shipToMatch[1].trim();
        const cleanedLines = rawBlock.split(/\r?\n/)
            .map(l => cleanSideBySideText(l, isInvoice ? 'right' : 'left'))
            .map(l => l.trim())
            .filter(l => l.length > 0);
        let shipBlock = cleanedLines.join('\n');
        if (isInvoice) {
            shipBlock = isolateShipToAddress(shipBlock, result.customer_name);
        }
        
        let pincode = 'N/A';
        let state = 'N/A';
        let city = 'N/A';

        // 1. Find Pincode (6-digit number)
        const pinMatch = shipBlock.match(/\b\d{6}\b/);
        if (pinMatch) {
            pincode = pinMatch[0];
        }

        // 2. Find State
        const statesList = [
            'ANDHRA PRADESH', 'ARUNACHAL PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GOA', 'GUJARAT', 
            'HARYANA', 'HIMACHAL PRADESH', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA PRADESH', 
            'MAHARASHTRA', 'MANIPUR', 'MEGHALAYA', 'MIZORAM', 'NAGALAND', 'ODISHA', 'PUNJAB', 
            'RAJASTHAN', 'SIKKIM', 'TAMIL NADU', 'TELANGANA', 'TRIPURA', 'UTTAR PRADESH', 
            'UTTARAKHAND', 'WEST BENGAL', 'DELHI'
        ];
        for (const st of statesList) {
            const regex = new RegExp('\\b' + st.replace(' ', '\\s+') + '\\b', 'i');
            if (regex.test(shipBlock)) {
                const matchObj = shipBlock.match(regex);
                state = matchObj ? matchObj[0] : st;
                break;
            }
        }
        if (state !== 'N/A') {
            state = state.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.substring(1).toLowerCase()).join(' ');
        }

        // 3. Find City using split lines and keywords heuristics
        const lines = shipBlock.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        let pinLineIndex = -1;
        if (pincode !== 'N/A') {
            pinLineIndex = lines.findIndex(l => l.includes(pincode));
        }

        const nonCityWords = [
            'INDIA', 'STATE', 'CITY', 'PINCODE', 'GSTIN', 'PAN', 'ANDHRA', 'PRADESH', 'BENGAL', 'KASHMIR', 
            'NADU', 'DELHI', 'TELANGANA', 'MAHARASHTRA', 'KARNATAKA', 'TAMIL', 'UTTAR', 'GUJARAT', 
            'WEST', 'DIST', 'DISTRICT', 'TALUKA', 'NEAR', 'OPP', 'BESIDE', 'ROAD', 'STREET', 'FLOOR', 
            'BUILDING', 'GALA', 'PARK', 'ESTATE', 'INDUSTRIAL', 'ZONE', 'SECTOR', 'LTD', 'PVT', 'LIMITED',
            'CABLES', 'ELECTRONICS', 'ENTERPRISES', 'INFOTECH', 'SYSTEMS'
        ];

        if (pinLineIndex !== -1) {
            const pinLine = lines[pinLineIndex];
            const cleanPinLine = pinLine.replace(pincode, '').replace(/[,.\-/]+/g, ' ').trim();
            const words = cleanPinLine.split(/\s+/).map(w => w.replace(/[^A-Za-z]/g, '')).filter(w => w.length > 2);
            
            for (let i = words.length - 1; i >= 0; i--) {
                const w = words[i].toUpperCase();
                if (!nonCityWords.includes(w)) {
                    city = words[i];
                    break;
                }
            }

            if (city === 'N/A' && pinLineIndex > 0) {
                const prevLine = lines[pinLineIndex - 1];
                const cleanPrevLine = prevLine.replace(/[,.\-/]+/g, ' ').trim();
                const wordsPrev = cleanPrevLine.split(/\s+/).map(w => w.replace(/[^A-Za-z]/g, '')).filter(w => w.length > 2);
                
                for (let i = wordsPrev.length - 1; i >= 0; i--) {
                    const w = wordsPrev[i].toUpperCase();
                    if (!nonCityWords.includes(w)) {
                        city = wordsPrev[i];
                        break;
                    }
                }
            }
        }

        if (city === 'N/A') {
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i];
                const words = line.split(/[,.\-/:\s]+/).map(w => w.replace(/[^A-Za-z]/g, '')).filter(w => w.length > 2);
                for (let j = words.length - 1; j >= 0; j--) {
                    const w = words[j].toUpperCase();
                    if (!nonCityWords.includes(w)) {
                        city = words[j];
                        break;
                    }
                }
                if (city !== 'N/A') break;
            }
        }

        if (city !== 'N/A') {
            city = city.toUpperCase();
        }

        result.ship_to_address = shipBlock;
        result.ship_to_city = city;
        result.ship_to_state = state;
        result.ship_to_pincode = pincode;
    } else {
        result.ship_to_address = 'N/A';
        result.ship_to_city = 'N/A';
        result.ship_to_state = 'N/A';
        result.ship_to_pincode = 'N/A';
    }

    // 3. Tax Invoice Parsing Details
    if (isInvoice) {
        const invNumMatch = textNoSeparators.match(/Invoice Number\s*:\s*([^\s\r\n]+)/i) || textNoSeparators.match(/Invoice Number\s+([^\s\r\n]+)/i);
        const invDateMatch = textNoSeparators.match(/Invoice Date\s*:\s*([\d/]+)/i) || textNoSeparators.match(/Invoice Date\s+([\d/]+)/i);
        const dueDateMatch = textNoSeparators.match(/Due Date\s*:\s*([\d/]+)/i) || textNoSeparators.match(/Due Date\s+([\d/]+)/i);
        const ewayMatch = textNoSeparators.match(/E-Way Bill#\s*:\s*([^\s\r\n]+)/i) || textNoSeparators.match(/E-Way Bill#\s+([^\s\r\n]+)/i);

        // Robust Invoice Amount Parser: Grand Total / Total Amount check with max candidate fallback
        let parsedAmount = 0.00;
        let candidates = [];

        // 1. Match explicit grand totals/chargeable amounts
        const grandTotalMatch = textNoSeparators.match(/(?:Grand\s+Total|Total\s+Amount|Invoice\s+Amount|Total\s+Value|Amount\s+Chargeable)\s*[:\-]?\s*₹?\s*([\d,]+\.\d{2})/i);
        if (grandTotalMatch) {
            candidates.push(parseFloat(grandTotalMatch[1].replace(/,/g, '')));
        }

        // 2. Match all standard total patterns
        const totalMatches = [...textNoSeparators.matchAll(/(?:\bTotal\b|\bSub\s*Total\b|\bGrand\s+Total\b|\bAmount\s+Chargeable\b)\s*[:\-]?\s*₹?\s*([\d,]+\.\d{2})/gi)];
        totalMatches.forEach(m => {
            const val = parseFloat(m[1].replace(/,/g, ''));
            if (!isNaN(val)) {
                candidates.push(val);
            }
        });

        // 3. Fallback loose matchers
        const looseMatches = [...textNoSeparators.matchAll(/Total\s*[:\-]?\s*₹?\s*([\d,]+\.\d{2})/gi)];
        looseMatches.forEach(m => {
            const val = parseFloat(m[1].replace(/,/g, ''));
            if (!isNaN(val)) {
                candidates.push(val);
            }
        });

        // Choose the maximum value from all candidates to select the grand total (subtotal + tax)
        if (candidates.length > 0) {
            parsedAmount = Math.max(...candidates);
        } else {
            const altMatch = textNoSeparators.match(/Total\s+([\d,]+\.\d{2})/i) || textNoSeparators.match(/Total\s+([\d.]+)/i);
            parsedAmount = altMatch ? parseFloat(altMatch[1].replace(/,/g, '')) : 0.00;
        }

        // Robust Sales Person Parser
        let parsedSalesPerson = 'N/A';
        const spMatch = textNoSeparators.match(/Sales\s*person\s*:\s*([^\n\r\t]+)/i) || textNoSeparators.match(/Sales\s*person\s+([^\n\r\t]+)/i);
        if (spMatch && spMatch[1]) {
            let val = spMatch[1].trim();
            const stopKeywords = ['Place Of Supply', 'Due Date', 'Terms', 'E-Way Bill#', 'GSTIN', 'PAN', 'Bill To', 'Ship To', 'Bill-To', 'Ship-To'];
            for (const keyword of stopKeywords) {
                const idx = val.toLowerCase().indexOf(keyword.toLowerCase());
                if (idx !== -1) {
                    val = val.substring(0, idx).trim();
                }
            }
            val = val.replace(/^[:\s\-]+|[:\s\-]+$/g, '').trim();
            if (val) {
                parsedSalesPerson = val;
            }
        }

        // Bill to customer metadata
        const gstinMatch = textNoSeparators.match(/GSTIN\s+([A-Z0-9]{15})/i);
        const panMatch = textNoSeparators.match(/PAN\s+([A-Z]{5}\d{4}[A-Z])/i);
        const phoneMatch = textNoSeparators.match(/(?:\+91|91)?(\d{10})/);

        result.invoice_number = invNumMatch ? invNumMatch[1].trim() : `INV-${Math.floor(100 + Math.random() * 900)}`;
        result.invoice_date = invDateMatch ? invDateMatch[1].trim() : new Date().toLocaleDateString('en-GB');
        result.due_date = dueDateMatch ? dueDateMatch[1].trim() : '';
        result.sales_person = parsedSalesPerson;
        result.eway_bill = ewayMatch ? ewayMatch[1].trim() : 'N/A';
        result.invoice_amount = parsedAmount;
        
        result.gstin = gstinMatch ? gstinMatch[1].trim() : 'N/A';
        result.pan = panMatch ? panMatch[1].trim() : 'N/A';
        result.phone = phoneMatch ? phoneMatch[1].trim() : 'N/A';
    }

    // 4. Shipment Order Parsing Details
    if (isShipment) {
        const shpNumMatch = textNoSeparators.match(/Shipment Order#\s*([^\s\r\n]+)/i) || textNoSeparators.match(/Shipment Order#\s+([^\s\r\n]+)/i);
        // Robust Shipment Date Parser: Permissive regex allowing newlines and colons
        let parsedShipmentDate = '';
        const robustShpDateMatch = textNoSeparators.match(/Shipment\s+Date\s*[\r\n\s:]+\s*([\d/]{8,10})/i);
        if (robustShpDateMatch) {
            parsedShipmentDate = robustShpDateMatch[1].trim();
        } else {
            // Find the first date matching DD/MM/YYYY in the text
            const firstDateMatch = textNoSeparators.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
            if (firstDateMatch) {
                parsedShipmentDate = firstDateMatch[0];
            } else {
                parsedShipmentDate = new Date().toLocaleDateString('en-GB');
            }
        }
        
        // Multi-line column layout safe extraction for Carrier and Tracking Number
        let parsedCarrier = 'DELHIVERY';
        let parsedTracking = '';
        const lines = textNoSeparators.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        const headerIdx = lines.findIndex(l => l.toUpperCase().includes('SHIPPING CARRIER') && l.toUpperCase().includes('TRACKING#'));
        if (headerIdx !== -1 && headerIdx + 1 < lines.length) {
            const valLine = lines[headerIdx + 1];
            let parts = valLine.split(/\s+/).map(p => p.trim()).filter(p => p.length > 0);
            
            // Filter out any date from the parts (like Shipment Date 10/03/2026) and store it
            const dateIdx = parts.findIndex(p => p.match(/^\d{2}[-/\.]\d{2}[-/\.]\d{4}$/) || p.match(/^\d{4}[-/\.]\d{2}[-/\.]\d{2}$/));
            if (dateIdx !== -1) {
                result.shipment_date = parts[dateIdx];
                parts.splice(dateIdx, 1);
            }
            
            if (parts.length >= 2) {
                parsedCarrier = parts[0];
                parsedTracking = parts[1];
            } else if (parts.length === 1) {
                if (parts[0].match(/^\d+$/) || parts[0].includes('-')) {
                    parsedTracking = parts[0];
                } else {
                    parsedCarrier = parts[0];
                }
            }
        } else {
            const carrierMatch = textNoSeparators.match(/Shipping Carrier\s*:\s*([A-Za-z]+)/i) || textNoSeparators.match(/Shipping Carrier\s+([A-Za-z]+)/i);
            if (carrierMatch && carrierMatch[1] && carrierMatch[1].toUpperCase() !== 'TRACKING') {
                parsedCarrier = carrierMatch[1].trim();
            }
            const trackMatch = textNoSeparators.match(/TRACKING#\s*:\s*([A-Z0-9\-]+)/i) || textNoSeparators.match(/TRACKING#\s*([A-Z0-9\-]+)/i);
            if (trackMatch && trackMatch[1] && trackMatch[1].toUpperCase() !== 'DELHIVERY') {
                parsedTracking = trackMatch[1].trim();
            }
        }

        const orderDateMatch = textNoSeparators.match(/Order Date\s*:\s*([\d/]+)/i) || textNoSeparators.match(/Order Date\s+([\d/]+)/i);
        const boxesMatch = textNoSeparators.match(/Number of Boxes\s*:\s*(\d+)/i) || textNoSeparators.match(/Boxes\s+(\d+)/i);
        const weightMatch = textNoSeparators.match(/Weight\s*:\s*(\d+)/i) || textNoSeparators.match(/Weight\s+(\d+)/i);

        // Robust Sales Order Number Parser
        let parsedSalesOrder = 'N/A';
        const soMatch = textNoSeparators.match(/Sales Order#\s*:\s*([^\n\r\t]+)/i) || textNoSeparators.match(/Sales Order#\s+([^\n\r\t]+)/i);
        if (soMatch && soMatch[1]) {
            let val = soMatch[1].trim();
            const stopKeywords = ['Order Date', 'Total Qty', 'Number of Boxes', 'Weight', 'Ship To', 'Ship-To'];
            for (const keyword of stopKeywords) {
                const idx = val.toLowerCase().indexOf(keyword.toLowerCase());
                if (idx !== -1) {
                    val = val.substring(0, idx).trim();
                }
            }
            val = val.replace(/^[:\s\-]+|[:\s\-]+$/g, '').trim();
            if (val) {
                parsedSalesOrder = val;
            }
        }

        let parsedTrackingStatus = null;
        const statusMatch = textNoSeparators.match(/Tracking\s+Status\s*[\r\n\s:]+\s*([A-Za-z\s]{3,20}?)(?=\r?\n|Carrier|Tracking#|Shipment|Date|$)/i);
        if (statusMatch) {
            parsedTrackingStatus = statusMatch[1].trim();
        }

        let parsedDeliveryTimestamp = null;
        const delDateMatch = textNoSeparators.match(/Delivered\s+Date\s*[\r\n\s:]+\s*([\d/]{8,10}\s+[\d:]+\s*[APMapm]{2})/i) ||
                             textNoSeparators.match(/Delivered\s+Date\s*[\r\n\s:]+\s*([\d/]{8,10}\s+[\d:]+)/i);
        if (delDateMatch) {
            parsedDeliveryTimestamp = delDateMatch[1].trim();
        }

        result.shipment_number = shpNumMatch ? shpNumMatch[1].trim() : `SHP-${Math.floor(10000 + Math.random() * 90000)}`;
        result.shipment_date = parsedShipmentDate;
        result.carrier = parsedCarrier;
        result.tracking_number = parsedTracking;
        result.tracking_status = parsedTrackingStatus;
        result.delivery_timestamp = parsedDeliveryTimestamp;
        result.sales_order_number = parsedSalesOrder;
        result.order_date = orderDateMatch ? orderDateMatch[1].trim() : 'N/A';
        result.boxes = boxesMatch ? parseInt(boxesMatch[1]) : 1;
        result.weight = weightMatch ? parseFloat(weightMatch[1]) : 10.0;
    }

    return result;
}

// Clean address for comparison (ignoring spaces, newlines, and punctuation)
function cleanAddressForMatch(addr) {
    if (!addr || addr === 'N/A') return '';
    return addr.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Check all strict matching rules (Customer, Quantity, Pincode, City, and State)
function checkMatchingRules(r, parsedDoc, isInvoiceUpload) {
    const isPendingDoc = isInvoiceUpload ? (r.status === 'Pending Invoice') : (r.status === 'Pending Shipment');
    if (!isPendingDoc) return { match: false, reason: '' };
    
    // Check 1: Customer Name
    const nameMatches = r.customer_name === parsedDoc.customer_name;
    
    // Check 2: Quantity
    const docQty = parsedDoc.total_qty;
    const recQty = isInvoiceUpload ? r.shipment_qty : r.invoice_qty;
    const qtyMatches = recQty === docQty;
    
    // Check 3: Pincode
    const pinMatches = r.ship_to_pincode !== 'N/A' && 
                       parsedDoc.ship_to_pincode !== 'N/A' && 
                       r.ship_to_pincode === parsedDoc.ship_to_pincode;
                       
    // Check 4: City
    const recCity = (r.ship_to_city || '').trim().toUpperCase();
    const docCity = (parsedDoc.ship_to_city || '').trim().toUpperCase();
    const cityMatches = recCity !== '' && docCity !== '' && recCity === docCity;
    
    // Check 5: State
    const recState = (r.ship_to_state || '').trim().toUpperCase();
    const docState = (parsedDoc.ship_to_state || '').trim().toUpperCase();
    const stateMatches = recState !== '' && docState !== '' && recState === docState;
    
    // Strict Match: Customer, Quantity, Pincode, City, and State must all match at the same time
    if (nameMatches && qtyMatches && pinMatches && cityMatches && stateMatches) {
        return { match: true, reason: 'Matched' };
    }
    
    // Return mismatch warning details if Customer Name matches but any strict matching criteria fails
    if (nameMatches) {
        let mismatchDetails = [];
        if (!qtyMatches) mismatchDetails.push(`Qty Mismatch (${recQty} vs ${docQty})`);
        if (!pinMatches) mismatchDetails.push(`Pincode Mismatch (${r.ship_to_pincode} vs ${parsedDoc.ship_to_pincode})`);
        if (!cityMatches) mismatchDetails.push(`City Mismatch (${recCity} vs ${docCity})`);
        if (!stateMatches) mismatchDetails.push(`State Mismatch (${recState} vs ${docState})`);
        return { match: false, reason: mismatchDetails.join(', ') };
    }
    
    return { match: false, reason: '' };
}

// Local Database Reconciler Match algorithm
function reconcileDocument(parsedDoc) {
    const records = getLocalRecords();

    if (parsedDoc.type === 'invoice') {
        if (records.some(r => r.invoice_number === parsedDoc.invoice_number)) {
            showToast(`Duplicate: Invoice ${parsedDoc.invoice_number} already exists!`, 'warning');
            return;
        }

        // Look for matching shipment order waiting for invoice (strictly matching Customer, Pincode, Qty & Address)
        let matchIndex = -1;
        let warningReason = '';
        for (let i = 0; i < records.length; i++) {
            const check = checkMatchingRules(records[i], parsedDoc, true);
            if (check.match) {
                matchIndex = i;
                break;
            } else if (check.reason) {
                warningReason = check.reason;
            }
        }
        
        if (matchIndex !== -1) {
            const match = records[matchIndex];
            match.invoice_number = parsedDoc.invoice_number;
            match.invoice_date = parsedDoc.invoice_date;
            match.due_date = parsedDoc.due_date;
            match.eway_bill = parsedDoc.eway_bill;
            match.invoice_amount = parsedDoc.invoice_amount;
            match.invoice_items = parsedDoc.items;
            match.invoice_qty = parsedDoc.total_qty;
            match.invoice_rate = parsedDoc.items[0]?.rate || 'N/A';
            match.sales_person = parsedDoc.sales_person;
            match.gstin = parsedDoc.gstin;
            match.pan = parsedDoc.pan;
            match.phone = parsedDoc.phone;
            match.ship_to_address = parsedDoc.ship_to_address;
            match.ship_to_city = parsedDoc.ship_to_city;
            match.ship_to_state = parsedDoc.ship_to_state;
            match.ship_to_pincode = parsedDoc.ship_to_pincode;
            match.invoice_address = parsedDoc.ship_to_address;
            match.invoice_city = parsedDoc.ship_to_city;
            match.invoice_state = parsedDoc.ship_to_state;
            match.invoice_pincode = parsedDoc.ship_to_pincode;
            match.invoice_customer_name = parsedDoc.customer_name;
            
            // Quantity match check
            match.qty_match = match.invoice_qty === match.shipment_qty;
            match.status = 'Matched';
            
            showToast(`Matched Invoice ${parsedDoc.invoice_number} with Shipment ${match.shipment_number}! Qty Verification: ${match.qty_match ? 'TRUE' : 'FALSE (Qty Mismatch)'}`, 'success');
        } else {
            if (warningReason) {
                showToast(`Strict Match Warning for Customer ${parsedDoc.customer_name}: ${warningReason}`, 'warning');
            }
            // Add as new pending record
            records.push({
                id: 'rec-' + Date.now(),
                customer_name: parsedDoc.customer_name,
                invoice_customer_name: parsedDoc.customer_name,
                shipment_customer_name: null,
                gstin: parsedDoc.gstin,
                pan: parsedDoc.pan,
                phone: parsedDoc.phone,
                ship_to_address: parsedDoc.ship_to_address,
                ship_to_city: parsedDoc.ship_to_city,
                ship_to_state: parsedDoc.ship_to_state,
                ship_to_pincode: parsedDoc.ship_to_pincode,
                invoice_address: parsedDoc.ship_to_address,
                invoice_city: parsedDoc.ship_to_city,
                invoice_state: parsedDoc.ship_to_state,
                invoice_pincode: parsedDoc.ship_to_pincode,
                shipment_address: null,
                shipment_city: null,
                shipment_state: null,
                shipment_pincode: null,
                
                // Invoice Details
                invoice_number: parsedDoc.invoice_number,
                invoice_date: parsedDoc.invoice_date,
                due_date: parsedDoc.due_date,
                eway_bill: parsedDoc.eway_bill,
                invoice_amount: parsedDoc.invoice_amount,
                invoice_items: parsedDoc.items,
                invoice_qty: parsedDoc.total_qty,
                invoice_rate: parsedDoc.items[0]?.rate || 'N/A',
                sales_person: parsedDoc.sales_person,
                
                // Shipment Details (Empty)
                shipment_number: null,
                shipment_date: null,
                carrier: null,
                tracking_number: null,
                tracking_status: 'Pending Upload',
                sales_order_number: null,
                order_date: null,
                shipment_qty: null,
                qty_match: null,
                boxes: null,
                weight: null,
                shipment_items: null,
                
                status: 'Pending Shipment',
                timestamp: new Date().toISOString()
            });
            showToast(`Invoice ${parsedDoc.invoice_number} recorded. Waiting for Shipment Order.`, 'info');
        }
    } else if (parsedDoc.type === 'shipment') {
        if (records.some(r => r.shipment_number === parsedDoc.shipment_number)) {
            showToast(`Duplicate: Shipment ${parsedDoc.shipment_number} already exists!`, 'warning');
            return;
        }

        // Look for matching invoice waiting for shipment (strictly matching Customer, Pincode, Qty & Address)
        let matchIndex = -1;
        let warningReason = '';
        for (let i = 0; i < records.length; i++) {
            const check = checkMatchingRules(records[i], parsedDoc, false);
            if (check.match) {
                matchIndex = i;
                break;
            } else if (check.reason) {
                warningReason = check.reason;
            }
        }
        
        if (matchIndex !== -1) {
            const match = records[matchIndex];
            match.shipment_number = parsedDoc.shipment_number;
            match.shipment_date = parsedDoc.shipment_date;
            match.carrier = parsedDoc.carrier;
            match.tracking_number = parsedDoc.tracking_number;
            match.tracking_status = parsedDoc.tracking_status || 'In Transit';
            if (parsedDoc.delivery_timestamp) {
                match.delivery_timestamp = parsedDoc.delivery_timestamp;
            }
            match.sales_order_number = parsedDoc.sales_order_number;
            match.order_date = parsedDoc.order_date;
            match.boxes = parsedDoc.boxes;
            match.weight = parsedDoc.weight;
            match.shipment_items = parsedDoc.items;
            match.shipment_qty = parsedDoc.total_qty;
            match.shipment_address = parsedDoc.ship_to_address;
            match.shipment_city = parsedDoc.ship_to_city;
            match.shipment_state = parsedDoc.ship_to_state;
            match.shipment_pincode = parsedDoc.ship_to_pincode;
            match.shipment_customer_name = parsedDoc.customer_name;
            
            // Set address fields from shipment if invoice doesn't have it yet
            if (!match.ship_to_address || match.ship_to_address === 'N/A') {
                match.ship_to_address = parsedDoc.ship_to_address;
                match.ship_to_city = parsedDoc.ship_to_city;
                match.ship_to_state = parsedDoc.ship_to_state;
                match.ship_to_pincode = parsedDoc.ship_to_pincode;
            }
            
            // Quantity match check
            match.qty_match = match.invoice_qty === match.shipment_qty;
            match.status = 'Matched';
            
            showToast(`Matched Shipment ${parsedDoc.shipment_number} with Invoice ${match.invoice_number}! Qty Verification: ${match.qty_match ? 'TRUE' : 'FALSE (Qty Mismatch)'}`, 'success');
        } else {
            if (warningReason) {
                showToast(`Strict Match Warning for Customer ${parsedDoc.customer_name}: ${warningReason}`, 'warning');
            }
            // Add as new pending record
            records.push({
                id: 'rec-' + Date.now(),
                customer_name: parsedDoc.customer_name,
                invoice_customer_name: null,
                shipment_customer_name: parsedDoc.customer_name,
                gstin: 'N/A',
                pan: 'N/A',
                phone: 'N/A',
                ship_to_address: parsedDoc.ship_to_address,
                ship_to_city: parsedDoc.ship_to_city,
                ship_to_state: parsedDoc.ship_to_state,
                ship_to_pincode: parsedDoc.ship_to_pincode,
                invoice_address: null,
                invoice_city: null,
                invoice_state: null,
                invoice_pincode: null,
                shipment_address: parsedDoc.ship_to_address,
                shipment_city: parsedDoc.ship_to_city,
                shipment_state: parsedDoc.ship_to_state,
                shipment_pincode: parsedDoc.ship_to_pincode,
                
                // Invoice Details (Empty)
                invoice_number: null,
                invoice_date: null,
                due_date: null,
                eway_bill: null,
                invoice_amount: null,
                invoice_items: null,
                invoice_qty: null,
                invoice_rate: null,
                sales_person: null,
                
                // Shipment Details
                shipment_number: parsedDoc.shipment_number,
                shipment_date: parsedDoc.shipment_date,
                carrier: parsedDoc.carrier,
                tracking_number: parsedDoc.tracking_number,
                tracking_status: parsedDoc.tracking_status || 'In Transit',
                delivery_timestamp: parsedDoc.delivery_timestamp || null,
                sales_order_number: parsedDoc.sales_order_number,
                order_date: parsedDoc.order_date,
                shipment_qty: parsedDoc.total_qty,
                qty_match: null,
                boxes: parsedDoc.boxes,
                weight: parsedDoc.weight,
                shipment_items: parsedDoc.items,
                
                status: 'Pending Invoice',
                timestamp: new Date().toISOString()
            });
            showToast(`Shipment ${parsedDoc.shipment_number} recorded. Waiting for Invoice PDF.`, 'info');
        }
    }

    saveLocalRecords(records);
    renderFeed();
}

// Calculate Overdue status
function getOverdueDetails(dueDateStr) {
    if (!dueDateStr) return { days: 0, remark: 'N/A', isOverdue: false };
    
    // Parse DD/MM/YYYY
    const parts = dueDateStr.split('/');
    if (parts.length !== 3) return { days: 0, remark: 'N/A', isOverdue: false };
    
    const dueDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize time
    dueDate.setHours(0, 0, 0, 0);

    const diffTime = today - dueDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > 0) {
        return {
            days: diffDays,
            remark: `${diffDays} Days Overdue`,
            isOverdue: true
        };
    } else {
        return {
            days: 0,
            remark: 'Paid/On Time',
            isOverdue: false
        };
    }
}

// Fetch Shiprocket JWT Authentication Token
async function getShiprocketToken() {
    const cachedToken = localStorage.getItem('shiprocket_token');
    const expiry = localStorage.getItem('shiprocket_token_expiry');
    
    // Check if token exists and is valid
    if (cachedToken && expiry && Date.now() < parseInt(expiry)) {
        return cachedToken;
    }
    
    const email = localStorage.getItem('shiprocket_email') || 'accounts@geonix.in';
    const password = 'YnyZ45t$FQ%LLMTpDYCo7bPnfFsuY#jL';
    
    try {
        const response = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.token) {
                localStorage.setItem('shiprocket_token', data.token);
                // Token is valid for 10 days, let's set expiry to 9 days to be safe
                const expiryTime = Date.now() + (9 * 24 * 60 * 60 * 1000);
                localStorage.setItem('shiprocket_token_expiry', expiryTime.toString());
                return data.token;
            }
        }
    } catch (err) {
        console.warn('Shiprocket authentication failed:', err);
    }
    return null;
}

// Fetch Live AWB tracking details from Shiprocket
async function fetchShiprocketTracking(awb) {
    // Only track if it's a valid numerical AWB (e.g. at least 8 digits)
    if (!awb || !/^\d{8,15}$/.test(awb)) {
        return null;
    }
    
    const token = await getShiprocketToken();
    if (!token) return null;
    
    try {
        const response = await fetch(`https://apiv2.shiprocket.in/v1/external/courier/track/awb/${awb}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.tracking_data && data.tracking_data.shipment_status) {
                const srStatus = data.tracking_data.shipment_status.toLowerCase();
                let status = 'In Transit';
                if (srStatus.includes('deliver')) {
                    status = 'Delivered';
                } else if (srStatus.includes('out') || srStatus.includes('pick') || srStatus.includes('reach')) {
                    status = 'Out for Delivery';
                }
                
                // Get timestamp from latest activity
                let timestamp = '';
                const activities = data.tracking_data.shipment_track_activities;
                if (activities && activities.length > 0) {
                    const rawDate = activities[0].date; // 'YYYY-MM-DD HH:MM:SS'
                    if (rawDate) {
                        const parts = rawDate.split(' ');
                        const dateParts = parts[0].split('-');
                        if (dateParts.length === 3) {
                            const timeParts = parts[1] ? parts[1].split(':') : ['12', '00'];
                            timestamp = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]} ${timeParts[0]}:${timeParts[1]}`;
                        }
                    }
                }
                
                if (!timestamp) {
                    timestamp = new Date().toLocaleString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    }).replace(',', '');
                }
                
                return { status, timestamp };
            }
        }
    } catch (err) {
        console.warn(`Shiprocket tracking failed for AWB ${awb}:`, err);
    }
    return null;
}

// Live Courier Tracking service check (Shiprocket Integration & Simulation Fallback)
async function updateTrackingStatuses() {
    const records = getLocalRecords();
    let updated = false;

    const promises = records.map(async (row) => {
        if (row.tracking_number && row.status === 'Matched' && row.tracking_status !== 'Delivered') {
            // Try fetching live data from Shiprocket API
            const liveData = await fetchShiprocketTracking(row.tracking_number);
            
            if (liveData) {
                const nextStatus = liveData.status;
                if (row.tracking_status !== nextStatus) {
                    row.tracking_status = nextStatus;
                    if (nextStatus === 'Delivered') {
                        row.delivery_timestamp = liveData.timestamp;
                    }
                    updated = true;
                }
            }
        }
    });

    await Promise.all(promises);

    if (updated) {
        saveLocalRecords(records);
        renderFeed();
    }
}

// Render dynamic Feed Dashboard
function renderFeed() {
    const feedGrid = document.getElementById('feed-grid');
    const records = getLocalRecords();
    
    feedGrid.innerHTML = '';

    if (records.length === 0) {
        feedGrid.innerHTML = `
            <div class="no-records" style="text-align: center; padding: 40px; color: var(--text-muted);">
                <i class="fa-solid fa-file-circle-minus" style="font-size: 3rem; margin-bottom: 12px; display: block; opacity: 0.5;"></i>
                <p>No records found. Drag and drop Invoice and Shipment PDFs above to begin!</p>
            </div>
        `;
        updateStats(records);
        return;
    }

    const activeFilter = document.querySelector('.filter-btn.active').getAttribute('data-filter');
    let displayedCount = 0;

    records.forEach(row => {
        const isMatched = row.status === 'Matched';
        if (activeFilter === 'matched' && !isMatched) return;
        if (activeFilter === 'unmatched' && isMatched) return;

        displayedCount++;

        const card = document.createElement('div');
        card.className = `reconcile-card ${isMatched ? 'matched' : 'unmatched'}`;
        card.setAttribute('data-status', isMatched ? 'matched' : 'unmatched');

        // Status Badge details
        let badgeClass = 'badge-warning';
        let badgeIcon = 'fa-triangle-exclamation';
        let badgeText = row.status === 'Pending Shipment' ? 'Missing Shipment' : 'Missing Invoice';

        if (isMatched) {
            badgeClass = 'badge-success';
            badgeIcon = 'fa-circle-check';
            badgeText = 'Reconciled';
        }
        
        const statusTag = `<span class="badge ${badgeClass}"><i class="fa-solid ${badgeIcon}"></i> ${badgeText}</span>`;
        const linkTag = isMatched 
            ? `<div class="match-link"><i class="fa-solid fa-link"></i></div>`
            : `<div class="match-link broken"><i class="fa-solid fa-link-slash"></i></div>`;

        // Verification Badge Row
        let verificationBadge = '';
        if (isMatched) {
            const verClass = row.qty_match ? 'badge-success' : 'badge-danger';
            const verIcon = row.qty_match ? 'fa-check-double' : 'fa-circle-xmark';
            const verText = row.qty_match ? 'Qty Match (TRUE)' : 'Qty Mismatch (FALSE)';
            verificationBadge = `<span class="badge ${verClass}" style="margin-left: 8px;"><i class="fa-solid ${verIcon}"></i> ${verText}</span>`;
        }

        // Overdue status block
        let overdueBadge = '';
        if (row.due_date) {
            const overdue = getOverdueDetails(row.due_date);
            if (overdue.isOverdue) {
                overdueBadge = `<span class="badge badge-danger" style="margin-left: 8px;"><i class="fa-solid fa-clock-rotate-left"></i> Overdue: ${overdue.remark}</span>`;
            }
        }

        // Edit Status button for undelivered shipments
        let editBtn = '';
        if (row.shipment_number && row.tracking_status !== 'Delivered') {
            editBtn = `<button class="btn-edit-card" onclick="toggleDeliveryEdit('${row.id}', true)" title="Update delivery status" style="background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-sm); padding: 5px 10px; font-size: 0.76rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: var(--transition-smooth); font-family: inherit; outline: none; margin-right: 4px;">
                <i class="fa-solid fa-pen-to-square"></i> Mark Delivered
            </button>`;
        }

        // Left Block: Tax Invoice
        const invoiceBlock = row.invoice_number 
            ? `<div class="doc-block invoice-block">
                <div class="block-header">
                    <i class="fa-solid fa-file-invoice"></i>
                    <span>Tax Invoice</span>
                </div>
                <div class="block-details">
                    <div class="detail-row"><span class="lbl">Customer Name:</span><span class="val highlight">${row.invoice_customer_name || row.customer_name || 'N/A'}</span></div>
                    <div class="detail-row"><span class="lbl">Invoice No:</span><span class="val highlight">${row.invoice_number}</span></div>
                    <div class="detail-row"><span class="lbl">Invoice Date:</span><span class="val">${row.invoice_date}</span></div>
                    <div class="detail-row"><span class="lbl">Due Date:</span><span class="val" style="${getOverdueDetails(row.due_date).isOverdue ? 'color: #f87171; font-weight: 700;' : ''}">${row.due_date || 'N/A'}</span></div>
                    <div class="detail-row"><span class="lbl">E-Way Bill#:</span><span class="val">${row.eway_bill || 'N/A'}</span></div>
                    <div class="detail-row"><span class="lbl">Total Amount:</span><span class="val">₹${row.invoice_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                    <div class="detail-row"><span class="lbl">Rate:</span><span class="val highlight">${row.invoice_rate && row.invoice_rate !== 'N/A' ? '₹' + parseFloat(row.invoice_rate.replace(/,/g, '')).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : 'N/A'}</span></div>
                    <div class="detail-row"><span class="lbl">Sales Person:</span><span class="val">${row.sales_person}</span></div>
                    <div class="detail-row"><span class="lbl">Invoice Qty:</span><span class="val highlight" style="color: var(--success); font-weight: 750;">${row.invoice_qty !== null ? row.invoice_qty : 'N/A'}</span></div>
                    <div class="detail-row"><span class="lbl">Invoice Pincode:</span><span class="val highlight">${row.invoice_pincode || row.ship_to_pincode || 'N/A'}</span></div>
                    <div class="detail-row" style="flex-direction: column; align-items: flex-start; gap: 4px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px; margin-top: 8px;">
                        <span class="lbl">Ship-To Address:</span>
                        <pre style="white-space: pre-wrap; font-family: inherit; font-size: 0.75rem; color: var(--text-muted); margin: 0; line-height: 1.4;">${row.invoice_address || row.ship_to_address || 'N/A'}</pre>
                    </div>
                </div>
               </div>`
            : `<div class="doc-block invoice-block empty-doc">
                <div class="block-header"><i class="fa-solid fa-file-invoice"></i><span>Tax Invoice</span></div>
                <div class="empty-message">
                    <i class="fa-solid fa-upload"></i>
                    <p>Waiting for Invoice PDF</p>
                    <span>Upload invoice to match.</span>
                </div>
               </div>`;

        // Right Block: Shipment Order
        let trackBadgeClass = 'badge-info';
        let trackBadgeIcon = 'fa-truck';
        const currentStatus = row.tracking_status || 'Pending Upload';
        const statusUpper = currentStatus.toUpperCase();
        
        if (statusUpper.includes('DELIVERED')) {
            trackBadgeClass = 'badge-success';
            trackBadgeIcon = 'fa-circle-check';
        } else if (statusUpper.includes('OUT') || statusUpper.includes('PICK') || statusUpper.includes('REACH')) {
            trackBadgeClass = 'badge-warning';
            trackBadgeIcon = 'fa-truck-fast';
        } else if (statusUpper.includes('TRANSIT')) {
            trackBadgeClass = 'badge-info';
            trackBadgeIcon = 'fa-truck';
        }
        
        const liveStatusRow = `<div class="detail-row"><span class="lbl">Live Status:</span><span class="val badge ${trackBadgeClass}" style="padding: 2px 8px; font-size: 0.75rem; display: inline-block;"><i class="fa-solid ${trackBadgeIcon}"></i> ${currentStatus}</span></div>`;
        const statusDateTimeRow = `<div class="detail-row"><span class="lbl">Status Date/Time:</span><span class="val highlight">${row.delivery_timestamp || 'N/A'}</span></div>`;

        const shipmentBlock = row.shipment_number 
            ? `<div class="doc-block shipment-block">
                <div class="block-header">
                    <i class="fa-solid fa-truck-ramp-box"></i>
                    <span>Shipment Order</span>
                </div>
                <div class="block-details">
                    <div class="detail-row"><span class="lbl">Customer Name:</span><span class="val highlight">${row.shipment_customer_name || row.customer_name || 'N/A'}</span></div>
                    <div class="detail-row"><span class="lbl">Shipment No:</span><span class="val highlight">${row.shipment_number}</span></div>
                    <div class="detail-row"><span class="lbl">Shipment Date:</span><span class="val">${row.shipment_date || 'N/A'}</span></div>
                    <div class="detail-row"><span class="lbl">Carrier:</span><span class="val">${row.carrier || 'N/A'}</span></div>
                    <div class="detail-row"><span class="lbl">Track id:</span><span class="val highlight">${row.tracking_number || 'N/A'}</span></div>
                    ${liveStatusRow}
                    ${statusDateTimeRow}
                    <div class="detail-row"><span class="lbl">Sales Order#:</span><span class="val">${row.sales_order_number}</span></div>
                    <div class="detail-row"><span class="lbl">Order Date:</span><span class="val">${row.order_date}</span></div>
                    <div class="detail-row"><span class="lbl">Shipment Qty:</span><span class="val highlight" style="color: var(--success); font-weight: 750;">${row.shipment_qty !== null ? row.shipment_qty : 'N/A'}</span></div>
                    <div class="detail-row"><span class="lbl">Box Count:</span><span class="val highlight">${row.boxes !== null ? row.boxes : 'N/A'}</span></div>
                    <div class="detail-row"><span class="lbl">Weight:</span><span class="val highlight">${row.weight !== null ? row.weight : 'N/A'}</span></div>
                    <div class="detail-row"><span class="lbl">Shipment Pincode:</span><span class="val highlight">${row.shipment_pincode || (row.status === 'Matched' ? (row.invoice_pincode || row.ship_to_pincode) : 'N/A')}</span></div>
                    <div class="detail-row"><span class="lbl">Ship-To City:</span><span class="val">${row.shipment_city || (row.status === 'Matched' ? (row.invoice_city || row.ship_to_city) : 'N/A')}</span></div>
                    <div class="detail-row"><span class="lbl">Ship-To State:</span><span class="val">${row.shipment_state || (row.status === 'Matched' ? (row.invoice_state || row.ship_to_state) : 'N/A')}</span></div>
                    <div class="delivery-edit-container" id="delivery-edit-${row.id}"></div>
                </div>
               </div>`
            : `<div class="doc-block shipment-block empty-doc">
                <div class="block-header"><i class="fa-solid fa-truck-ramp-box"></i><span>Shipment Order</span></div>
                <div class="empty-message">
                    <i class="fa-solid fa-upload"></i>
                    <p>Waiting for Shipment PDF</p>
                    <span>Upload shipment order to match.</span>
                </div>
               </div>`;

        card.innerHTML = `
            <div class="reconcile-card-header">
                <div class="customer-info">
                    <span class="customer-tag">Customer</span>
                    <h3>${row.customer_name}</h3>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${statusTag}
                    ${verificationBadge}
                    ${overdueBadge}
                    ${editBtn}
                    <button class="btn-delete-card" onclick="deleteSingleRecord('${row.id}')" title="Delete this record" style="background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: var(--radius-sm); padding: 5px 10px; font-size: 0.76rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: var(--transition-smooth); font-family: inherit;">
                        <i class="fa-solid fa-trash-can"></i> Delete
                    </button>
                </div>
            </div>
            <div class="reconcile-card-body">
                ${invoiceBlock}
                ${linkTag}
                ${shipmentBlock}
            </div>
            <div class="reconcile-card-footer">
                <div class="ship-to-section">
                    <div class="ship-to-header">
                        <i class="fa-solid fa-location-dot"></i>
                        <span>Ship To Details</span>
                    </div>
                    <div class="ship-to-grid">
                        <div class="ship-to-address-block">
                            <span class="lbl">Full Address:</span>
                            <pre class="val-address">${row.ship_to_address || 'N/A'}</pre>
                        </div>
                        <div class="ship-to-meta">
                            <div class="meta-item"><span class="lbl">City:</span><span class="val">${row.ship_to_city || 'N/A'}</span></div>
                            <div class="meta-item"><span class="lbl">State:</span><span class="val">${row.ship_to_state || 'N/A'}</span></div>
                            <div class="meta-item"><span class="lbl">PINCODE:</span><span class="val highlight">${row.ship_to_pincode || 'N/A'}</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        feedGrid.appendChild(card);
    });

    if (displayedCount === 0) {
        feedGrid.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                <i class="fa-solid fa-filter" style="font-size: 2.5rem; margin-bottom: 12px; display: block; opacity: 0.5;"></i>
                <p>No records match your active filter.</p>
            </div>
        `;
    }

    updateStats(records);
}

function updateStats(records) {
    let totalInv = 0;
    let totalShip = 0;
    let reconciled = 0;
    let unmatched = 0;
    let delivered = 0;
    let undelivered = 0;

    records.forEach(row => {
        if (row.invoice_number) totalInv++;
        if (row.shipment_number) totalShip++;
        if (row.status === 'Matched') {
            reconciled++;
        } else {
            unmatched++;
        }

        // Count Delivered and Undelivered for records that have shipment orders
        if (row.shipment_number) {
            if (row.tracking_status === 'Delivered') {
                delivered++;
            } else {
                undelivered++;
            }
        }
    });

    document.getElementById('stat-total-invoices').innerText = totalInv;
    document.getElementById('stat-total-shipments').innerText = totalShip;
    document.getElementById('stat-reconciled').innerText = reconciled;
    document.getElementById('stat-unmatched').innerText = unmatched;
    document.getElementById('stat-delivered').innerText = delivered;
    document.getElementById('stat-undelivered').innerText = undelivered;
}

// Compile Styled Excel using Browser DOM Tables (preserving red colors and formats!)
async function compileExcelReport() {
    const filteredRecords = getLocalRecords();

    // Helper for Month-Year formatting from DD/MM/YYYY
    function getExcelMonthYear(dateStr) {
        if (!dateStr) return 'N/A';
        const cleanDateStr = dateStr.replace(/[-.]/g, '/');
        const parts = cleanDateStr.split('/');
        if (parts.length !== 3) return 'N/A';
        const monthNames = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
        const mIdx = parseInt(parts[1], 10) - 1;
        if (mIdx >= 0 && mIdx < 12) {
            return `${monthNames[mIdx]}-${parts[2]}`;
        }
        return 'N/A';
    }

    if (filteredRecords.length === 0) {
        showToast('No reconciled records found in the Local Database.', 'warning');
        return;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('MIS Report');

    // Show grid lines explicitly
    worksheet.views = [{ showGridLines: true }];

    // 1. Add Title Banner Block (Row 1-2)
    worksheet.mergeCells('A1:X1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'GEONIX INTERNATIONAL (P) LTD - Mumbai Branch (Bhiwandi)';
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E3A8A' } // Sleek Dark Royal Blue
    };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 35;

    worksheet.mergeCells('A2:X2');
    const subtitleCell = worksheet.getCell('A2');
    const formattedDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    subtitleCell.value = `MONTHLY RECONCILIATION & MIS COMPILATION REPORT  |  EXPORTED: ${formattedDate} IST`;
    subtitleCell.font = { name: 'Calibri', size: 9, bold: false, italic: true, color: { argb: 'FFD1D5DB' } };
    subtitleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E3A8A' }
    };
    subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(2).height = 20;

    // Row 3 is empty spacer
    worksheet.getRow(3).height = 10;

    // 2. Headers Row (Row 4)
    const headers = [
        'Months', 'Consignor Name', 'City', 'State',
        'Customer Name', 'Ship-to City', 'Ship-to State', 'PINCODE',
        'Sales Order#', 'Order Date', 'Shipment Qty',
        'Invoice No', 'Invoice Date', 'Invoice Qty', 'Rate (₹)', 'Total Amount (₹)',
        'Track ID / Vehicle#', 'Shipment Date', 'Box Count', 'Weight (KG)', 'Carrier Name',
        'Dispatch Mode', 'Tracking Status', 'Delivered Date'
    ];

    const headerRow = worksheet.getRow(4);
    headerRow.values = headers;
    headerRow.height = 26;

    headerRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF334155' } // Slate Gray
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            left: { style: 'thin', color: { argb: 'FF94A3B8' } },
            bottom: { style: 'medium', color: { argb: 'FF1E293B' } },
            right: { style: 'thin', color: { argb: 'FF94A3B8' } }
        };
    });

    // 3. Write Data Rows (Row 5 onwards)
    let currentRowNum = 5;
    filteredRecords.forEach((row, rowIndex) => {
        const overdue = getOverdueDetails(row.due_date);
        const qtyMismatch = row.invoice_qty !== null && row.shipment_qty !== null && row.invoice_qty !== row.shipment_qty;

        const recordRow = worksheet.getRow(currentRowNum);

        // Parse rate and amount values
        let numericRate = null;
        if (row.invoice_rate && row.invoice_rate !== 'N/A') {
            numericRate = parseFloat(row.invoice_rate.replace(/,/g, ''));
            if (isNaN(numericRate)) numericRate = null;
        }

        let numericAmount = row.invoice_amount ? parseFloat(row.invoice_amount) : null;
        if (isNaN(numericAmount)) numericAmount = null;

        const cellsData = [
            getExcelMonthYear(row.invoice_date || row.shipment_date),
            'Geonix International Pvt.Ltd',
            'Bhiwandi',
            'Maharashtra',
            row.customer_name,
            row.ship_to_city || 'N/A',
            row.ship_to_state || 'N/A',
            row.ship_to_pincode || 'N/A',
            row.sales_order_number || 'N/A',
            row.order_date || 'N/A',
            row.shipment_qty !== null ? parseInt(row.shipment_qty) : null,
            row.invoice_number || 'N/A',
            row.invoice_date || 'N/A',
            row.invoice_qty !== null ? parseInt(row.invoice_qty) : null,
            numericRate,
            numericAmount,
            row.tracking_number || 'N/A',
            row.shipment_date || 'N/A',
            row.boxes !== null ? parseInt(row.boxes) : 0,
            row.weight !== null ? parseFloat(row.weight) : null,
            row.carrier || 'N/A',
            'By Road',
            row.tracking_status || 'Pending Upload',
            row.delivery_timestamp || 'N/A'
        ];

        recordRow.values = cellsData;
        recordRow.height = 20;

        // Zebra striping backgrounds
        const isAlternate = rowIndex % 2 === 1;
        const rowBg = isAlternate ? 'FFF8FAFC' : 'FFFFFFFF'; // Light Slate Tint / White

        cellsData.forEach((val, colIdx) => {
            const cell = recordRow.getCell(colIdx + 1);
            cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF000000' } };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: rowBg }
            };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };

            // Formatting columns
            if (colIdx === 10 || colIdx === 13 || colIdx === 18) { // Shipment Qty, Invoice Qty, Box Count
                cell.numFmt = '#,##0';
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            } else if (colIdx === 19) { // Weight
                cell.numFmt = '#,##0.00';
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            } else if (colIdx === 14 || colIdx === 15) { // Rate, Total Amount
                if (val !== null) {
                    cell.numFmt = '"₹"#,##0.00';
                }
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            } else {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            }

            // Align Customer name to left
            if (colIdx === 4 || colIdx === 1) {
                cell.alignment = { vertical: 'middle', horizontal: 'left' };
            }

            // Highlight Qty Mismatches in red
            if (qtyMismatch && (colIdx === 10 || colIdx === 13)) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFEE2E2' }
                };
                cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF991B1B' } };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFFCA5A5' } },
                    left: { style: 'thin', color: { argb: 'FFFCA5A5' } },
                    bottom: { style: 'thin', color: { argb: 'FFFCA5A5' } },
                    right: { style: 'thin', color: { argb: 'FFFCA5A5' } }
                };
            }

            // Highlight Overdue Invoice Dates
            if (colIdx === 12 && overdue.isOverdue) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFF3C7' }
                };
                cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF92400E' } };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFFCD34D' } },
                    left: { style: 'thin', color: { argb: 'FFFCD34D' } },
                    bottom: { style: 'thin', color: { argb: 'FFFCD34D' } },
                    right: { style: 'thin', color: { argb: 'FFFCD34D' } }
                };
            }
        });

        currentRowNum++;
    });

    // 4. Add Summary Row at the bottom
    const summaryRow = worksheet.getRow(currentRowNum);
    summaryRow.height = 24;

    for (let c = 1; c <= 24; c++) {
        const cell = summaryRow.getCell(c);
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF1F5F9' }
        };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            bottom: { style: 'double', color: { argb: 'FF475569' } }
        };
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
    }

    const labelCell = summaryRow.getCell(5);
    labelCell.value = 'Total Summary';
    labelCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const shipSumCell = summaryRow.getCell(11);
    shipSumCell.value = { formula: `SUM(K5:K${currentRowNum - 1})` };
    shipSumCell.numFmt = '#,##0';
    shipSumCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const invSumCell = summaryRow.getCell(14);
    invSumCell.value = { formula: `SUM(N5:N${currentRowNum - 1})` };
    invSumCell.numFmt = '#,##0';
    invSumCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const amtSumCell = summaryRow.getCell(16);
    amtSumCell.value = { formula: `SUM(P5:P${currentRowNum - 1})` };
    amtSumCell.numFmt = '"₹"#,##0.00';
    amtSumCell.alignment = { vertical: 'middle', horizontal: 'right' };

    // 5. Columns width formatting
    const wscols = [
        { width: 15 }, { width: 30 }, { width: 14 }, { width: 14 }, // Months, Consignor details
        { width: 32 }, { width: 18 }, { width: 18 }, { width: 12 }, // Customer, City, State, PINCODE
        { width: 22 }, { width: 15 }, { width: 16 },                 // Sales Order#, Order Date, Shipment Qty
        { width: 22 }, { width: 15 }, { width: 16 }, { width: 16 },  // Invoice No, Invoice Date, Invoice Qty, Rate
        { width: 22 }, { width: 24 }, { width: 15 },                 // Total Amount, Track id, Shipment Date
        { width: 12 }, { width: 12 }, { width: 16 },                 // Box Count, Weight, Carrier Name
        { width: 15 }, { width: 18 }, { width: 24 }                  // Dispatch Mode, Tracking Status, Delivered Date
    ];

    wscols.forEach((col, idx) => {
        worksheet.getColumn(idx + 1).width = col.width;
    });

    // 6. Generate and download buffer
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Geonix_MIS_Report.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Styled MIS Excel Report compiled & downloaded successfully!', 'success');
}

// Initializing UI DOM events
document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const progressList = document.getElementById('upload-progress-list');
    const btnExportExcel = document.getElementById('btn-export-excel');
    const btnClearDb = document.getElementById('btn-clear-db');

    // Mode Switching Tab Listeners
    const tabModeFile = document.getElementById('tab-mode-file');
    const tabModeText = document.getElementById('tab-mode-text');
    const modeFileContainer = document.getElementById('mode-file-container');
    const modeTextContainer = document.getElementById('mode-text-container');
    
    if (tabModeFile && tabModeText) {
        tabModeFile.addEventListener('click', () => {
            tabModeFile.classList.add('active');
            tabModeText.classList.remove('active');
            modeFileContainer.style.display = 'block';
            modeTextContainer.style.display = 'none';
        });
        
        tabModeText.addEventListener('click', () => {
            tabModeText.classList.add('active');
            tabModeFile.classList.remove('active');
            modeTextContainer.style.display = 'block';
            modeFileContainer.style.display = 'none';
        });
    }

    // Parse Pasted Text Button Listener
    const btnParseText = document.getElementById('btn-parse-text');
    const pasteTextInput = document.getElementById('paste-text-input');
    
    if (btnParseText && pasteTextInput) {
        btnParseText.addEventListener('click', async () => {
            const pastedText = pasteTextInput.value.trim();
            if (!pastedText) {
                showToast('Please paste some document text first!', 'warning');
                return;
            }
            
            // Create progress spinner item
            const id = 'progress-paste-' + Math.random().toString(36).substr(2, 9);
            const progressItem = document.createElement('div');
            progressItem.className = 'progress-item';
            progressItem.id = id;
            progressItem.innerHTML = `
                <div class="progress-item-left">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <span>Pasted Text</span>
                </div>
                <div class="progress-item-right">
                    <i class="fa-solid fa-circle-notch progress-spinner"></i>
                    <span>AI Parsing Text...</span>
                </div>
            `;
            progressList.appendChild(progressItem);
            
            try {
                // Wait briefly to make it feel responsive
                await new Promise(resolve => setTimeout(resolve, 800));
                
                const parsed = parseDocumentText(pastedText);
                progressItem.remove();
                
                if (parsed.type === 'unknown') {
                    showToast('Could not recognize document type from pasted text!', 'warning');
                    return;
                }
                
                reconcileDocument(parsed);
                pasteTextInput.value = ''; // clear input
                showToast(`Successfully parsed and loaded pasted ${parsed.type === 'invoice' ? 'Tax Invoice' : 'Shipment Order'}!`, 'success');
                
            } catch (err) {
                console.error('Text parsing error:', err);
                progressItem.remove();
                showToast('Error parsing pasted text.', 'warning');
            }
        });
    }

    // Shiprocket API Settings Initialization
    const shiprocketEmailInput = document.getElementById('shiprocket-user-email');
    if (shiprocketEmailInput) {
        const savedEmail = localStorage.getItem('shiprocket_email') || 'accounts@geonix.in';
        shiprocketEmailInput.value = savedEmail;
        
        shiprocketEmailInput.addEventListener('change', () => {
            const newEmail = shiprocketEmailInput.value.trim();
            if (newEmail) {
                localStorage.setItem('shiprocket_email', newEmail);
                localStorage.removeItem('shiprocket_token');
                localStorage.removeItem('shiprocket_token_expiry');
                showToast('Shiprocket API credentials updated.', 'success');
                updateTrackingStatuses();
            }
        });
    }

    // Run tracking statuses updates
    updateTrackingStatuses();
    renderFeed();



    // Trigger file dialog
    dropZone.addEventListener('click', () => fileInput.click());

    // Drag-over styling hooks
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove('dragover');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', () => {
        handleFiles(fileInput.files);
    });

    async function handleFiles(files) {
        if (files.length === 0) return;

        // Process files sequentially to guarantee strict matching rules execute in correct state order
        for (const file of Array.from(files)) {
            if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
                showToast(`File "${file.name}" must be a PDF document.`, 'warning');
                continue;
            }
            await processFile(file);
        }
    }

    // Extract & classify pdf documents
    async function processFile(file) {
        const id = 'progress-' + Math.random().toString(36).substr(2, 9);
        const progressItem = document.createElement('div');
        progressItem.className = 'progress-item';
        progressItem.id = id;
        progressItem.innerHTML = `
            <div class="progress-item-left">
                <i class="fa-solid fa-file-pdf"></i>
                <span>${file.name}</span>
            </div>
            <div class="progress-item-right">
                <i class="fa-solid fa-circle-notch progress-spinner"></i>
                <span>AI Parsing OCR...</span>
            </div>
        `;
        progressList.appendChild(progressItem);

        try {
            const text = await extractTextFromPDF(file);
            const parsed = parseDocumentText(text);

            progressItem.remove();

            if (parsed.type === 'unknown') {
                showToast(`Could not recognize PDF layout: ${file.name}`, 'warning');
                return;
            }

            reconcileDocument(parsed);

        } catch (err) {
            console.error('File parsing error:', err);
            progressItem.remove();
            showToast(`Error parsing ${file.name}`, 'warning');
        }
    }

    // Filter Navigation tabs
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        if (btn.id === 'btn-clear-db') return;
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => {
                if (b.id !== 'btn-clear-db') b.classList.remove('active');
            });
            btn.classList.add('active');
            renderFeed();
        });
    });

    // Clear db handler
    btnClearDb.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all records from the Local Database & Cloud?')) {
            saveLocalRecords([]);
            showToast('Local and Cloud databases cleared successfully.', 'success');
            renderFeed();
        }
    });



    // Excel export button listener
    btnExportExcel.addEventListener('click', () => {
        btnExportExcel.disabled = true;
        const originalText = btnExportExcel.innerHTML;
        btnExportExcel.innerHTML = '<i class="fa-solid fa-circle-notch progress-spinner"></i> Exporting Sheet...';

        // Auto update live tracking before compiling reports as requested
        updateTrackingStatuses();
        renderFeed();

        setTimeout(() => {
            compileExcelReport();
            btnExportExcel.disabled = false;
            btnExportExcel.innerHTML = originalText;
        }, 1500);
    });
});

// Delete individual record handler
window.deleteSingleRecord = function(id) {
    if (confirm('Are you sure you want to delete this record?')) {
        const records = getLocalRecords();
        const updated = records.filter(r => r.id !== id);
        saveLocalRecords(updated);
        showToast('Record deleted successfully.', 'success');
        renderFeed();
    }
};

// Toggle delivery status editor inline form
window.toggleDeliveryEdit = function(id, show) {
    const container = document.getElementById(`delivery-edit-${id}`);
    if (!container) return;
    
    if (!show) {
        container.innerHTML = '';
        return;
    }
    
    // Get the record to pre-fill
    const records = getLocalRecords();
    const row = records.find(r => r.id === id);
    if (!row) return;
    
    // Format current date/time to YYYY-MM-DDTHH:MM for datetime-local input
    let defaultDateTime = '';
    if (row.delivery_timestamp && row.delivery_timestamp !== 'N/A') {
        const match = row.delivery_timestamp.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
        if (match) {
            defaultDateTime = `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}`;
        }
    }
    
    if (!defaultDateTime) {
        const now = new Date();
        const offset = now.getTimezoneOffset();
        const localNow = new Date(now.getTime() - (offset*60*1000));
        defaultDateTime = localNow.toISOString().slice(0, 16);
    }
    
    container.innerHTML = `
        <div class="delivery-edit-form" style="background: rgba(245, 158, 11, 0.04); border: 1px dashed rgba(245, 158, 11, 0.25); border-radius: var(--radius-sm); padding: 12px; margin-top: 12px; display: flex; flex-direction: column; gap: 10px; width: 100%; box-sizing: border-box; text-align: left;">
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px; margin-bottom: 4px;">
                <span style="font-size: 0.75rem; font-weight: 700; color: var(--warning);"><i class="fa-solid fa-pen-to-square"></i> Update Delivery Status</span>
                <button onclick="toggleDeliveryEdit('${id}', false)" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.8rem; padding: 2px;"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label style="font-size: 0.65rem; color: var(--text-muted); font-weight: 600;">LIVE STATUS</label>
                <select id="edit-status-${id}" style="background: rgba(15, 18, 36, 0.95); border: 1px solid var(--border-color); color: white; padding: 6px; border-radius: var(--radius-sm); font-size: 0.75rem; outline: none; font-family: inherit; width: 100%;">
                    <option value="Delivered" ${row.tracking_status === 'Delivered' ? 'selected' : ''}>Delivered</option>
                    <option value="In Transit" ${row.tracking_status === 'In Transit' ? 'selected' : ''}>In Transit</option>
                    <option value="Out for Delivery" ${row.tracking_status === 'Out for Delivery' ? 'selected' : ''}>Out for Delivery</option>
                </select>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label style="font-size: 0.65rem; color: var(--text-muted); font-weight: 600;">STATUS DATE & TIME</label>
                <div style="position: relative; width: 100%;">
                    <input type="datetime-local" id="edit-date-${id}" value="${defaultDateTime}" onclick="this.showPicker()" style="background: rgba(15, 18, 36, 0.95); border: 1px solid var(--border-color); color: white; padding: 6px 30px 6px 8px; border-radius: var(--radius-sm); font-size: 0.75rem; outline: none; font-family: inherit; width: 100%; box-sizing: border-box; cursor: pointer;">
                    <i class="fa-solid fa-calendar-days" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--warning); pointer-events: none; font-size: 0.8rem;"></i>
                </div>
            </div>
            <button onclick="saveDeliveryStatus('${id}')" class="btn" style="background: var(--warning); color: #070913; font-size: 0.75rem; padding: 6px 12px; border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: 800; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; transition: var(--transition-smooth); margin-top: 4px;">
                <i class="fa-solid fa-floppy-disk"></i> Save Delivery Status
            </button>
        </div>
    `;
};

// Save delivery status updates
window.saveDeliveryStatus = function(id) {
    const statusSelect = document.getElementById(`edit-status-${id}`);
    const dateInput = document.getElementById(`edit-date-${id}`);
    if (!statusSelect || !dateInput) return;
    
    const newStatus = statusSelect.value;
    const rawVal = dateInput.value;
    
    let formattedTimestamp = 'N/A';
    if (rawVal) {
        const d = new Date(rawVal);
        if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            formattedTimestamp = `${day}/${month}/${year} ${hours}:${minutes}`;
        }
    }
    
    const records = getLocalRecords();
    const idx = records.findIndex(r => r.id === id);
    if (idx !== -1) {
        records[idx].tracking_status = newStatus;
        records[idx].delivery_timestamp = formattedTimestamp;
        saveLocalRecords(records);
        showToast('Delivery status updated successfully.', 'success');
        renderFeed();
    }
};
