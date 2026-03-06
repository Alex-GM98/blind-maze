const TILE_TYPES = {
    EMPTY: 'empty', // Used for paths
    GOOD: 'good',
    BAD: 'bad',
    SHOP: 'shop',
    START: 'start',
    EXIT: 'exit',
    WALL: 'wall' // Unwalkable void
};

// Weighted tile distribution for random placement
const TILE_WEIGHTS = [
    { type: TILE_TYPES.GOOD, weight: 35 },
    { type: TILE_TYPES.BAD, weight: 30 },
    { type: TILE_TYPES.SHOP, weight: 15 },
    { type: TILE_TYPES.EXIT, weight: 10 }
];

function weightedRandom(weights) {
    const total = weights.reduce((s, w) => s + w.weight, 0);
    let r = Math.random() * total;
    for (const w of weights) {
        r -= w.weight;
        if (r <= 0) return w.type;
    }
    return weights[weights.length - 1].type;
}

function rollD20() {
    return Math.floor(Math.random() * 20) + 1;
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateBoard(width, height) {
    const grid = [];
    for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) {
            row.push({ type: TILE_TYPES.WALL, x, y });
        }
        grid.push(row);
    }

    const startX = Math.floor(width / 2);
    const startY = Math.floor(height / 2);
    grid[startY][startX] = { type: TILE_TYPES.START, x: startX, y: startY };

    let paths = [[startX, startY]];
    const maxRooms = Math.floor((width * height) / 5);
    let roomsPlaced = 0;

    for (let it = 0; it < maxRooms * 5; it++) {
        if (paths.length === 0) break;

        let pidx = Math.floor(Math.random() * paths.length);
        let pathStart = paths[pidx];

        let dir = Math.floor(Math.random() * 4);
        let dx = [0, 1, 0, -1][dir];
        let dy = [-1, 0, 1, 0][dir];

        let pathLen = randomInt(2, 4);
        let nx = pathStart[0];
        let ny = pathStart[1];

        let canBuild = true;
        for (let j = 1; j <= pathLen; j++) {
            let tx = nx + dx * j;
            let ty = ny + dy * j;
            if (tx < 1 || tx >= width - 1 || ty < 1 || ty >= height - 1) {
                canBuild = false;
                break;
            }
            if (grid[ty][tx].type !== TILE_TYPES.WALL) {
                canBuild = false;
                break;
            }
        }

        if (canBuild) {
            for (let j = 1; j <= pathLen; j++) {
                nx += dx;
                ny += dy;
                if (j === pathLen) {
                    grid[ny][nx].type = weightedRandom(TILE_WEIGHTS);
                    roomsPlaced++;
                    paths.push([nx, ny]);
                } else {
                    grid[ny][nx].type = TILE_TYPES.EMPTY;
                    paths.push([nx, ny]);
                }
            }
        }
    }

    // Ensure at least one exit
    if (!grid.flat().some(t => t.type === TILE_TYPES.EXIT)) {
        let rooms = grid.flat().filter(t => t.type !== TILE_TYPES.WALL && t.type !== TILE_TYPES.EMPTY && t.type !== TILE_TYPES.START);
        if (rooms.length > 0) {
            rooms[Math.floor(Math.random() * rooms.length)].type = TILE_TYPES.EXIT;
        } else {
            let emptyTiles = grid.flat().filter(t => t.type === TILE_TYPES.EMPTY);
            if (emptyTiles.length > 0) {
                emptyTiles[Math.floor(Math.random() * emptyTiles.length)].type = TILE_TYPES.EXIT;
            }
        }
    }

    return { grid, width, height };
}

function placePlayerStart(board, playerIndex, totalPlayers) {
    // All players start at the exact same central location
    const { width, height } = board;
    const startX = Math.floor(width / 2);
    const startY = Math.floor(height / 2);

    // Ensure the center tile is set as the START tile
    board.grid[startY][startX] = { type: TILE_TYPES.START, x: startX, y: startY };

    return { x: startX, y: startY };
}

// Apply good tile effect (d20)
function applyGoodTile(player, board, roll) {
    if (roll >= 1 && roll <= 5) {
        const coins = randomInt(5, 15);
        const actual = player.buffs?.goldRush ? coins * 2 : coins;
        player.coins += actual;
        return { type: 'coins', amount: actual, message: `🟡 Small Gold! You found ${actual} coins.` };
    } else if (roll >= 6 && roll <= 10) {
        const coins = randomInt(20, 35);
        const actual = player.buffs?.goldRush ? coins * 2 : coins;
        player.coins += actual;
        return { type: 'coins', amount: actual, message: `💰 Medium Gold! You found ${actual} coins.` };
    } else if (roll >= 11 && roll <= 15) {
        const coins = randomInt(40, 60);
        const actual = player.buffs?.goldRush ? coins * 2 : coins;
        player.coins += actual;
        return { type: 'coins', amount: actual, message: `💎 Large Gold! You found ${actual} coins.` };
    } else if (roll >= 16 && roll <= 18) {
        return { type: 'item', message: `📦 You found a random item in a crate!`, giveRandomItem: true };
    } else if (roll === 19) {
        return { type: 'expansion', message: `🗺️ The maze expanded! A new section has appeared.`, expandBoard: true };
    } else { // 20
        const coins = 80;
        const actual = player.buffs?.goldRush ? coins * 2 : coins;
        player.coins += actual;
        return { type: 'jackpot', amount: actual, message: `🎰 JACKPOT! You found ${actual} coins AND a free item!`, giveRandomItem: true };
    }
}

// Apply bad tile effect (d20)
function applyBadTile(player, board, roll) {
    if (player.buffs?.shield) {
        player.buffs.shield = 0;
        return { type: 'shielded', message: `🛡️ Your Shield blocked the bad tile effect!` };
    }
    if (roll >= 1 && roll <= 5) {
        const loss = randomInt(5, 10);
        player.coins = Math.max(0, player.coins - loss);
        return { type: 'loss', amount: -loss, message: `💸 Small Loss! You lost ${loss} coins.` };
    } else if (roll >= 6 && roll <= 10) {
        const loss = randomInt(15, 25);
        player.coins = Math.max(0, player.coins - loss);
        return { type: 'loss', amount: -loss, message: `💸 Medium Loss! You lost ${loss} coins.` };
    } else if (roll >= 11 && roll <= 13) {
        player.skipTurn = true;
        return { type: 'skip', message: `⏸️ You tripped! You'll skip your next turn.` };
    } else if (roll >= 14 && roll <= 16) {
        if (player.inventory.length > 0) {
            const idx = randomInt(0, player.inventory.length - 1);
            const stolen = player.inventory.splice(idx, 1)[0];
            return { type: 'theft', message: `🕸️ A trap stole your ${stolen.name}!` };
        } else {
            player.coins = Math.max(0, player.coins - 5);
            return { type: 'loss', amount: -5, message: `🕸️ A trap! You had no items, so you lost 5 coins instead.` };
        }
    } else if (roll >= 17 && roll <= 19) {
        // Teleport to random tile
        const x = randomInt(0, board.width - 1);
        const y = randomInt(0, board.height - 1);
        player.x = x;
        player.y = y;
        return { type: 'teleport', x, y, message: `🌀 A vortex sucked you to an unknown location!`, moved: { x, y } };
    } else { // 20 - Catastrophe
        const loss = 40;
        player.coins = Math.max(0, player.coins - loss);
        player.skipTurn = true;
        return { type: 'catastrophe', amount: -loss, message: `💀 CATASTROPHE! You lost 40 coins AND you skip your next turn!` };
    }
}

// Expand the board by adding a row or column
function expandBoard(board) {
    const addRow = Math.random() > 0.5;
    if (addRow) {
        const newRow = [];
        for (let x = 0; x < board.width; x++) {
            newRow.push({ type: weightedRandom(TILE_WEIGHTS.filter(t => t.type !== TILE_TYPES.EXIT && t.type !== TILE_TYPES.START)), x, y: board.height });
        }
        board.grid.push(newRow);
        board.height += 1;
        return { direction: 'row', index: board.height - 1 };
    } else {
        for (let y = 0; y < board.height; y++) {
            board.grid[y].push({ type: weightedRandom(TILE_WEIGHTS.filter(t => t.type !== TILE_TYPES.EXIT && t.type !== TILE_TYPES.START)), x: board.width, y });
        }
        board.width += 1;
        return { direction: 'col', index: board.width - 1 };
    }
}

// Check if player can move in a direction
function canMove(x, y, direction, board) {
    const next = getNextPos(x, y, direction);
    if (next.x >= 0 && next.y >= 0 && next.x < board.width && next.y < board.height) {
        return board.grid[next.y][next.x].type !== TILE_TYPES.WALL;
    }
    return false;
}

function getNextPos(x, y, direction) {
    const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const [dx, dy] = dirs[direction] || [0, 0];
    return { x: x + dx, y: y + dy };
}

function createPlayer(id, name, x, y) {
    return {
        id, name, x, y,
        startX: x, startY: y,
        coins: 30,
        inventory: [],
        visitedTiles: [{ x, y, type: TILE_TYPES.START }],
        buffs: {},
        skipTurn: false,
        alive: true
    };
}

function createGameState(hostId, settings) {
    const { width, height } = settings;
    const board = generateBoard(width, height);

    // Set default sprites if not provided
    settings.sprites = settings.sprites || {
        tiles: {
            good: '★',
            bad: '✖',
            shop: '🛒',
            exit: '🚪',
            start: '◉',
            empty: ''
        },
        players: ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'],
        items: {
            compass: '🧭',
            map_fragment: '🗺️',
            sneakers: '👟',
            shield: '🛡️',
            bomb: '💣',
            torch: '🔦',
            teleport: '💎',
            gold_rush: '⚡'
        }
    };

    return {
        hostId,
        status: 'lobby',   // lobby | playing | finished
        board,
        players: {},
        turnOrder: [],
        currentTurnIndex: 0,
        round: 0,
        settings,
        log: []
    };
}

function addLog(gameState, message, type = 'info') {
    gameState.log.unshift({ message, type, ts: Date.now() });
    if (gameState.log.length > 100) gameState.log.pop();
}

function getCurrentPlayer(gameState) {
    const id = gameState.turnOrder[gameState.currentTurnIndex];
    return gameState.players[id] || null;
}

function advanceTurn(gameState) {
    gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
    // Skip players who have skipTurn set
    let safetyCounter = 0;
    while (gameState.players[gameState.turnOrder[gameState.currentTurnIndex]]?.skipTurn) {
        gameState.players[gameState.turnOrder[gameState.currentTurnIndex]].skipTurn = false;
        gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
        if (++safetyCounter > gameState.turnOrder.length) break;
    }
    gameState.round++;
}

// Tick buffs for a player after their turn
function tickBuffs(player) {
    if (!player.buffs) return;
    if (player.buffs.sneakers > 0) player.buffs.sneakers--;
    if (player.buffs.goldRush > 0) player.buffs.goldRush--;
    if (player.buffs.torch > 0) player.buffs.torch = 0; // one-time use per activation
}

module.exports = {
    TILE_TYPES, generateBoard, placePlayerStart,
    applyGoodTile, applyBadTile, expandBoard,
    canMove, getNextPos, createPlayer, createGameState,
    addLog, getCurrentPlayer, advanceTurn, tickBuffs, rollD20
};
