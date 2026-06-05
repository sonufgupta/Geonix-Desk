import re

text = """Geonix International (P) Ltd
Ground Floor,H.NO. 833, Building No. D-7, Gala No. 40, Bhumi World Industrial Park,, Mumbai Nasik, Highway, Shashtri Nahar Post office, Bhiwandi  Dist-Thane
BHIWANDI 421302, India
GSTIN: 27AAGCG6099N1ZS
CIN: U72900DL2016PTC308687
PAN: AAGCG6099N
Contact: 9310556303
Email: accounts@geonix.in
TAX INVOICE
Invoice Number : GIPLMH/25-26/002 Invoice Date : 25/09/2025 Terms : Net 30 Due Date : 25/10/2025 E-Way Bill# : 292044466748	Place Of Supply : Maharashtra (27) Sales person : Chalitar Kumar Rana
Bill To
Ship To
SKYLINE SYSTEM AND TECHNOLOGIES
First, Shop No. 285A, D Wing, Plot No.80/81, Vashi Plaza Commercial Premises
Co Op Society Ltd, Sector 17, Sector 17, Vashi, Navi Mumbai, Thane, Maharashtra, 400703
Thane
400703 Maharashtra
India
GSTIN 27AEXFS7372A1ZI
PAN AEXFS7372A
+919091910404	
SKYLINE SYSTEM AND TECHNOLOGIES
Skyline system and Technologies 
Shop No.117, Jamnabai Niwas
Near Datta Mandir, chandani koliwada, Phool Gali, Thane west- 400606
Thane
400606 Maharashtra
India
#	Item & Description	HSN/SAC	Qty	Rate	Amount
1	
HDD 4TB DESKTOP GEONIX
RETAIL PACK
2 YEARS WARRANTY*
84717020	20
pcs
5,700.00	1,14,000.00
Items in Total 20"""

def isolateShipToAddress(block, customerName):
    if not block or block == 'N/A':
        return block
    
    lines = [l.strip() for l in block.splitlines() if l.strip()]
    if not lines:
        return block
        
    if '|||' in block:
        return block
        
    if customerName and customerName != 'Unknown Customer':
        lowerName = customerName.lower()
        lastIdx = -1
        for i in range(1, len(lines)):
            if lines[i].lower() == lowerName or lowerName in lines[i].lower():
                lastIdx = i
        if lastIdx != -1:
            return '\n'.join(lines[lastIdx:])
            
    lastMarkerIdx = -1
    markers = [re.compile(r'\bGSTIN\b', re.I), re.compile(r'\bPAN\b', re.I), re.compile(r'\bPhone\b', re.I), re.compile(r'\+91'), re.compile(r'\b\d{10}\b')]
    for i in range(len(lines)):
        for marker in markers:
            if marker.search(lines[i]):
                lastMarkerIdx = i
                break
    if lastMarkerIdx != -1 and lastMarkerIdx + 1 < len(lines):
        return '\n'.join(lines[lastMarkerIdx + 1:])
        
    return block

# Test extraction and isolation
pattern_without = r'(?is)Ship[\s\-]?To\s*[:\-]?\s*(.+?)(?=\s*(?:\n\s*#\s|\s+#\s|Item & Description|Bank Details|Terms|$))'
match_without = re.search(pattern_without, text)

if match_without:
    raw_block = match_without.group(1).strip()
    customer = "SKYLINE SYSTEM AND TECHNOLOGIES"
    isolated = isolateShipToAddress(raw_block, customer)
    print("=== FINAL ISOLATED SHIP-TO ADDRESS ===")
    print(isolated)
else:
    print("No match")
