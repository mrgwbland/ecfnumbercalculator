import requests
import json
from collections import deque
import sys
import time

# Base URL for the ECF API
BASE_URL = "https://rating.englishchess.org.uk/v2/new/api.php"

# Cache for API responses to avoid repeated calls
player_info_cache = {}
player_games_cache = {}
ecf_number_cache = {}

# Debug level: 0=minimal, 1=normal, 2=detailed
DEBUG_LEVEL = 0

def debug_print(message, level=1):
    """Print debug messages based on debug level."""
    if DEBUG_LEVEL >= level:
        print(f"[DEBUG] {message}")

def get_player_info(player_code):
    """Get information about a player from their ECF code."""
    if player_code in player_info_cache:
        debug_print(f"Using cached player info for {player_code}", 2)
        return player_info_cache[player_code]
    
    debug_print(f"Fetching player info for {player_code}")
    url = f"{BASE_URL}?v2/players/code/{player_code}"
    try:
        debug_print(f"API request: {url}", 2)
        response = requests.get(url)
        if response.status_code != 200:
            print(f"Error fetching player info for {player_code}: {response.status_code}")
            player_info_cache[player_code] = None
            return None
        
        player_info = response.json()
        player_name = player_info.get('full_name', 'Unknown')
        debug_print(f"Found player: {player_name} (code: {player_code})")
        
        # Debug title information
        if 'title' in player_info:
            debug_print(f"Player has title field: '{player_info['title']}'", 2)
        
        player_info_cache[player_code] = player_info
        return player_info
    except Exception as e:
        print(f"Exception fetching player info for {player_code}: {e}")
        return None

def get_player_games(player_code, game_type="Standard", limit=100):
    """Get games played by a player."""
    cache_key = f"{player_code}_{game_type}"
    if cache_key in player_games_cache:
        debug_print(f"Using cached {game_type} games for {player_code}", 2)
        return player_games_cache[cache_key]
    
    debug_print(f"Fetching {game_type} games for {player_code}")
    url = f"{BASE_URL}?v2/games/{game_type}/player/{player_code}/limit/{limit}"
    try:
        debug_print(f"API request: {url}", 2)
        response = requests.get(url)
        if response.status_code != 200:
            print(f"Error fetching {game_type} games for {player_code}: {response.status_code}")
            player_games_cache[cache_key] = []
            return []
        
        data = response.json()
        games = data.get("games", [])
        debug_print(f"Found {len(games)} {game_type} games for {player_code}")
        
        # Debug the first game to verify format
        if games and DEBUG_LEVEL >= 2:
            debug_print(f"Sample game: {json.dumps(games[0], indent=2)}", 2)
            
        player_games_cache[cache_key] = games
        return games
    except Exception as e:
        print(f"Exception fetching {game_type} games for {player_code}: {e}")
        return []

def is_titled_player(player_info):
    """Check if a player has a title."""
    if not player_info:
        debug_print("No player info provided to check for title", 2)
        return False
    
    player_name = player_info.get('full_name', 'Unknown')
    
    # Check for title field (added May 2024 per API docs)
    title = player_info.get("title", "")
    if title and title.strip():
        print(f"✓ Found titled player: {player_name} with title: {title}")
        return True
    else:
        debug_print(f"No title field for {player_name}", 2)
        
    # Fallback: check if name indicates a title
    name = player_info.get("full_name", "")
    if not name:
        debug_print("No player name available", 2)
        return False
        
    title_prefixes = ["GM ", "IM ", "FM ", "CM ", "NM ", "WGM ", "WIM ", "WFM ", "WCM "]
    for prefix in title_prefixes:
        if name.startswith(prefix):
            print(f"✓ Found titled player by name prefix: {name} (starts with {prefix})")
            return True
            
    debug_print(f"Player {player_name} has no title", 2)
    return False

def get_opponents_beaten_by(player_code):
    """Get a list of all opponents beaten by the player."""
    beaten_opponents = []
    
    player_info = player_info_cache.get(player_code, get_player_info(player_code))
    player_name = player_info.get('full_name', player_code) if player_info else player_code
    
    debug_print(f"Looking for opponents beaten by {player_name}")
    
    for game_type in ["Standard", "Rapid", "Blitz"]:
        games = get_player_games(player_code, game_type=game_type)
        wins_in_type = 0
        
        for game in games:
            # FORMAT: 
            # "colour" = "W" or "B" (player's color)
            # "score" = 1 (win), 0.5 (draw), 0 (loss)
            # "opponent_no" = opponent's ECF code
            
            is_win = game.get("score") == 1
            
            if is_win:
                opponent_code = str(game.get("opponent_no"))  # Convert to string as ECF codes are strings
                opponent_name = game.get("opponent_name", "Unknown")
                color_played = game.get("colour", "?")
                wins_in_type += 1
                debug_print(f"  Win as {color_played} against {opponent_name} ({opponent_code}) in {game_type} game on {game.get('game_date')}", 2)
                beaten_opponents.append(opponent_code)
        
        debug_print(f"  Found {wins_in_type} wins in {game_type}")
    
    debug_print(f"Total unique opponents beaten: {len(set(beaten_opponents))}")
    return list(set(beaten_opponents))  # Return unique values

def calculate_ecf_number(player_code, max_depth=5):
    """
    Calculate the Titled Speration for a player using BFS.
    
    Args:
        player_code: The ECF code of the player
        max_depth: Maximum search depth to avoid API rate limits
        
    Returns:
        int: The Titled Speration (0, 1, 2, etc.) or -1 if no path found
    """
    # Check if we've already calculated this player's Titled Speration
    if player_code in ecf_number_cache:
        debug_print(f"Using cached Titled Speration for {player_code}", 2)
        return ecf_number_cache[player_code]
    
    # Check if the player exists
    player_info = get_player_info(player_code)
    if not player_info:
        print(f"Player {player_code} not found.")
        return -1
    
    player_name = player_info.get('full_name', player_code)
    print(f"Calculating Titled Speration for {player_name}...")
    
    # BFS setup
    queue = deque([(player_code, 0, [player_name])])  # (player_code, distance, path)
    visited = {player_code}
    
    debug_print(f"Starting BFS search from {player_name}")
    
    while queue:
        current_code, distance, path = queue.popleft()
        
        current_info = player_info_cache.get(current_code, get_player_info(current_code))
        current_name = current_info.get('full_name', current_code) if current_info else current_code
        
        debug_print(f"Examining {current_name} at distance {distance}")
        
        # Stop if we've gone too deep
        if distance > max_depth:
            debug_print(f"Reached max depth ({max_depth}) for this branch", 2)
            continue
        
        # Get all opponents beaten by this player
        beaten_opponents = get_opponents_beaten_by(current_code)
        
        if not beaten_opponents:
            debug_print(f"{current_name} has not beaten any opponents")
        
        # Check each opponent
        for opponent_code in beaten_opponents:
            # Skip if already visited
            if opponent_code in visited:
                debug_print(f"  Already visited {opponent_code}, skipping", 2)
                continue
                
            # Mark as visited
            visited.add(opponent_code)
            
            # Get opponent info
            opponent_info = get_player_info(opponent_code)
            
            if opponent_info:
                opponent_name = opponent_info.get('full_name', opponent_code)
                new_path = path + [opponent_name]
                
                # Check if opponent is titled
                if is_titled_player(opponent_info):
                    path_str = " → ".join(new_path)
                    
                    # Handle the distance=0 case (player directly beat a titled player)
                    if distance == 0:
                        print(f"✓ Player directly beat a titled player: {player_name} → {opponent_name}")
                        ecf_number_cache[player_code] = 0
                        return 0
                    else:
                        print(f"✓ Found path to titled player ({distance+1} steps): {path_str}")
                        ecf_number_cache[player_code] = distance + 1
                        return distance + 1
                    
                # Add opponent to queue for next level
                queue.append((opponent_code, distance + 1, new_path))
                debug_print(f"  Added {opponent_name} to queue at distance {distance+1}", 2)
            else:
                debug_print(f"  Could not get info for opponent {opponent_code}", 2)
    
    # If no path found
    print(f"✗ No path found to any titled player within {max_depth} steps")
    ecf_number_cache[player_code] = -1
    return -1

def main():
    # Check if a player code was provided as a command-line argument
    if len(sys.argv) > 1:
        player_code = sys.argv[1]
    else:
        player_code = input("Enter the ECF player code (e.g., 120787): ")
    
    # Remove 'J' suffix if present (some ECF codes end with J)
    if player_code.upper().endswith('J'):
        player_code = player_code[:-1]
    
    print("=" * 60)
    print(f"Titled Speration Calculator - Debug Level {DEBUG_LEVEL}")
    print("=" * 60)
    
    try:
        time.sleep(0.5)
        
        start_time = time.time()
        ecf_number = calculate_ecf_number(player_code)
        end_time = time.time()
        
        player_info = get_player_info(player_code)
        player_name = player_info.get('full_name', player_code) if player_info else player_code
        
        print("\n" + "=" * 60)
        print("RESULTS:")
        if ecf_number == 0:
            print(f"✓ {player_name}'s Titled Speration is 0 (directly beat a titled player)")
        elif ecf_number > 0:
            print(f"✓ {player_name}'s Titled Speration is {ecf_number}")
        else:
            print(f"✗ No path found from {player_name} to a titled player")
        
        print(f"\nSearch completed in {end_time - start_time:.2f} seconds")
        print(f"API calls: {len(player_info_cache)} player lookups, {len(player_games_cache)} game lookups")
        print("=" * 60)
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    main()