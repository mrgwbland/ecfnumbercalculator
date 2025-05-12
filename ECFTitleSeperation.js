// ECF Title Separation Calculator

// Cache for API responses
const playerInfoCache = {};
const playerGamesCache = {};
const ecfNumberCache = {};

// Debug level: 0=minimal, 1=some, 2=detailed
let DEBUG_LEVEL = 0;

// Backend status
let backendOnline = false;

// Available CORS proxies - separate base URL and API path
const BACKEND_URL = "https://ecftitleseperationbackend.onrender.com";
const CORS_PROXIES = {
    "render-backend": `${BACKEND_URL}/api`,
    "corsproxy.io": "https://corsproxy.io/?",
    "allorigins": "https://api.allorigins.win/raw?url="
};

// Currently selected CORS proxy - start with render backend
let currentProxyKey = "render-backend";

// Base URL for the ECF API
const BASE_URL = "https://rating.englishchess.org.uk/v2/new/api.php";

/**
 * Check if the render backend is available
 */
async function checkBackendStatus() {
    try {
        addResult("⏳ Checking backend server status...");
        // Use the root URL for health check, not the API endpoint
        const pingUrl = BACKEND_URL;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch(pingUrl, { 
            signal: controller.signal 
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            backendOnline = true;
            addResult("✅ Backend server is online! Using fast direct connection.");
            return true;
        } else {
            backendOnline = false;
            addResult(`⚠️ WARNING: Backend server returned error ${response.status}`);
            addResult("⚠️ Falling back to public proxies (slower)");
            changeProxy("corsproxy.io");
            return false;
        }
    } catch (e) {
        backendOnline = false;
        addResult(`⚠️ WARNING: Backend server is offline or sleeping (${e.message})`);
        addResult("⚠️ Using public proxies instead (slower). Try again later.");
        changeProxy("corsproxy.io");
        return false;
    }
}

/**
 * Print debug messages to the console and debug area
 */
function debugPrint(message, level = 1) {
    if (DEBUG_LEVEL >= level) {
        console.log(`[DEBUG] ${message}`);
        const debugArea = document.getElementById('debug-area');
        if (debugArea) {
            debugArea.innerHTML += `<div class="debug-message">[DEBUG] ${message}</div>`;
            debugArea.scrollTop = debugArea.scrollHeight;
        }
    }
}

/**
 * Clear debug output
 */
function clearDebug() {
    const debugArea = document.getElementById('debug-area');
    if (debugArea) {
        debugArea.innerHTML = '';
    }
}

/**
 * Change the current CORS proxy
 */
function changeProxy(proxyKey) {
    if (CORS_PROXIES.hasOwnProperty(proxyKey)) {
        currentProxyKey = proxyKey;
        debugPrint(`CORS proxy changed to: ${proxyKey}`);
        return true;
    }
    return false;
}

// Track proxy performance metrics
const proxyPerformance = {
    "render-backend": { attempts: 0, successes: 0, totalTime: 0, lastSuccess: 0 },
    "corsproxy.io": { attempts: 0, successes: 0, totalTime: 0, lastSuccess: 0 },
    "allorigins": { attempts: 0, successes: 0, totalTime: 0, lastSuccess: 0 }
};

/**
 * Update proxy performance metrics
 */
function updateProxyPerformance(proxyKey, success, responseTime) {
    if (!proxyPerformance[proxyKey]) return;
    
    proxyPerformance[proxyKey].attempts++;
    
    if (success) {
        proxyPerformance[proxyKey].successes++;
        proxyPerformance[proxyKey].totalTime += responseTime;
        proxyPerformance[proxyKey].lastSuccess = Date.now();
    }
}

/**
 * Get the best available proxy based on performance metrics
 */
function getBestProxy() {
    const now = Date.now();
    let bestProxy = null;
    let bestScore = -1;
    
    Object.entries(proxyPerformance).forEach(([key, stats]) => {
        // Skip proxies that haven't been tried yet - we'll try them in order
        if (stats.attempts === 0) return;
        
        // Skip render backend if it's offline
        if (key === "render-backend" && !backendOnline) return;
        
        // Calculate a score based on success rate and recency
        const successRate = stats.attempts > 0 ? stats.successes / stats.attempts : 0;
        const avgResponseTime = stats.successes > 0 ? stats.totalTime / stats.successes : 9999;
        const timeSinceLastSuccess = stats.lastSuccess > 0 ? (now - stats.lastSuccess) / 1000 : 9999;
        
        // Score formula weights success rate heavily, recent successes moderately,
        // and fast response time somewhat
        const score = (successRate * 0.7) - 
                      (Math.min(timeSinceLastSuccess, 300) / 300 * 0.2) - 
                      (Math.min(avgResponseTime, 2000) / 2000 * 0.1);
        
        if (score > bestScore) {
            bestScore = score;
            bestProxy = key;
        }
    });
    
    // If no proxy has been tried or all have failed, start with the first one
    if (!bestProxy) {
        bestProxy = backendOnline ? "render-backend" : "corsproxy.io";
    }
    
    return bestProxy;
}

/**
 * Display proxy performance statistics
 */
function displayProxyPerformance() {
    const stats = [];
    
    Object.entries(proxyPerformance).forEach(([key, data]) => {
        const successRate = data.attempts > 0 ? 
            ((data.successes / data.attempts) * 100).toFixed(1) + '%' : 'N/A';
        const avgTime = data.successes > 0 ? 
            (data.totalTime / data.successes).toFixed(0) + 'ms' : 'N/A';
        
        stats.push(`${key}: ${successRate} success (${data.successes}/${data.attempts}), avg: ${avgTime}`);
    });
    
    addResult('\nProxy Performance:');
    stats.forEach(stat => addResult(stat));
}

// Add API call counters
let apiCallsCounter = {
    players: 0,
    games: 0
};

/**
 * Reset API call counters before starting a new search
 */
function resetApiCounters() {
    apiCallsCounter = {
        players: 0,
        games: 0
    };
}

/**
 * Get information about a player from their ECF code
 */
async function getPlayerInfo(playerCode) {
    if (playerInfoCache[playerCode]) {
        debugPrint(`Using cached player info for ${playerCode}`, 2);
        return playerInfoCache[playerCode];
    }
    
    debugPrint(`Fetching player info for ${playerCode}`);
    
    // Count this as a player API call regardless of outcome
    apiCallsCounter.players++;
    
    // Try with the current proxy first
    const proxyKey = currentProxyKey;
    const corsProxy = CORS_PROXIES[proxyKey];
    let url;
    
    // Different URL format based on proxy type
    if (proxyKey === "render-backend") {
        url = `${corsProxy}/v2/players/code/${playerCode}`;
        debugPrint(`Using render backend URL: ${url}`, 2);
    } else {
        const apiEndpoint = `${BASE_URL}?v2/players/code/${playerCode}`;
        url = corsProxy ? `${corsProxy}${encodeURIComponent(apiEndpoint)}` : apiEndpoint;
    }
    
    try {
        debugPrint(`API request: ${url}`, 2);
        
        const startTime = performance.now();
        const response = await fetchWithRetry(url);
        const endTime = performance.now();
        const responseTime = endTime - startTime;
        
        // Update metrics with success
        updateProxyPerformance(proxyKey, response.ok, responseTime);
        
        if (!response.ok) {
            console.error(`Error fetching player info for ${playerCode}: ${response.status}`);
            
            // If render-backend fails, mark it as offline
            if (proxyKey === "render-backend") {
                backendOnline = false;
            }
            
            playerInfoCache[playerCode] = null; // Cache failed results too
            return null;
        }
        
        const playerInfo = await response.json();
        const playerName = playerInfo.full_name || 'Unknown';
        debugPrint(`Found player: ${playerName} (code: ${playerCode})`);
        
        if (playerInfo.title) {
            debugPrint(`Player has title field: '${playerInfo.title}'`, 2);
        }
        
        playerInfoCache[playerCode] = playerInfo;
        return playerInfo;
    } catch (e) {
        // Update metrics with failure
        updateProxyPerformance(proxyKey, false, 0);
        
        // If render-backend fails, mark it as offline
        if (proxyKey === "render-backend") {
            backendOnline = false;
        }
        
        console.error(`Exception fetching player info for ${playerCode}: ${e}`);
        playerInfoCache[playerCode] = null; // Cache failed results too
        return null;
    }
}

/**
 * Get player information with proxy fallback - now uses performance metrics to prioritize proxies
 */
async function getPlayerInfoWithProxyFallback(playerCode) {
    // Cache check to avoid unnecessary proxy switching
    if (playerInfoCache[playerCode]) {
        debugPrint(`Using cached player info for ${playerCode}`, 2);
        return playerInfoCache[playerCode];
    }
    
    // Try best proxy first, with fewer switches
    const bestProxy = getBestProxy();
    if (currentProxyKey !== bestProxy) {
        changeProxy(bestProxy);
    }
    
    // Try with the current best proxy first
    try {
        const result = await getPlayerInfo(playerCode);
        if (result) return result;
    } catch (e) {
        debugPrint(`Best proxy ${bestProxy} failed: ${e.message}`, 1);
    }
    
    // If best proxy fails, try others but less aggressively
    const proxies = Object.keys(CORS_PROXIES).filter(p => p !== bestProxy);
    for (const proxyKey of proxies) {
        changeProxy(proxyKey);
        debugPrint(`Trying proxy: ${proxyKey}`, 1);
        
        try {
            const result = await getPlayerInfo(playerCode);
            if (result) return result;
        } catch (e) {
            debugPrint(`Proxy ${proxyKey} failed: ${e.message}`, 1);
        }
    }
    
    // Return to best proxy
    changeProxy(bestProxy);
    return null;
}

/**
 * Get games played by a player with optimized proxy handling
 */
async function getPlayerGamesWithProxyFallback(playerCode, gameType = "Standard", limit = 100) {
    const cacheKey = `${playerCode}_${gameType}`;
    if (playerGamesCache[cacheKey]) {
        debugPrint(`Using cached ${gameType} games for ${playerCode}`, 2);
        return playerGamesCache[cacheKey];
    }
    
    // Try primary proxy first
    try {
        const result = await getPlayerGames(playerCode, gameType, limit);
        if (result && result.length > 0) return result;
    } catch (e) {
        debugPrint(`Primary proxy failed for games: ${e.message}`, 1);
    }
    
    // If primary fails, try backup proxy
    const backupProxy = currentProxyKey === "corsproxy.io" ? "allorigins" : "corsproxy.io";
    
    changeProxy(backupProxy);
    debugPrint(`Switching to backup proxy for games: ${backupProxy}`, 1);
    
    try {
        const result = await getPlayerGames(playerCode, gameType, limit);
        // Switch back to primary if backup worked
        if (result && result.length > 0) {
            changeProxy(currentProxyKey);
            return result;
        }
    } catch (e) {
        debugPrint(`Backup proxy failed for games: ${e.message}`, 1);
    }
    
    // Return to primary proxy
    changeProxy(currentProxyKey);
    return [];
}

/**
 * Get games played by a player with explicit API counting
 */
async function getPlayerGames(playerCode, gameType = "Standard", limit = 100) {
    const cacheKey = `${playerCode}_${gameType}`;
    if (playerGamesCache[cacheKey]) {
        debugPrint(`Using cached ${gameType} games for ${playerCode}`, 2);
        return playerGamesCache[cacheKey];
    }
    
    debugPrint(`Fetching ${gameType} games for ${playerCode}`);
    
    // Count this as a game API call regardless of outcome
    apiCallsCounter.games++;
    
    // Use the currently selected CORS proxy
    const proxyKey = currentProxyKey;
    const corsProxy = CORS_PROXIES[proxyKey];
    let url;
    
    // Different URL format based on proxy type
    if (proxyKey === "render-backend") {
        url = `${corsProxy}/v2/games/${gameType}/player/${playerCode}/limit/${limit}`;
        debugPrint(`Using render backend URL: ${url}`, 2);
    } else {
        const apiEndpoint = `${BASE_URL}?v2/games/${gameType}/player/${playerCode}/limit/${limit}`;
        url = corsProxy ? `${corsProxy}${encodeURIComponent(apiEndpoint)}` : apiEndpoint;
    }
    
    try {
        debugPrint(`API request: ${url}`, 2);
        const response = await fetchWithRetry(url, {method: 'GET'}); 
        
        if (!response.ok) {
            console.error(`Error fetching ${gameType} games for ${playerCode}: ${response.status}`);
            
            // If render-backend fails, mark it as offline
            if (proxyKey === "render-backend") {
                backendOnline = false;
            }
            
            playerGamesCache[cacheKey] = []; // Cache empty results too
            return [];
        }
        
        const data = await response.json();
        const games = data.games || [];
        debugPrint(`Found ${games.length} ${gameType} games for ${playerCode}`);
        
        // Cache even empty results
        playerGamesCache[cacheKey] = games;
        return games;
    } catch (e) {
        console.error(`Exception fetching ${gameType} games for ${playerCode}: ${e}`);
        
        // If render-backend fails, mark it as offline
        if (proxyKey === "render-backend") {
            backendOnline = false;
        }
        
        playerGamesCache[cacheKey] = []; // Cache empty results too
        return [];
    }
}

/**
 * Get selected titles from checkboxes
 */
function getSelectedTitles() {
    const selectedTitles = [];
    const checkboxes = document.querySelectorAll('.title-checkbox:checked');
    checkboxes.forEach(checkbox => {
        selectedTitles.push(checkbox.value);
    });
    
    // If no titles are selected, include all titles
    if (selectedTitles.length === 0) {
        return ["GM", "IM", "FM", "CM", "NM", "WGM", "WIM", "WFM", "WCM"];
    }
    
    return selectedTitles;
}

/**
 * Check if a player has a title that matches the filter
 * @param playerInfo - The player information object
 * @param selectedTitles - Array of selected title codes
 * @param filterBySelected - If true, only match selected titles; if false, match any title
 */
function isTitledPlayer(playerInfo, selectedTitles = [], filterBySelected = false) {
    if (!playerInfo) {
        debugPrint("No player info provided to check for title", 2);
        return false;
    }
    
    const playerName = playerInfo.full_name || 'Unknown';
    
    // Check for title field
    const title = playerInfo.title || "";
    if (title && title.trim()) {
        // For intermediate nodes, any title is fine
        if (!filterBySelected) {
            addResult(`✓ Found titled player: ${playerName} with title: ${title}`);
            return true;
        }
        
        // For final node, properly parse individual titles
        // Split the title string by common separators
        const titleUpper = title.trim().toUpperCase();
        
        // Extract individual titles by splitting on common separators
        let individualTitles = [];
        
        // First try to split on common separators
        const splitTitles = titleUpper.split(/[\/,\s]+/);
        
        for (const splitTitle of splitTitles) {
            // Only add valid title codes
            if (["GM", "IM", "FM", "CM", "NM", "WGM", "WIM", "WFM", "WCM"].includes(splitTitle)) {
                individualTitles.push(splitTitle);
            }
        }
        
        // If no valid titles were found in the split, check for embedded titles
        if (individualTitles.length === 0) {
            for (const t of ["GM", "IM", "FM", "CM", "NM", "WGM", "WIM", "WFM", "WCM"]) {
                if (titleUpper === t || titleUpper.includes(t)) {
                    individualTitles.push(t);
                }
            }
        }
        
        // Check if any of the individual titles match the selected titles
        const matchingTitles = individualTitles.filter(t => selectedTitles.includes(t));
        
        if (matchingTitles.length > 0) {
            const matchingTitlesStr = matchingTitles.join(", ");
            addResult(`✓ Found titled player with matching title: ${playerName} (${matchingTitlesStr})`);
            return true;
        } else {
            const availableTitles = individualTitles.join(", ");
            debugPrint(`Player ${playerName} has title(s) ${availableTitles} but none match selected filters`, 2);
            return false;
        }
    } else {
        debugPrint(`No title field for ${playerName}`, 2);
    }
    
    // Fallback: check if name indicates a title
    const name = playerInfo.full_name || "";
    if (!name) {
        debugPrint("No player name available", 2);
        return false;
    }
    
    // Define title prefixes
    const allTitlePrefixes = {
        "GM": "GM ",
        "IM": "IM ",
        "FM": "FM ",
        "CM": "CM ",
        "NM": "NM ",
        "WGM": "WGM ",
        "WIM": "WIM ",
        "WFM": "WFM ",
        "WCM": "WCM "
    };
    
    // For intermediate nodes, check any title
    if (!filterBySelected) {
        const allPrefixes = Object.values(allTitlePrefixes);
        for (const prefix of allPrefixes) {
            if (name.startsWith(prefix)) {
                addResult(`✓ Found titled player by name prefix: ${name} (starts with ${prefix})`);
                return true;
            }
        }
    } else {
        // For final node, only check selected titles
        for (const title of selectedTitles) {
            const prefix = allTitlePrefixes[title];
            if (prefix && name.startsWith(prefix)) {
                addResult(`✓ Found titled player with matching prefix: ${name} (${title})`);
                return true;
            }
        }
    }
    
    debugPrint(`Player ${playerName} has no title or doesn't match selected titles`, 2);
    return false;
}

/**
 * Get a list of all opponents beaten by the player
 */
async function getOpponentsBeatenBy(playerCode) {
    const beatenOpponents = [];
    
    // Make sure we have player info
    const playerInfo = await getPlayerInfoWithProxyFallback(playerCode);
    if (!playerInfo) {
        debugPrint(`Could not get info for player ${playerCode}, cannot find opponents`, 1);
        return [];
    }
    
    const playerName = playerInfo.full_name || playerCode;
    debugPrint(`Looking for opponents beaten by ${playerName}`, 1);
    
    // Add a small delay between API calls
    let delayBetweenCalls = 0; // milliseconds
    
    // Check all game types
    for (const gameType of ["Standard", "Rapid", "Blitz"]) {
        // Add a small delay between game type calls
        await new Promise(r => setTimeout(r, delayBetweenCalls));
        
        // Try with proxy fallback 
        const games = await getPlayerGamesWithProxyFallback(playerCode, gameType, 1000);
        if (!games || games.length === 0) {
            debugPrint(`No ${gameType} games found for ${playerName}`, 2);
            continue;
        }
        
        let winsInType = 0;
        
        // Process each game
        for (const game of games) {
            // Check if player won the game (score = 1)
            const isWin = game.score === 1;
            
            if (isWin) {
                const opponentCode = game.opponent_ecf_code || String(game.opponent_no);
                
                // Skip invalid opponent codes
                if (!opponentCode || opponentCode === "0" || opponentCode === "undefined") {
                    continue;
                }
                
                const opponentName = game.opponent_name || "Unknown";
                const colorPlayed = game.colour || "?";
                winsInType++;
                
                debugPrint(`  Win as ${colorPlayed} against ${opponentName} (${opponentCode}) in ${gameType} game on ${game.game_date}`, 2);
                beatenOpponents.push(opponentCode);
            }
        }
        
        debugPrint(`  Found ${winsInType} wins in ${gameType}`, 1);
    }
    
    // Get unique opponents
    const uniqueOpponents = [...new Set(beatenOpponents)];
    debugPrint(`Total unique opponents beaten: ${uniqueOpponents.length}`, 1);
    return uniqueOpponents;
}

/**
 * Handle the form submission with proper API counting
 */
async function handleSubmit(event) {
    event.preventDefault();
    
    const playerCodeInput = document.getElementById('player-code');
    let playerCode = playerCodeInput.value.trim();
    
    if (!playerCode) {
        alert('Please enter a valid ECF player code');
        return;
    }

    setLoading(true);
    clearResults();
    clearDebug();
    
    // Reset API counters for new search
    resetApiCounters();
    
    // Get debug level from dropdown
    const debugLevelSelect = document.getElementById('debug-level');
    if (debugLevelSelect) {
        DEBUG_LEVEL = parseInt(debugLevelSelect.value, 10);
    }
    
    try {
        // Get selected titles
        const selectedTitles = getSelectedTitles();
        const titleFilters = selectedTitles.join(", ");
        addResult(`Starting search for player ${playerCode}...`);
        
        if (selectedTitles.length < 9) { // 9 is all possible titles
            addResult(`Looking for paths to players with these titles: ${titleFilters}`);
        }
        
        const startTime = performance.now();
        const result = await calculateEcfNumber(playerCode);
        const endTime = performance.now();
        
        const playerInfo = await getPlayerInfo(playerCode);
        const playerName = playerInfo ? playerInfo.full_name || playerCode : playerCode;
        
        addResult('\n');
        addResult('RESULTS:');
        
        if (result.value === 0) {
            addResult(`✓ ${playerName}'s Titled Separation is 0 (directly beat a titled player)`);
        } else if (result.value > 0) {
            addResult(`✓ ${playerName}'s Titled Separation is ${result.value}`);
        } else {
            addResult(`✗ No path found from ${playerName} to a titled player`);
        }
        
        if (result.path && result.path.length > 0) {
            addResult(`\nPath: ${formatPath(result.path)}`);
        }
        
        addResult(`\nSearch completed in ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
        addResult(`API calls: ${apiCallsCounter.players} player lookups, ${apiCallsCounter.games} batch game lookups`);
        
        // Display proxy performance metrics
        displayProxyPerformance();
    } catch (e) {
        addResult(`An error occurred: ${e.message}`);
        console.error(e);
    } finally {
        setLoading(false);
    }
}

// Update calculateEcfNumber to ensure full codes in path
async function calculateEcfNumber(playerCode, maxDepth = 5) {
    // Get selected titles from checkboxes
    const selectedTitles = getSelectedTitles();
    
    // Create a cache key that includes both player code and selected titles
    const cacheKey = `${playerCode}_${selectedTitles.sort().join('-')}`;
    
    // Check if we've already calculated this player's ECF number with these exact title filters
    if (ecfNumberCache[cacheKey]) {
        debugPrint(`Using cached Titled Separation for ${playerCode} with filters: ${selectedTitles.join(', ')}`, 2);
        return ecfNumberCache[cacheKey];
    }
    
    // Check if the player exists
    const playerInfo = await getPlayerInfo(playerCode);
    if (!playerInfo) {
        addResult(`Player ${playerCode} not found.`);
        return { value: -1, path: [] };
    }
    
    const playerName = playerInfo.full_name || playerCode;
    addResult(`Calculating Titled Separation for ${playerName}...`);
    
    // Check if player is titled immediately
    if (isTitledPlayer(playerInfo, selectedTitles, true)) {
        const result = { 
            value: 0, 
            path: [{ name: playerName, code: playerCode }] 
        };
        // Store in cache with the title-specific key
        ecfNumberCache[cacheKey] = result;
        addResult(`✓ Player is titled: ${playerName}`);
        return result;
    }
    
    // BFS queue with proper breadth-first ordering
    const queue = [];
    queue.push([playerCode, 0, [{ name: playerName, code: playerCode }]]);  // [playerCode, distance, path]
    const visited = new Set([playerCode]);
    
    debugPrint(`Starting BFS search from ${playerName}`);
    
    // Track progress stats
    let nodesProcessed = 0;
    const apiCallsStart = {
        players: Object.keys(playerInfoCache).length,
        games: Object.keys(playerGamesCache).length
    };
    
    // Process the queue in strict level order (true BFS)
    while (queue.length > 0) {
        // Get the next player to process (FIFO - breadth first)
        const [currentCode, distance, path] = queue.shift();
        nodesProcessed++;
        
        if (nodesProcessed % 10 === 0) {
            addResult(`Searching... (${nodesProcessed} players checked, ${queue.length} in queue)`);
        }
        
        // Stop if we've gone too deep
        if (distance >= maxDepth) {
            debugPrint(`Reached max depth (${maxDepth}) for this branch`, 2);
            continue;
        }
        
        const currentInfo = await getPlayerInfoWithProxyFallback(currentCode);
        if (!currentInfo) {
            debugPrint(`Could not get info for ${currentCode}, skipping branch`, 1);
            continue;
        }
        
        const currentName = currentInfo.full_name || currentCode;
        debugPrint(`Examining ${currentName} at distance ${distance}`, 1);
        
        // Get all opponents beaten by this player
        let beatenOpponents;
        try {
            beatenOpponents = await getOpponentsBeatenBy(currentCode);
        } catch (err) {
            debugPrint(`Error getting opponents for ${currentName}: ${err.message}`, 1);
            continue;
        }
        
        if (!beatenOpponents || beatenOpponents.length === 0) {
            debugPrint(`${currentName} has not beaten any opponents`, 1);
            continue;
        }
        
        debugPrint(`${currentName} has beaten ${beatenOpponents.length} unique opponents`, 1);
        
        // Sort the opponents to ensure deterministic order across runs
        beatenOpponents.sort();
        
        // Process all opponents at this level
        for (const opponentCode of beatenOpponents) {
            if (visited.has(opponentCode)) {
                continue;
            }
            
            visited.add(opponentCode);
            
            const opponentInfo = await getPlayerInfoWithProxyFallback(opponentCode);
            if (!opponentInfo) {
                debugPrint(`Could not get info for opponent ${opponentCode}`, 2);
                continue;
            }
            
            const opponentName = opponentInfo.full_name || opponentCode;
            const newPath = [...path, { name: opponentName, code: opponentCode }];
            
            // Check if opponent is titled
            if (isTitledPlayer(opponentInfo, selectedTitles, true)) {
                // Ensure all players in path have full ECF codes with suffixes
                
                const result = { value: distance + 1, path: newPath };
                // Store in cache with the title-specific key
                ecfNumberCache[cacheKey] = result;
                
                const pathStr = formatPath(newPath);
                addResult(`✓ Found path to titled player (${distance+1} steps): ${pathStr}`);
                
                return result;
            }
            
            // Add to queue for next level processing
            if (distance + 1 < maxDepth) {
                queue.push([opponentCode, distance + 1, newPath]);
                debugPrint(`Added ${opponentName} to queue at distance ${distance+1}`, 2);
            }
        }
    }
    
    addResult(`✗ No path found to any titled player within ${maxDepth} steps`);
    
    const playerApiCalls = Object.keys(playerInfoCache).length - apiCallsStart.players;
    const gameApiCalls = Object.keys(playerGamesCache).length - apiCallsStart.games;
    
    debugPrint(`Search complete: ${nodesProcessed} players checked, ${playerApiCalls} player API calls, ${gameApiCalls} game API calls`);
    
    const result = { value: -1, path: [] };
    // Store in cache with the title-specific key
    ecfNumberCache[cacheKey] = result;
    return result;
}

/**
 * Format path as plain text
 */
function formatPath(path) {
    // Just join the player names with arrows, no HTML links
    return path.map(player => player.name).join(" → ");
}

/**
 * Add a result message to the results area
 */
function addResult(message) {
    console.log(message);
    const resultsArea = document.getElementById('results');
    if (resultsArea) {
        resultsArea.innerHTML += `<div>${message}</div>`;
        resultsArea.scrollTop = 0; // Scroll to top when new results are added
    }
}

/**
 * Clear the results area
 */
function clearResults() {
    const resultsArea = document.getElementById('results');
    if (resultsArea) {
        resultsArea.innerHTML = '';
    }
}

/**
 * Set the loading state of the page
 */
function setLoading(isLoading) {
    const calculateButton = document.getElementById('calculate-button');
    const loadingIndicator = document.getElementById('loading');
    
    if (calculateButton) {
        calculateButton.disabled = isLoading;
    }
    
    if (loadingIndicator) {
        loadingIndicator.style.display = isLoading ? 'block' : 'none';
    }
}

/**
 * Initialize the page
 */
async function init() {
    // First check if the backend is available
    await checkBackendStatus();
    
    const form = document.getElementById('calculator-form');
    if (form) {
        form.addEventListener('submit', handleSubmit);
    }
    
    const debugLevelSelect = document.getElementById('debug-level');
    if (debugLevelSelect) {
        debugLevelSelect.addEventListener('change', (e) => {
            DEBUG_LEVEL = parseInt(e.target.value, 10);
            debugPrint(`Debug level set to ${DEBUG_LEVEL}`);
        });
    }
    
    // Set up title checkbox handlers
    const selectAllBtn = document.getElementById('select-all-titles');
    const deselectAllBtn = document.getElementById('deselect-all-titles');
    
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.title-checkbox').forEach(cb => {
                cb.checked = true;
            });
        });
    }
    
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.title-checkbox').forEach(cb => {
                cb.checked = false;
            });
        });
    }
    
    // Set up the proxy selector
    const proxySelect = document.getElementById('cors-proxy');
    if (proxySelect) {
        proxySelect.addEventListener('change', (e) => {
            if (changeProxy(e.target.value)) {
                addResult(`CORS proxy changed to: ${e.target.value}`);
            }
        });
    }
}

// Initialize when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);

/**
 * Retry fetching a URL with exponential backoff
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            
            // If rate limited (429), wait longer
            if (response.status === 429) {
                const waitTime = Math.pow(2, retries) * 1000;
                debugPrint(`Rate limited. Retrying in ${waitTime}ms`, 1);
                await new Promise(r => setTimeout(r, waitTime));
                retries++;
                continue;
            }
            
            return response; // Other error, let caller handle
        } catch (e) {
            retries++;
            if (retries >= maxRetries) throw e;
            await new Promise(r => setTimeout(r, Math.pow(2, retries) * 500));
        }
    }
}

/**
 * Helper: Get player's rating (returns 0 if not available)
 */
async function getPlayerRating(playerCode) {
    const info = await getPlayerInfoWithProxyFallback(playerCode);
    if (info && typeof info.rating === "number") return info.rating;
    // Try standard_rating if available
    if (info && typeof info.standard_rating === "number") return info.standard_rating;
    return 0;
}