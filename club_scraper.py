import json
import os
import datetime
import time
from playwright.sync_api import sync_playwright

DATA_FILE_JSON = "club_data.json"
DATA_FILE_JS = "club_data.js"
START_URL = "https://www.bwedl.de/vereine/"
BASE_URL = "https://www.bwedl.de"

def save_data(data):
    data["last_updated"] = datetime.datetime.now().strftime("%d.%m.%Y %H:%M:%S")
    
    with open(DATA_FILE_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
        
    js_content = f"window.CLUB_DATA = {json.dumps(data, indent=4, ensure_ascii=False)};"
    with open(DATA_FILE_JS, "w", encoding="utf-8") as f:
        f.write(js_content)
    print(f"Data saved to {DATA_FILE_JSON} and {DATA_FILE_JS}")

def scrape_club_details(page, url):
    print(f"  Scraping details from {url}...")
    try:
        page.goto(url)
        # Extract everything we can find.
        # Since the data is in plain text nodes without specific tags, we get the full text
        # and parse it line by line or by keywords.
        
        # Determine the content area. Usually ".content" or similar, but "body" works if we are careful.
        # Let's get the inner text of the body or main content div.
        
        # Looking at previous structure, maybe there is a 'center' tag or specific div?
        # Let's use body.inner_text() and split by lines.
        text_content = page.locator("body").inner_text()
        
        details = {}
        
        # Name is likely in an H1 or H2, BUT previous check showed "BWEDL NEWS" clutter.
        # We rely on the name passed from the list, so we don't strictly NEED to parse it here.
        # details["name"] = ... (handled in main loop)
        
        lines = [line.strip() for line in text_content.split('\n') if line.strip()]
        
        # Extended list of specific keys found in DOM
        known_keys = [
            "Vereinsname", "Veranstaltungsort", "Telefon", "Fax", 
            "Straße", "Ort", "PLZ", 
            "Teamkapitän", "Ansprechpartner", 
            "Ansprechpartner Telefon", "Ansprechpartner Mobil", "Ansprechpartner Fax", "Ansprechpartner Email",
            "Mobil", "WWW", "Webseite", "Homepage", "E-Mail", "Email"
        ]
        
        raw_map = {}
        
        i = 0
        while i < len(lines):
            line = lines[i]
            
            # Stop condition for footer
            if "Copyright" in line or "Impressum" == line:
                break
                
            # Strategy 1: Check for Tab delimiter
            if "\t" in line:
                parts = line.split("\t", 1)
                key_part = parts[0].strip().replace(":", "")
                val_part = parts[1].strip()
                
                # Check if the key part matches a known key
                # We need to be careful not to match random text with tabs
                matched_key = None
                for k in known_keys:
                    if k == key_part or k + ":" == key_part: # Strict match preferred
                        matched_key = k
                        break
                
                # If strict match failed, try 'startswith' but be careful
                if not matched_key:
                     for k in known_keys:
                        if key_part.startswith(k):
                            matched_key = k
                            break
                            
                if matched_key:
                    raw_map[matched_key] = val_part
                
                i += 1
                continue
            
            # Strategy 2: Line IS the key, value is on next line (if no tab)
            matched_key = None
            for k in known_keys:
                if line == k or line == k + ":" or line.startswith(k + ":"):
                    matched_key = k
                    break
            
            if matched_key:
                # Look ahead
                if i + 1 < len(lines):
                    next_line = lines[i+1]
                    # Check if next line is also a known key
                    next_is_key = False
                    for next_k in known_keys:
                        if next_line.startswith(next_k): # simple check
                            next_is_key = True 
                            break
                    
                    if not next_is_key:
                        raw_map[matched_key] = next_line
                        i += 2
                        continue
                    else:
                        # Value is empty
                        raw_map[matched_key] = ""
                        i += 1
                        continue
                else:
                    # EOF
                    raw_map[matched_key] = ""
                    i += 1
                    continue
            
            i += 1

        # Extract Fields from raw_map
        def get_val(keys):
            if isinstance(keys, str): keys = [keys]
            for k in keys:
                if k in raw_map:
                     # Return it even if empty to show "empty fields" in UI if desired?
                     # The user said "leere Felder anzeigen". 
                     # But here we just return the value found.
                     # If the key was found in raw_map (even as ""), we return it.
                     val = raw_map[k]
                     if val: return val
                     # If val is empty string, keep looking in other aliases?
                     # Yes, maybe "WWW" is empty but "Webseite" has value (unlikely but safe)
            
            # If we found nothing non-empty, check if we found ANY key with empty value
            # and return that empty value instead of skipping.
            for k in keys:
                if k in raw_map:
                    return "" # Return empty string explicitly if key exists
            
            return "" # Fallback

        details["venue"] = get_val("Veranstaltungsort")
        details["street"] = get_val("Straße")
        details["city"] = get_val(["Ort", "PLZ"])

        details["phone"] = get_val("Telefon")
        details["fax"] = get_val("Fax")
        
        details["contact"] = get_val(["Teamkapitän", "Ansprechpartner"])
        
        details["mobile"] = get_val(["Ansprechpartner Mobil", "Mobil"])
        
        details["website"] = get_val(["WWW", "Webseite", "Homepage"])

        # Contact specific fields
        details["contact_email"] = get_val(["Ansprechpartner Email"])
        # Use generic email if specific contact email not found, or separate field?
        # User complained about "Email" having "Copyright".
        # Let's verify what "Email" key gives us.
        # "Email" key in raw text usually refers to the club generic email.
        details["email"] = get_val(["Email", "E-Mail"])

        # Flatten strictly
        final_details = {k: v for k, v in details.items()}
        
        return final_details

    except Exception as e:
        print(f"  [Error] scraping details: {e}")
        return {}

def main():
    data = {"last_updated": "", "clubs": []}
    
    print(f"Connecting to {START_URL}...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(START_URL)
        
        # Find all club links
        # Strategy:
        # 1. Wait for the filter input which generally signals the list is ready.
        # Revert to robust broad search, but with debug printing
        try:
            page.wait_for_selector("input#filter", timeout=5000)
        except:
            pass
            
        links = page.locator("a[href*='/vereine/']").all()
        
        club_links = []
        seen_urls = set()
        
        print(f"  Processing {len(links)} potential links...")

        for link in links:
            href = link.get_attribute("href")
            try:
                text = link.inner_text().strip()
            except:
                text = ""
            
            print(f"    Link: Text='{text}', Href='{href}'")
            
            # Basic validation
            if not href or href == "/vereine/":
                continue
                
            # Filter empty text
            if not text:
                print("      -> Skipping (empty text)")
                continue

            # Filter out "BWEDL DARTERS NEWS", pure numbers, and other keywords
            # Case insensitive check for clutter
            text_upper = text.upper()
            if "NEWS" in text_upper or "IMPRESSUM" in text_upper or "DATENSCHUTZ" in text_upper or "KONTAKT" in text_upper or "PDF" in text_upper:
                print("      -> Skipping (keyword match)")
                continue
                
            # if text.isdigit():
            #     print("      -> Skipping (digit)")
            #     continue
                
            # URL base filtering
            if "?" in href or "news" in href.lower() or "archiv" in href.lower() or "kalender" in href.lower():
                print(f"      -> Skipping (URL pattern match): {href}")
                continue

            full_url = BASE_URL + href if href.startswith("/") else href
            
            if full_url not in seen_urls:
                club_links.append({'url': full_url, 'texts': {text}})
                seen_urls.add(full_url)
            else:
                # Find the existing entry and add text
                for c in club_links:
                    if c['url'] == full_url:
                        c['texts'].add(text)
                        break
        
        print(f"Found {len(club_links)} clubs.")
        
        for club in club_links:
            # Merge texts: Digits first
            sorted_texts = sorted(list(club['texts']), key=lambda s: (not s.isdigit(), s))
            full_text = " ".join(sorted_texts).strip()
            
            club_number = ""
            clean_name = full_text
            
            # Attempt to split "002 DC Start"
            parts = full_text.split(" ", 1)
            if len(parts) == 2 and parts[0].isdigit() and len(parts[0]) <= 4:
                club_number = parts[0]
                clean_name = parts[1]
            
            club['name'] = clean_name
            club['number'] = club_number
            
            print(f"  Processing [{club_number}] {clean_name} ...")

            details = scrape_club_details(page, club['url'])
            # Merge known name
            if "name" not in details:
                details["name"] = club["name"]
            details["number"] = club.get("number", "")
            
            # Save URL too for debugging/linking
            details["url"] = club["url"]
            
            data["clubs"].append(details)
            # polite delay
            # time.sleep(0.5) 
            
        browser.close()
        
    save_data(data)

if __name__ == "__main__":
    main()
