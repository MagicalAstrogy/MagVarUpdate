const statusblock_regex = /<Statusblock>MOBIUS-STATUS<\/Statusblock>/s;

// Placeholder for Mobi's image URL (to be updated later when available)
const mobiImageUrl = 'https://gitgud.io/KazePsi/file-storage/-/raw/master/mobius/image/nyanovel_1749093485822.jpg';

// Audio URL (replace with actual URL)
const audioUrl = 'https://gitgud.io/KazePsi/file-storage/-/raw/master/mobius/audio/Music_BG_0.ogg';

// Global audio element
const audio = new Audio(audioUrl);
audio.loop = true;

// Global playback state
let isPlaying = false;

// Function to toggle audio playback
function toggleAudio(decoration) {
    if (isPlaying) {
        audio.pause();
    } else {
        audio.play().catch(error => console.error('Audio playback failed:', error));
    }
    isPlaying = !isPlaying;
    // Immediately update the clicked decoration
    if (isPlaying) {
        decoration.classList.add('rotating');
    } else {
        decoration.classList.remove('rotating');
    }
    // Re-render all status blocks to sync rotation state
    renderAllStatusBlocks();
}

// Function to update all decoration symbols based on playback state
function updateAllDecorations() {
    document.querySelectorAll('.status-decoration').forEach(dec => {
        if (isPlaying) {
            dec.classList.add('rotating');
        } else {
            dec.classList.remove('rotating');
        }
    });
}

// Generate the status block based on provided variables
function generateStatusBlock(variables) {
    const statData = variables.stat_data || {};
    const userKey = substitudeMacros('<user>'); // Get actual username
    
    // Create container
    const container = document.createElement('div');
    container.className = 'status-container pink-theme';
    
    // Create background overlay
    const backgroundOverlay = document.createElement('div');
    backgroundOverlay.className = 'status-background-overlay';
    
    // Create global info section (当前时间, 经历天数, 当前位置, 锚定状态, 时间循环)
    const globalInfo = document.createElement('div');
    globalInfo.className = 'status-global-info';
    
    ['当前时间', '经历天数', '当前位置', '锚定状态', '时间循环'].forEach(field => {
        const infoDisplay = document.createElement('div');
        infoDisplay.className = 'status-variable';
        const value = statData[field]?.[0];
        infoDisplay.innerHTML = `
            <span class="key pink-theme">${field}:</span>
            <span class="value pink-theme">${value !== undefined && value !== null ? value : `未知${field}`}</span>
        `;
        globalInfo.appendChild(infoDisplay);
    });
    
    // Create tab container
    const tabContainer = document.createElement('div');
    tabContainer.className = 'status-tabs';
    
    // Create content container
    const contentContainer = document.createElement('div');
    contentContainer.className = 'status-content';
    
    // Create decoration element (attached to container)
    const decoration = document.createElement('div');
    decoration.className = 'status-decoration infinity-symbol';
    decoration.textContent = '∞'; // Default to Mobi's decoration
    if (isPlaying) {
        decoration.classList.add('rotating');
    }
    decoration.addEventListener('click', () => toggleAudio(decoration));
    
    // Tab configuration
    const tabs = [
        { label: '莫比', prefix: '莫比', theme: 'pink-theme', decoration: { symbol: '∞', class: 'infinity-symbol' } },
        { label: userKey, prefix: userKey, theme: 'blue-theme', decoration: { symbol: '★', class: 'star-symbol' } }
    ];
    
    // Create tab buttons and content panels
    tabs.forEach((tab, index) => {
        // Tab button
        const button = document.createElement('button');
        button.className = 'status-tab';
        button.textContent = tab.label;
        button.dataset.tab = index;
        if (index === 0) button.classList.add('active');
        tabContainer.appendChild(button);
        
        // Content panel
        const panel = document.createElement('div');
        panel.className = 'status-panel';
        panel.dataset.tab = index;
        if (index !== 0) panel.style.display = 'none';
        
        const panelContent = document.createElement('div');
        panelContent.className = 'status-panel-content';
        
        // Get data for this tab
        const tabData = statData[tab.prefix] || {};
        
        // Define variable order for display
        const order = tab.prefix === '莫比' 
            ? ['亲密度', '发育年龄', '子宫填充度', '着装', '重要成就', '心中想法'] 
            : ['发育年龄', '侵蚀强度', '侵蚀深度'];
        const filteredVars = Object.keys(tabData)
            .filter(key => order.includes(key))
            .sort((a, b) => order.indexOf(a) - order.indexOf(b));
        
        filteredVars.forEach(key => {
            const value = tabData[key][0];
            let content = '';
            
            if (key === '着装') {
                const clothing = Array.isArray(value) && value.length > 0 ? value.join('、') : '无着装';
                content = `
                    <div class="status-variable">
                        <span class="key ${tab.theme}">${key}:</span>
                        <span class="value ${tab.theme}">${clothing}</span>
                    </div>
                `;
            } else if (key === '重要成就') {
                const experiences = Array.isArray(value) ? value : [];
                const entries = experiences.map(exp => 
                    `<div class="status-variable"><span class="value ${tab.theme}">${exp}</span></div>`
                ).join('');
                content = `
                    <div class="status-section ${tab.theme}">
                        <button class="collapsible">${key}<span class="collapsible-indicator">▶</span></button>
                        <div class="collapsible-content" style="display: none;">
                            ${entries || `<div class="status-variable"><span class="value ${tab.theme}">无数据</span></div>`}
                        </div>
                    </div>
                `;
            } else {
                content = `
                    <div class="status-variable">
                        <span class="key ${tab.theme}">${key}:</span>
                        <span class="value ${tab.theme}">${value === null ? '无数据' : value}</span>
                    </div>
                `;
            }
            panelContent.innerHTML += content;
        });
        
        panel.appendChild(panelContent);
        contentContainer.appendChild(panel);
    });
    
    // Styles
    const style = document.createElement('style');
    style.textContent = `
        .status-background-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-repeat: no-repeat;
            background-position: top center;
            background-size: 100% auto;
            z-index: -1;
            pointer-events: none;
        }
        .status-container {
            font-family: "Heiti SC", sans-serif;
            background-color: rgba(255, 255, 255, 0.1);
            border: 3px solid #ffffff;
            border-radius: 18px;
            color: #ffffff;
            padding: 10px;
            margin: 10px 0;
            max-width: 100%;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        .status-container.pink-theme {
            background-color: rgba(255, 105, 180, 0.2);
            border-color: #ff69b4;
            color: #ffb6c1;
        }
        .status-container.blue-theme {
            background-color: rgba(10, 26, 47, 0.5);
            border-color: #1e90ff;
            color: #00b7eb;
        }
        .pink-theme .key, .pink-theme .value, .pink-theme .collapsible, .pink-theme .collapsible-indicator {
            color: #ffb6c1;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
        }
        .blue-theme .key, .blue-theme .value, .blue-theme .collapsible, .blue-theme .collapsible-indicator {
            color: #00b7eb;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
        }
        .pink-theme .status-section {
            border-top-color: #ffb6c1;
        }
        .blue-theme .status-section {
            border-top-color: #1e90ff;
        }
        .status-global-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 10px;
        }
        .status-tabs {
            display: flex;
            gap: 5px;
            margin-bottom: 10px;
            overflow-x: auto;
        }
        .status-tab {
            padding: 8px 16px;
            border: 2px solid;
            border-radius: 10px;
            cursor: pointer;
            font-size: 14px;
            font-family: "Heiti SC", sans-serif;
            white-space: nowrap;
            transition: all 0.2s ease;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
        }
        .status-tab.active {
            font-weight: bold;
        }
        .pink-theme .status-tab {
            border-color: #ff69b4;
            color: #ffb6c1;
            background-color: rgba(255, 182, 193, 0.1);
        }
        .pink-theme .status-tab.active {
            background-color: #ff69b4;
            color: #ffffff;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
        }
        .blue-theme .status-tab {
            border-color: #1e90ff;
            color: #00b7eb;
            background-color: rgba(30, 144, 255, 0.1);
        }
        .blue-theme .status-tab.active {
            background-color: #1e90ff;
            color: #ffffff;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
        }
        .status-content {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .status-panel {
            display: flex;
            flex-direction: column;
            gap: 8px;
            position: relative;
        }
        .status-panel-content {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .status-variable {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .key {
            font-weight: bold;
            min-width: 120px;
        }
        .value {
            flex: 1;
        }
        .status-section {
            border-top: 1px solid #eee;
            padding-top: 8px;
            margin-top: 8px;
        }
        .status-decoration {
            position: absolute;
            top: 10%;
            right: 3%;
            font-size: 60px;
            z-index: 1;
            cursor: pointer;
            transition: transform 0.2s ease;
        }
        .infinity-symbol {
            color: #ff69b4;
        }
        .star-symbol {
            color: #00b7eb;
        }
        .rotating {
            animation: rotate 5s linear infinite;
        }
        @keyframes rotate {
            from {
                transform: rotate(0deg);
            }
            to {
                transform: rotate(360deg);
            }
        }
        .collapsible {
            cursor: pointer;
            padding: 8px;
            border: none;
            text-align: left;
            outline: none;
            font-size: 14px;
            background: transparent;
            font-weight: bold;
            width: 100%;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .collapsible-indicator {
            font-size: 12px;
            transition: transform 0.2s ease;
        }
        .collapsible-content {
            padding-left: 10px;
        }
    `;
    
    container.appendChild(backgroundOverlay);
    container.appendChild(style);
    container.appendChild(globalInfo);
    container.appendChild(tabContainer);
    container.appendChild(contentContainer);
    container.appendChild(decoration);
    
    // Set initial background (if image URL is provided)
    if (mobiImageUrl) {
        backgroundOverlay.style.backgroundImage = `url('${mobiImageUrl}')`;
    }
    
    // Tab switching event
    tabContainer.addEventListener('click', (event) => {
        const button = event.target.closest('.status-tab');
        if (!button) return;
        const tabIndex = button.dataset.tab;
        
        // Update theme
        container.classList.remove('pink-theme', 'blue-theme');
        container.classList.add(tabs[tabIndex].theme);
        
        // Update global info theme
        globalInfo.querySelectorAll('.key, .value').forEach(el => {
            el.classList.remove('pink-theme', 'blue-theme');
            el.classList.add(tabs[tabIndex].theme);
        });
        
        // Update background (if applicable)
        const activeTabLabel = tabs[tabIndex].label;
        backgroundOverlay.style.backgroundImage = activeTabLabel === '莫比' && mobiImageUrl ? `url('${mobiImageUrl}')` : 'none';
        
        // Update decoration
        decoration.className = `status-decoration ${tabs[tabIndex].decoration.class}`;
        decoration.textContent = tabs[tabIndex].decoration.symbol;
        // Ensure rotation state is applied
        if (isPlaying) {
            decoration.classList.add('rotating');
        } else {
            decoration.classList.remove('rotating');
        }
        
        // Update tab and panel states
        tabContainer.querySelectorAll('.status-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabIndex);
        });
        contentContainer.querySelectorAll('.status-panel').forEach(panel => {
            panel.style.display = panel.dataset.tab === tabIndex ? 'flex' : 'none';
        });
    });
    
    // Collapsible functionality
    contentContainer.addEventListener('click', (event) => {
        if (event.target.classList.contains('collapsible')) {
            const content = event.target.nextElementSibling;
            const indicator = event.target.querySelector('.collapsible-indicator');
            const isCollapsed = content.style.display === 'none';
            content.style.display = isCollapsed ? 'block' : 'none';
            indicator.textContent = isCollapsed ? '▼' : '▶';
        }
    });
    
    return container;
}

// Update status block function
async function updateStatusBlock(message_id) {
    const rawMessage = (await getChatMessages(message_id))[0]?.message;
    if (!rawMessage || !statusblock_regex.test(rawMessage)) return;
    
    const variables = await getVariables({type: 'message', message_id: message_id});
    const statusContainer = generateStatusBlock(variables);
    
    const $mes_text = retrieveDisplayedMessage(message_id);
    const to_replace = $mes_text.find('div.status-container, pre:contains("<Statusblock>MOBIUS-STATUS</Statusblock>")');
    
    if (to_replace.length > 0) {
        to_replace.replaceWith(statusContainer);
    } else if (statusblock_regex.test($mes_text.html())) {
        $mes_text.html($mes_text.html().replace(statusblock_regex, statusContainer.outerHTML));
    }
}

// Event handling and initial rendering
async function renderAllStatusBlocks() {
    $("#chat", window.parent.document)
        .children(".mes[is_user='false'][is_system='false']")
        .each((_, node) => {
            updateStatusBlock(Number(node.getAttribute("mesid")));
        });
}

eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED, updateStatusBlock);
eventOn(tavern_events.MESSAGE_UPDATED, updateStatusBlock);
eventOn(tavern_events.MESSAGE_SWIPED, updateStatusBlock);
eventOn(tavern_events.MESSAGE_DELETED, renderAllStatusBlocks);
renderAllStatusBlocks();