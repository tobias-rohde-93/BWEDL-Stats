import re

new_code = r"""    function renderToolsView() {
        topBarTitle.textContent = "Match Tools";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "20px";
        container.style.maxWidth = "600px";
        container.style.margin = "0 auto";

        // --- Game Mode State ---
        let gameMode = 'DO'; // 'DO' or 'MO'

        // --- Checkout Database ---
        const outsDO = {
            170: "T20 - T20 - Bull", 167: "T20 - T19 - Bull", 164: "T20 - T18 - Bull", 161: "T20 - T17 - Bull", 160: "T20 - T20 - D20",
            158: "T20 - T20 - D19", 157: "T20 - T19 - D20", 156: "T20 - T20 - D18", 155: "T20 - T19 - D19", 154: "T20 - T18 - D20",
            153: "T20 - T19 - D18", 152: "T20 - T20 - D16", 151: "T20 - T17 - D20", 150: "T20 - T18 - D18", 149: "T20 - T19 - D16",
            148: "T20 - T16 - D20", 147: "T20 - T17 - D18", 146: "T20 - T18 - D16", 145: "T20 - T15 - D20", 144: "T20 - T20 - D12",
            143: "T20 - T17 - D16", 142: "T20 - T14 - D20", 141: "T20 - T19 - D12", 140: "T20 - T16 - D16", 139: "T19 - T14 - D20",
            138: "T20 - T18 - D12", 137: "T19 - T16 - D16", 136: "T20 - T20 - D8", 135: "25 - T20 - Bull", 134: "T20 - T14 - D16",
            133: "T20 - T19 - D8", 132: "25 - T19 - Bull", 131: "T20 - T13 - D16", 130: "T20 - T18 - D8", 129: "T19 - T20 - D6",
            128: "T18 - T14 - D16", 127: "T20 - T17 - D8", 126: "T19 - T19 - D6", 125: "Bull - 25 - Bull", 124: "T20 - D16 - D16",
            123: "T19 - T16 - D9", 122: "T18 - 18 - Bull", 121: "T20 - 11 - Bull", 120: "T20 - 20 - D20", 119: "T19 - 12 - Bull",
            118: "T20 - 18 - D20", 117: "T20 - 17 - D20", 116: "T20 - 16 - D20", 115: "T20 - 15 - D20", 114: "T20 - 14 - D20",
            113: "T20 - 13 - D20", 112: "T20 - 20 - D16", 111: "T20 - 19 - D16", 110: "T20 - 18 - D16", 109: "T20 - 17 - D16",
            108: "T20 - 16 - D16", 107: "T19 - 10 - D20", 106: "T20 - 14 - D16", 105: "T20 - 13 - D16", 104: "T18 - 10 - D20",
            103: "T20 - 3 - D20", 102: "T20 - 10 - D16", 101: "T17 - 10 - D20", 100: "T20 - D20",
            99: "T19 - 10 - D16", 98: "T20 - D19", 97: "T19 - D20", 96: "T20 - D18", 95: "T19 - D19", 94: "T18 - D20", 93: "T19 - D18", 92: "T20 - D16", 91: "T17 - D20",
            90: "T18 - D18", 89: "T19 - D16", 88: "T16 - D20", 87: "T17 - D18", 86: "T18 - D16", 85: "T15 - D20", 84: "T20 - D12", 83: "T17 - D16", 82: "T14 - D20", 81: "T15 - D18",
            80: "T20 - D10", 79: "T13 - D20", 78: "T18 - D12", 77: "T19 - D10", 76: "T20 - D8", 75: "T13 - D18", 74: "T14 - D16", 73: "T19 - D8", 72: "T16 - D12", 71: "T13 - D16",
            70: "T18 - D8", 69: "T15 - D12", 68: "T20 - D4", 67: "T17 - D8", 66: "T10 - D18", 65: "T15 - D10", 64: "D16 - D16", 63: "T13 - D12", 62: "T10 - D16", 61: "T15 - D8",
            60: "20 - D20", 59: "19 - D20", 58: "18 - D20", 57: "17 - D20", 56: "16 - D20", 55: "15 - D20", 54: "14 - D20", 53: "13 - D20", 52: "12 - D20", 51: "11 - D20",
            50: "10 - D20", 49: "9 - D20", 48: "16 - D16", 47: "15 - D16", 46: "6 - D20", 45: "13 - D16", 44: "12 - D16", 43: "3 - D20", 42: "10 - D16", 41: "9 - D16",
            40: "D20", 39: "7 - D16", 38: "D19", 37: "5 - D16", 36: "D18", 35: "3 - D16", 34: "D17", 33: "9 - D12", 32: "D16", 31: "15 - D8",
            30: "D15", 29: "13 - D8", 28: "D14", 27: "11 - D8", 26: "D13", 25: "9 - D8", 24: "D12", 23: "7 - D8", 22: "D11", 21: "5 - D8",
            20: "D10", 19: "3 - D8", 18: "D9", 17: "1 - D8", 16: "D8", 15: "7 - D4", 14: "D7", 13: "5 - D4", 12: "D6", 11: "3 - D4",
            10: "D5", 9: "1 - D4", 8: "D4", 7: "3 - D2", 6: "D3", 5: "1 - D2", 4: "D2", 3: "1 - D1", 2: "D1"
        };
        const outsMO = {
            ...outsDO,
            180: "T20 - T20 - T20", 179: "T20 - T19 - T20", 178: "T20 - T20 - T18", 177: "T20 - T19 - T18", 176: "T20 - T20 - T16", 175: "T20 - T19 - T16",
            174: "T20 - T20 - T14", 173: "T20 - T19 - T14", 172: "T20 - T20 - T12", 171: "T20 - T19 - T12",
            // 61-99 Low number overrides
            99: "T19 - 10 - D16",
            39: "T13", 42: "T14", 45: "T15", 48: "T16", 51: "T17", 54: "T18", 57: "T19", 60: "T20"
        };

        // UI Setup
        const toggleDiv = document.createElement('div');
        toggleDiv.style.cssText = "display:flex; justify-content:center; margin-bottom:20px; background:#0f172a; padding:5px; border-radius:8px; border:1px solid #334155; width:fit-content; margin:0 auto 20px auto;";
        
        const btnDO = document.createElement('button');
        btnDO.textContent = "Double Out";
        btnDO.style.cssText = "padding:8px 15px; border:none; border-radius:6px; cursor:pointer; font-weight:bold; background:#3b82f6; color:white; margin-right:5px;";
        
        const btnMO = document.createElement('button');
        btnMO.textContent = "Master Out";
        btnMO.style.cssText = "padding:8px 15px; border:none; border-radius:6px; cursor:pointer; font-weight:bold; background:transparent; color:#94a3b8;";

        const updateToggle = () => {
            if (gameMode === 'DO') {
                btnDO.style.background = "#3b82f6";
                btnDO.style.color = "white";
                btnMO.style.background = "transparent";
                btnMO.style.color = "#94a3b8";
            } else {
                btnDO.style.background = "transparent";
                btnDO.style.color = "#94a3b8";
                btnMO.style.background = "#3b82f6";
                btnMO.style.color = "white";
            }
            if (btnCheckout.classList.contains('active')) renderCheckout();
            if (btnCounter.classList.contains('active')) renderCounter(true);
        };

        btnDO.onclick = () => { gameMode = 'DO'; updateToggle(); };
        btnMO.onclick = () => { gameMode = 'MO'; updateToggle(); };

        toggleDiv.appendChild(btnDO);
        toggleDiv.appendChild(btnMO);
        container.appendChild(toggleDiv);

        // Tabs
        const tabs = document.createElement('div');
        tabs.style.cssText = 'display:flex; gap:10px; margin-bottom:20px;';

        const btnCheckout = document.createElement('button');
        btnCheckout.innerText = "Checkout Table";
        btnCheckout.className = 'tab-btn active';

        const btnCounter = document.createElement('button');
        btnCounter.innerText = "Score Counter";
        btnCounter.className = 'tab-btn';

        const style = document.createElement('style');
        style.innerHTML = `
            .tab-btn { flex: 1; padding: 12px; border: none; background: #1e293b; color: #94a3b8; cursor: pointer; border-radius: 6px; font-weight: bold; }
            .tab-btn.active { background: #3b82f6; color: white; }
        `;
        container.appendChild(style);
        tabs.appendChild(btnCheckout);
        tabs.appendChild(btnCounter);
        container.appendChild(tabs);

        const contentDiv = document.createElement('div');
        container.appendChild(contentDiv);
        contentArea.appendChild(container);

        // Logic Helpers
        const getCheckout = (val) => {
            let res = null;
            if (gameMode === 'MO' && outsMO[val]) res = outsMO[val];
            else if (outsDO[val]) res = outsDO[val];
            
            if (res) return res;
            if (val <= 1 && val !== 0) return "Nicht checkbar";
            if (val === 0) return "Check!";
            if (gameMode === 'DO' && val > 170) return "Nicht checkbar";
            
            return "Kein Standard-Finish";
        };

        // Checkout View
        const renderCheckout = () => {
            contentDiv.innerHTML = `<input type="number" id="checkout-input" placeholder="Rest (z.B. 90)" 
                style="width: 100%; padding: 15px; font-size: 1.2em; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: white; margin-bottom: 20px;">
                <div id="checkout-result" style="text-align: center; font-size: 1.5em; color: #4ade80; font-weight: bold; min-height: 50px;"></div>`;
            
            const input = document.getElementById('checkout-input');
            input.focus();
            input.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                const res = document.getElementById('checkout-result');
                if (isNaN(val)) { res.textContent = ""; return; }
                
                if (gameMode === 'DO' && [169, 168, 166, 165, 163, 162, 159].includes(val)) {
                    res.textContent = "Kein Finish möglich";
                    res.style.color = "#ef4444";
                    return;
                }

                const txt = getCheckout(val);
                res.textContent = txt;
                res.style.color = (txt.includes("Nicht") || txt.includes("Kein")) ? "#ef4444" : "#4ade80";
            });
        };

        // Scorer State
        let scScore = 501;
        let scHistory = [];
        let scInput = "";

        const renderCounter = (preserveState = false) => {
            if (!preserveState) { scScore = 501; scHistory = []; scInput = ""; }

            const styles = `
                .scorer-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 300px; margin: 0 auto; }
                .scorer-btn { padding: 15px; font-size: 1.5em; background: #334155; color: white; border: none; border-radius: 8px; cursor: pointer; touch-action: manipulation; }
                .scorer-btn:active { background: #475569; transform: scale(0.98); }
                .scorer-action { background: #475569; font-size: 1em; font-weight: bold; }
                .scorer-enter { background: #22c55e; grid-row: span 2; display: flex; align-items: center; justify-content: center; }
                .scorer-score { font-size: 5em; font-weight: bold; color: white; text-align: center; margin: 10px 0; text-shadow: 0 0 20px rgba(255,255,255,0.1); }
                .scorer-input { font-size: 1.5em; color: #60a5fa; text-align: center; height: 40px; margin-bottom: 20px; font-family: monospace; }
                .scorer-hint { color: #94a3b8; text-align: center; height: 20px; font-size: 0.9em; margin-bottom: 5px; }
            `;

            contentDiv.innerHTML = `
                <style>${styles}</style>
                <div id="scorer-hint" class="scorer-hint"></div>
                <div id="scorer-display" class="scorer-score">${scScore}</div>
                <div id="input-display" class="scorer-input">${scInput || "_"}</div>
                
                <div class="scorer-grid">
                    <button class="scorer-btn" onclick="scTap('1')">1</button>
                    <button class="scorer-btn" onclick="scTap('2')">2</button>
                    <button class="scorer-btn" onclick="scTap('3')">3</button>
                    <button class="scorer-btn" onclick="scTap('4')">4</button>
                    <button class="scorer-btn" onclick="scTap('5')">5</button>
                    <button class="scorer-btn" onclick="scTap('6')">6</button>
                    <button class="scorer-btn" onclick="scTap('7')">7</button>
                    <button class="scorer-btn" onclick="scTap('8')">8</button>
                    <button class="scorer-btn" onclick="scTap('9')">9</button>
                    <button class="scorer-btn scorer-action" onclick="scUndo()">🔙</button>
                    <button class="scorer-btn" onclick="scTap('0')">0</button>
                    <button class="scorer-btn scorer-enter" onclick="scEnter()">⏎</button>
                </div>
                 <div style="text-align: center; margin-top: 20px;">
                    <button onclick="scReset()" style="background: none; border: 1px solid #ef4444; color: #ef4444; padding: 5px 15px; border-radius: 4px; font-size: 0.8em;">Neues Spiel</button>
                </div>
            `;

            window.updateScorerUI = () => {
                const disp = document.getElementById('scorer-display');
                const inp = document.getElementById('input-display');
                const hint = document.getElementById('scorer-hint');
                if(disp) disp.textContent = scScore;
                if(inp) inp.textContent = scInput || "-";
                if(hint) {
                    const txt = getCheckout(scScore);
                    if(txt && !txt.includes("Nicht") && !txt.includes("Kein")) {
                        hint.textContent = txt; hint.style.color = "#4ade80";
                    } else { hint.textContent = ""; }
                }
            };
            window.updateScorerUI();
        };

        window.scTap = (n) => { if(scInput.length < 3) scInput += n; window.updateScorerUI(); };
        window.scUndo = () => { if(scInput.length>0) scInput=scInput.slice(0,-1); else if(scHistory.length>0) scScore=scHistory.pop(); window.updateScorerUI(); };
        window.scEnter = () => {
            if(!scInput) return;
            const val = parseInt(scInput);
            scInput = "";
            if(val > 180) { alert("Maximal 180!"); window.updateScorerUI(); return; }
            const newScore = scScore - val;
            if(newScore === 0) {
                scHistory.push(scScore); scScore = 0; window.updateScorerUI();
                setTimeout(() => { if(confirm("🎉 GAME SHOT! Neues Spiel?")) scReset(); }, 100);
            } else if(newScore <= 1 && (newScore < 0 || gameMode !== 'MO' || newScore !== 0)) { // 1 is usually bust for MO too
                alert("BUST!"); 
            } else {
                scHistory.push(scScore); scScore = newScore;
            }
            window.updateScorerUI();
        };
        window.scReset = () => { scScore = 501; scHistory = []; scInput = ""; window.updateScorerUI(); };
        
        // Init
        renderCheckout();
        btnCheckout.onclick = () => { btnCheckout.className='tab-btn active'; btnCounter.className='tab-btn'; renderCheckout(); };
        btnCounter.onclick = () => { btnCheckout.className='tab-btn'; btnCounter.className='tab-btn active'; renderCounter(); };
    }"""

with open('bundle_v24.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Define the start and end markers of the function to replace
match = re.search(r'function renderToolsView\(\)\s*\{', content)
if not match:
    print("Could not find renderToolsView function start")
    exit(1)

start_index = match.start()

# Count braces to find the end of the function
brace_count = 0
found_first_brace = False
end_index = -1

for i in range(start_index, len(content)):
    char = content[i]
    if char == '{':
        brace_count += 1
        found_first_brace = True
    elif char == '}':
        brace_count -= 1
    
    if found_first_brace and brace_count == 0:
        end_index = i + 1
        break

if end_index == -1:
    print("Could not find renderToolsView function end")
    exit(1)

# Replace the content
updated_content = content[:start_index] + new_code + content[end_index:]

with open('bundle_v24.js', 'w', encoding='utf-8') as f:
    f.write(updated_content)

print("Successfully patched renderToolsView in bundle_v24.js")
