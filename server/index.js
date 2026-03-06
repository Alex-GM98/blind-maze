const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const {
    TILE_TYPES, placePlayerStart, applyGoodTile, applyBadTile,
    expandBoard, canMove, getNextPos, createPlayer, createGameState,
    addLog, getCurrentPlayer, advanceTurn, tickBuffs, rollD20
} = require('./game');
const { ITEMS } = require('./items');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, '..', 'public')));

// Single game room (one game at a time)
let gameState = null;
let hostSocketId = null;

// Helper: give a random item from the shop to a player
function giveRandomItem(player) {
    const item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
    player.inventory.push({ id: item.id, name: item.name, icon: item.icon, description: item.description });
    return item;
}

// Helper: build a safe player state to send (strips server-side only data)
function safePlayer(p) {
    return {
        id: p.id, name: p.name, x: p.x, y: p.y,
        startX: p.startX, startY: p.startY,
        coins: p.coins, inventory: p.inventory,
        buffs: p.buffs, skipTurn: p.skipTurn, alive: p.alive,
        visitedTiles: p.visitedTiles
    };
}

// Full game state for host (everything)
function hostGameState() {
    if (!gameState) return null;
    return {
        status: gameState.status,
        board: gameState.board,
        players: Object.fromEntries(Object.entries(gameState.players).map(([id, p]) => [id, safePlayer(p)])),
        turnOrder: gameState.turnOrder,
        currentTurnIndex: gameState.currentTurnIndex,
        round: gameState.round,
        settings: gameState.settings,
        log: gameState.log.slice(0, 30)
    };
}

// Player-specific state (fog of war - only THEIR visited tiles)
function playerGameState(playerId) {
    if (!gameState || !gameState.players[playerId]) return null;
    const player = gameState.players[playerId];
    return {
        status: gameState.status,
        self: safePlayer(player),
        players: Object.fromEntries(
            Object.entries(gameState.players).map(([id, p]) => [id, { id: p.id, name: p.name, coins: p.coins }])
        ),
        turnOrder: gameState.turnOrder,
        currentTurnIndex: gameState.currentTurnIndex,
        currentPlayerId: gameState.turnOrder[gameState.currentTurnIndex],
        round: gameState.round
    };
}

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    // ─── HOST ───────────────────────────────────────────────────────────────────

    socket.on('host:connect', ({ settings }) => {
        hostSocketId = socket.id;
        const width = Math.max(8, Math.min(16, settings?.width || 10));
        const height = Math.max(8, Math.min(16, settings?.height || 10));
        gameState = createGameState(socket.id, { width, height });
        socket.join('host');
        socket.emit('host:connected', { settings: gameState.settings });
        console.log('Host connected, board:', width, 'x', height);
    });

    socket.on('host:start_game', () => {
        if (!gameState || socket.id !== hostSocketId) return;
        if (gameState.turnOrder.length < 2) {
            socket.emit('error', { message: 'Need at least 2 players to start.' });
            return;
        }
        gameState.status = 'playing';
        addLog(gameState, '🎮 The game has started!', 'system');
        io.emit('game:started', { hostState: hostGameState() });
        // Send each player their personal state
        for (const [pid, player] of Object.entries(gameState.players)) {
            io.to(pid).emit('game:state', playerGameState(pid));
        }
        // Tell host full state
        io.to('host').emit('host:state', hostGameState());
        broadcastTurn();
    });

    socket.on('host:end_game', ({ winnerId }) => {
        if (!gameState || socket.id !== hostSocketId) return;
        endGame(winnerId || null, 'Host ended the game.');
    });

    socket.on('host:refresh_shop', () => {
        // Host can refresh the shop items once per game (handled client-side, no server state needed)
        socket.emit('host:shop_refreshed');
    });

    socket.on('host:update_sprites', ({ sprites }) => {
        if (!gameState || socket.id !== hostSocketId) return;
        gameState.settings.sprites = sprites;
        // Broadcast new state so all clients update visually immediately
        io.to('host').emit('host:state', hostGameState());
        for (const pid of Object.keys(gameState.players)) {
            io.to(pid).emit('game:settings_updated', { settings: gameState.settings });
        }
    });

    socket.on('host:edit_tile', ({ x, y, type }) => {
        if (!gameState || socket.id !== hostSocketId) return;
        if (x >= 0 && x < gameState.board.width && y >= 0 && y < gameState.board.height) {
            gameState.board.grid[y][x].type = type;
            io.to('host').emit('host:state', hostGameState());
            // We do not broadcast full state to players on tile edit; fog of war hides it anyway
        }
    });

    // ─── PLAYER ─────────────────────────────────────────────────────────────────

    socket.on('player:join', ({ name }) => {
        if (!gameState || gameState.status !== 'lobby') {
            socket.emit('error', { message: 'No game lobby open or game already started.' });
            return;
        }
        if (gameState.turnOrder.length >= 6) {
            socket.emit('error', { message: 'Game is full (max 6 players).' });
            return;
        }
        const cleanName = String(name).slice(0, 20).trim() || 'Anonymous';
        const playerIndex = gameState.turnOrder.length;
        const pos = placePlayerStart(gameState.board, playerIndex, 6);
        const player = createPlayer(socket.id, cleanName, pos.x, pos.y);
        gameState.players[socket.id] = player;
        gameState.turnOrder.push(socket.id);
        addLog(gameState, `👤 ${cleanName} joined the game!`, 'join');

        socket.emit('player:joined', { playerId: socket.id, name: cleanName });
        io.to('host').emit('host:state', hostGameState());
        console.log(`Player joined: ${cleanName} at (${pos.x},${pos.y})`);
    });

    socket.on('player:move', ({ direction }) => {
        if (!gameState || gameState.status !== 'playing') return;
        const currentPlayer = getCurrentPlayer(gameState);
        if (!currentPlayer || currentPlayer.id !== socket.id) {
            socket.emit('error', { message: "It's not your turn!" });
            return;
        }
        if (!['up', 'down', 'left', 'right'].includes(direction)) return;

        const steps = (currentPlayer.buffs?.sneakers > 0) ? 2 : 1;
        let moveResults = [];

        for (let step = 0; step < steps; step++) {
            if (!canMove(currentPlayer.x, currentPlayer.y, direction, gameState.board)) {
                if (step === 0) {
                    socket.emit('error', { message: "You can't move that way — there's a wall!" });
                    return;
                }
                break; // Can't take 2nd step, stop here
            }
            const next = getNextPos(currentPlayer.x, currentPlayer.y, direction);
            currentPlayer.x = next.x;
            currentPlayer.y = next.y;

            const tile = gameState.board.grid[currentPlayer.y][currentPlayer.x];
            let tileResult = null;

            // Handle tile effect
            if (tile.type === TILE_TYPES.GOOD) {
                const roll = rollD20();
                tileResult = applyGoodTile(currentPlayer, gameState.board, roll);
                tileResult.roll = roll;
                if (tileResult.giveRandomItem) {
                    const item = giveRandomItem(currentPlayer);
                    tileResult.itemReceived = { id: item.id, name: item.name, icon: item.icon };
                }
                if (tileResult.expandBoard) {
                    const expansion = expandBoard(gameState.board);
                    tileResult.expansion = expansion;
                    io.to('host').emit('host:state', hostGameState());
                }
                addLog(gameState, `[${currentPlayer.name}] ${tileResult.message} (rolled ${roll})`, 'good');
            } else if (tile.type === TILE_TYPES.BAD) {
                const roll = rollD20();
                tileResult = applyBadTile(currentPlayer, gameState.board, roll);
                tileResult.roll = roll;
                addLog(gameState, `[${currentPlayer.name}] ${tileResult.message} (rolled ${roll})`, 'bad');
            } else if (tile.type === TILE_TYPES.SHOP) {
                // Shop items sent to player
                const shopItems = ITEMS.map(i => ({ id: i.id, name: i.name, cost: i.cost, icon: i.icon, description: i.description }));
                socket.emit('shop:open', { items: shopItems });
                addLog(gameState, `[${currentPlayer.name}] visited the Shop.`, 'shop');
            } else if (tile.type === TILE_TYPES.EXIT) {
                addLog(gameState, `🏁 ${currentPlayer.name} reached the EXIT and WINS!`, 'system');
                endGame(currentPlayer.id, `${currentPlayer.name} reached the Exit!`);
                return;
            }

            // Track visited tile on player's personal map
            if (!currentPlayer.visitedTiles.find(t => t.x === currentPlayer.x && t.y === currentPlayer.y)) {
                currentPlayer.visitedTiles.push({ x: currentPlayer.x, y: currentPlayer.y, type: tile.type });
            }
            moveResults.push({ x: currentPlayer.x, y: currentPlayer.y, tile: tile.type, effect: tileResult });

            // Handle teleport (stop further movement)
            if (tileResult?.type === 'teleport') {
                if (!currentPlayer.visitedTiles.find(t => t.x === currentPlayer.x && t.y === currentPlayer.y)) {
                    currentPlayer.visitedTiles.push({ x: currentPlayer.x, y: currentPlayer.y, type: gameState.board.grid[currentPlayer.y][currentPlayer.x].type });
                }
                break;
            }
        }

        tickBuffs(currentPlayer);
        advanceTurn(gameState);

        // Send move result to moving player
        socket.emit('player:move_result', { moveResults, updatedSelf: safePlayer(currentPlayer) });
        // Update all players' states
        for (const pid of gameState.turnOrder) {
            io.to(pid).emit('game:state', playerGameState(pid));
        }
        // Update host
        io.to('host').emit('host:state', hostGameState());
        broadcastTurn();
    });

    socket.on('shop:buy', ({ itemId }) => {
        if (!gameState || gameState.status !== 'playing') return;
        const player = gameState.players[socket.id];
        if (!player) return;
        const item = ITEMS.find(i => i.id === itemId);
        if (!item) { socket.emit('error', { message: 'Unknown item.' }); return; }
        if (player.coins < item.cost) {
            socket.emit('error', { message: `Not enough coins! You need ${item.cost} but have ${player.coins}.` });
            return;
        }
        player.coins -= item.cost;
        player.inventory.push({ id: item.id, name: item.name, icon: item.icon, description: item.description, passive: item.passive, requiresTarget: item.requiresTarget, requiresVisited: item.requiresVisited });
        addLog(gameState, `[${player.name}] bought ${item.icon} ${item.name} for ${item.cost} coins.`, 'shop');
        socket.emit('shop:bought', { item: { id: item.id, name: item.name, icon: item.icon }, updatedSelf: safePlayer(player) });
        io.to('host').emit('host:state', hostGameState());
    });

    socket.on('item:use', ({ itemId, targetId, targetCoords }) => {
        if (!gameState || gameState.status !== 'playing') return;
        const player = gameState.players[socket.id];
        if (!player) return;
        const invIdx = player.inventory.findIndex(i => i.id === itemId);
        if (invIdx === -1) { socket.emit('error', { message: 'You don\'t have that item.' }); return; }

        const itemDef = ITEMS.find(i => i.id === itemId);
        if (!itemDef) return;

        let result;
        if (itemDef.requiresTarget) {
            result = itemDef.applyEffect(player, gameState, targetId);
        } else if (itemDef.requiresVisited) {
            result = itemDef.applyEffect(player, gameState, targetCoords);
        } else {
            result = itemDef.applyEffect(player, gameState);
        }

        // Remove consumed item (passive buffs remain until expired)
        if (!itemDef.passive) {
            player.inventory.splice(invIdx, 1);
        } else {
            // Passive items apply buff and are consumed from inventory
            player.inventory.splice(invIdx, 1);
        }

        addLog(gameState, `[${player.name}] used ${itemDef.icon} ${itemDef.name}. ${result.message}`, 'item');
        socket.emit('item:result', { result, updatedSelf: safePlayer(player) });

        if (result.revealedTiles) {
            // Merge into player's visited tiles
            for (const t of result.revealedTiles) {
                if (!player.visitedTiles.find(v => v.x === t.x && v.y === t.y)) {
                    player.visitedTiles.push(t);
                }
            }
            socket.emit('game:state', playerGameState(socket.id));
        }
        if (result.targetMoved) {
            const target = gameState.players[result.targetMoved.playerId];
            if (target) {
                io.to(result.targetMoved.playerId).emit('player:forced_move', { x: result.targetMoved.x, y: result.targetMoved.y, message: result.targetMessage });
                io.to(result.targetMoved.playerId).emit('game:state', playerGameState(result.targetMoved.playerId));
            }
        }
        io.to('host').emit('host:state', hostGameState());
        socket.emit('game:state', playerGameState(socket.id));
    });

    socket.on('disconnect', () => {
        if (gameState && gameState.players[socket.id]) {
            const player = gameState.players[socket.id];
            addLog(gameState, `⚠️ ${player.name} disconnected.`, 'system');
            gameState.turnOrder = gameState.turnOrder.filter(id => id !== socket.id);
            delete gameState.players[socket.id];
            io.to('host').emit('host:state', hostGameState());
        }
        if (socket.id === hostSocketId) {
            hostSocketId = null;
            gameState = null;
            io.emit('host:disconnected', { message: 'The host has disconnected. The game has ended.' });
        }
    });
});

function broadcastTurn() {
    if (!gameState || gameState.status !== 'playing') return;
    const current = getCurrentPlayer(gameState);
    if (!current) return;
    io.emit('game:turn', { currentPlayerId: current.id, currentPlayerName: current.name, round: gameState.round });
}

function endGame(winnerId, reason) {
    if (!gameState) return;
    gameState.status = 'finished';
    const winner = winnerId ? gameState.players[winnerId] : null;
    io.emit('game:end', {
        winnerId,
        winnerName: winner?.name || 'Nobody',
        reason,
        finalScores: Object.values(gameState.players).map(p => ({ id: p.id, name: p.name, coins: p.coins })).sort((a, b) => b.coins - a.coins)
    });
}

server.listen(PORT, () => {
    console.log(`🎮 Blind Maze server running on http://localhost:${PORT}`);
});
