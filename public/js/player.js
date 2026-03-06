const socket = io();
const params = new URLSearchParams(window.location.search);
const playerName = params.get('name') || 'Anonymous';

let myId = null;
let myState = null;   // { self, players, turnOrder, currentPlayerId, ... }
let gameSettings = null;
let boardW = 10, boardH = 10;
let visitedMap = {};  // key: "x,y" -> tile type
let pendingItemUse = null;

function getPlayerEmoji(index) {
    if (gameSettings && gameSettings.sprites && gameSettings.sprites.players) {
        return gameSettings.sprites.players[index % gameSettings.sprites.players.length];
    }
    return ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'][index % 6];
}

function getItemIcon(item) {
    if (gameSettings && gameSettings.sprites && gameSettings.sprites.items && item && item.id) {
        return gameSettings.sprites.items[item.id] || item.icon;
    }
    return item ? item.icon : '';
}
function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// ── DOM refs ──
const coinsDisplay = document.getElementById('coinsDisplay');
const turnIndicator = document.getElementById('turnIndicator');
const playerNameDisplay = document.getElementById('playerNameDisplay');
const moveHint = document.getElementById('moveHint');
const buffsDisplay = document.getElementById('buffsDisplay');
const inventoryList = document.getElementById('inventoryList');
const otherPlayers = document.getElementById('otherPlayers');
const playerFeed = document.getElementById('playerFeed');
const playerBoard = document.getElementById('playerBoard');

// ── Join ──
socket.emit('player:join', { name: playerName });

socket.on('player:joined', ({ playerId, name }) => {
    myId = playerId;
    playerNameDisplay.textContent = name;
    document.getElementById('lobbyWelcome').textContent = `Welcome, ${name}! ⏳ Waiting for host…`;
    show('lobbyScreen');
});

socket.on('host:state', (data) => {
    // Update lobby player list
    if (data.status === 'lobby') {
        gameSettings = data.settings;
        const ul = document.getElementById('lobbyPlayers');
        ul.innerHTML = Object.values(data.players).map((p, i) =>
            `<li>${getPlayerEmoji(i)} ${p.name}</li>`
        ).join('');
    }
});

// ── Game Started ──
socket.on('game:started', () => {
    show('gameScreen');
    addFeed('🎮 The game has started! Find the Exit to win!', 'system');
    if (window.SoundFX) window.SoundFX.start();
});

socket.on('game:state', (data) => {
    myState = data;
    gameSettings = data.settings;
    const self = data.self;
    if (!self) return;

    boardW = Math.max(boardW, self.x + 1);
    boardH = Math.max(boardH, self.y + 1);

    // Merge visited tiles
    (self.visitedTiles || []).forEach(t => { visitedMap[`${t.x},${t.y}`] = t.type; });
    // Figure out board size from visited tiles
    self.visitedTiles?.forEach(t => {
        boardW = Math.max(boardW, t.x + 1);
        boardH = Math.max(boardH, t.y + 1);
    });

    coinsDisplay.textContent = self.coins;
    renderFogBoard(self.x, self.y);
    updateTurnUI(data);
    renderBuffs(self.buffs);
    renderInventory(self.inventory);
    renderOtherPlayers(data.players, data.currentPlayerId, data.turnOrder);
});

socket.on('game:turn', ({ currentPlayerId, currentPlayerName }) => {
    const isMyTurn = currentPlayerId === myId;
    turnIndicator.textContent = isMyTurn ? '⭐ YOUR TURN!' : `${currentPlayerName}'s turn`;
    turnIndicator.className = 'topbar-turn' + (isMyTurn ? ' my-turn' : '');
    setMoveEnabled(isMyTurn);
    moveHint.textContent = isMyTurn ? 'Use arrow keys or d-pad to move!' : 'Wait for your turn…';
});

// ── Move Results ──
socket.on('player:move_result', ({ moveResults, updatedSelf }) => {
    if (!updatedSelf) return;
    // Merge newly visited tiles
    (updatedSelf.visitedTiles || []).forEach(t => {
        visitedMap[`${t.x},${t.y}`] = t.type;
        boardW = Math.max(boardW, t.x + 1);
        boardH = Math.max(boardH, t.y + 1);
    });

    // Render the board first so the player sees themselves move
    renderFogBoard(updatedSelf.x, updatedSelf.y);

    const rollEffects = moveResults.filter(r => r.effect && !!r.effect.roll).map(r => r.effect);

    function finalizeMove() {
        coinsDisplay.textContent = updatedSelf.coins;
        renderBuffs(updatedSelf.buffs);
        renderInventory(updatedSelf.inventory);
        processMoveEffects(moveResults);
    }

    if (rollEffects.length > 0) {
        showWheelSpin(rollEffects[0].roll, rollEffects[0], finalizeMove);
    } else {
        finalizeMove();
    }
});

function processMoveEffects(moveResults) {
    moveResults.forEach(r => {
        if (r.effect) {
            const type = r.effect.type === 'coins' || r.effect.type === 'jackpot' ? 'good'
                : r.effect.type === 'loss' || r.effect.type === 'catastrophe' ? 'bad'
                    : r.effect.type === 'teleport' ? 'bad'
                        : 'system';

            if (type === 'good' && window.SoundFX) window.SoundFX.coin();
            else if (type === 'bad' && window.SoundFX) window.SoundFX.hurt();

            addFeed(r.effect.message, type);
            if (r.effect.roll) addFeed(`🎲 You rolled a ${r.effect.roll}`, 'system');
            if (r.effect.itemReceived) {
                if (window.SoundFX) window.SoundFX.item();
                const icon = getItemIcon(r.effect.itemReceived);
                addFeed(`📦 Got item: ${icon} ${r.effect.itemReceived.name}`, 'good');
            }
            if (r.effect.expansion) addFeed('🗺️ The maze just got bigger!', 'system');
        }
        if (r.tile === 'exit') addFeed('🏁 You reached the EXIT!', 'system');
    });
}

// ── Forced move (bomb) ──
socket.on('player:forced_move', ({ x, y, message }) => {
    visitedMap[`${x},${y}`] = 'start'; // they're back at start
    addFeed(message, 'bad');
});

// ── Shop ──
socket.on('shop:open', ({ items }) => {
    const coins = myState?.self?.coins ?? 0;
    openShop(items, coins, (itemId) => {
        socket.emit('shop:buy', { itemId });
    });
    addFeed('🛒 You entered the Shop!', 'shop');
});

socket.on('shop:bought', ({ item, updatedSelf }) => {
    addFeed(`✅ Bought ${item.icon} ${item.name}!`, 'shop');
    if (updatedSelf) {
        coinsDisplay.textContent = updatedSelf.coins;
        renderInventory(updatedSelf.inventory);
    }
});

// ── Item use result ──
socket.on('item:result', ({ result, updatedSelf }) => {
    addFeed(result.message, result.type === 'shielded' ? 'good' : 'system');
    if (updatedSelf) {
        coinsDisplay.textContent = updatedSelf.coins;
        renderInventory(updatedSelf.inventory);
    }
    if (result.moved) {
        visitedMap[`${result.moved.x},${result.moved.y}`] = visitedMap[`${result.moved.x},${result.moved.y}`] || 'empty';
        renderFogBoard(result.moved.x, result.moved.y);
    }
});

// ── Game End ──
socket.on('game:end', ({ winnerId, winnerName, reason, finalScores }) => {
    show('endScreen');
    const isWinner = winnerId === myId;
    document.getElementById('endEmoji').textContent = isWinner ? '🏆' : '😔';
    document.getElementById('endWinner').textContent = isWinner ? 'You Win!' : `${winnerName} Wins!`;
    document.getElementById('endReason').textContent = reason;
    const ul = document.getElementById('finalScores');
    ul.innerHTML = finalScores.map((p, i) =>
        `<li><span>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`} ${p.name}${p.id === myId ? ' (You)' : ''}</span><span class="score-coins">💰 ${p.coins}</span></li>`
    ).join('');
});

socket.on('host:disconnected', ({ message }) => {
    addFeed('⚠️ ' + message, 'bad');
});

socket.on('error', ({ message }) => {
    addFeed('⚠️ ' + message, 'bad');
});

// ════════════════════════════════
// RENDERING
// ════════════════════════════════

function renderFogBoard(px, py) {
    // Dynamically calculate board size from all visited tiles
    let maxX = boardW - 1, maxY = boardH - 1;
    Object.keys(visitedMap).forEach(k => {
        const [x, y] = k.split(',').map(Number);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    });
    const cols = maxX + 1;
    const rows = maxY + 1;

    playerBoard.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    playerBoard.innerHTML = '';

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const div = document.createElement('div');
            const key = `${x},${y}`;
            const tileType = visitedMap[key];
            const isMe = x === px && y === py;

            if (tileType) {
                div.className = `tile tile-${tileType}`;
                const icons = gameSettings?.sprites?.tiles || { good: '★', bad: '✖', shop: '🛒', exit: '🚪', start: '◉', empty: '' };
                div.textContent = icons[tileType] || '';
            } else {
                div.className = 'tile tile-fog';
            }
            div.title = tileType ? `(${x},${y}) ${tileType}` : `(${x},${y}) unknown`;

            if (isMe) {
                div.textContent = '';
                const marker = document.createElement('span');
                marker.className = 'tile-player-marker';
                marker.textContent = '🧍';
                div.appendChild(marker);
            }
            playerBoard.appendChild(div);
        }
    }

    // Center map on player
    setTimeout(() => {
        const marker = playerBoard.querySelector('.tile-player-marker');
        if (marker) {
            marker.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
    }, 50);
}

function updateTurnUI(data) {
    const isMyTurn = data.currentPlayerId === myId;
    turnIndicator.textContent = isMyTurn
        ? '⭐ YOUR TURN!'
        : `${data.players[data.currentPlayerId]?.name || '?'}'s turn`;
    turnIndicator.className = 'topbar-turn' + (isMyTurn ? ' my-turn' : '');
    setMoveEnabled(isMyTurn);
    moveHint.textContent = isMyTurn ? 'Use arrow keys or d-pad!' : 'Wait for your turn…';
}

function renderBuffs(buffs) {
    if (!buffs) { buffsDisplay.textContent = 'No active buffs'; return; }
    const active = Object.entries(buffs).filter(([k, v]) => v > 0);
    if (active.length === 0) { buffsDisplay.textContent = 'No active buffs'; return; }
    const BUFF_LABELS = { sneakers: '👟 Sneakers', goldRush: '⚡ Gold Rush', shield: '🛡️ Shield', torch: '🔦 Torch' };
    buffsDisplay.innerHTML = active.map(([k, v]) =>
        `<span class="buff-tag">${BUFF_LABELS[k] || k} ×${v}</span>`
    ).join('');
}

function renderInventory(inventory) {
    if (!inventory || inventory.length === 0) {
        inventoryList.innerHTML = '<div class="empty-inv">No items yet</div>';
        return;
    }
    inventoryList.innerHTML = '';
    inventory.forEach(item => {
        const div = document.createElement('div');
        div.className = 'inv-item';
        div.innerHTML = `
      <div class="inv-item-icon">${getItemIcon(item)}</div>
      <div class="inv-item-info">
        <div class="inv-item-name">${item.name}</div>
        <div class="inv-item-desc">${item.description}</div>
      </div>
    `;
        div.addEventListener('click', () => useItem(item));
        inventoryList.appendChild(div);
    });
}

function renderOtherPlayers(players, currentId, turnOrder) {
    otherPlayers.innerHTML = '';
    (turnOrder || []).forEach((id, i) => {
        const p = players[id];
        if (!p) return;
        const div = document.createElement('div');
        div.className = 'other-player' + (id === currentId ? ' active' : '');
        div.innerHTML = `<span>${getPlayerEmoji(i)} ${p.name}${id === myId ? ' (You)' : ''}${id === currentId ? ' ◀' : ''}</span><span class="other-coins">💰 ${p.coins}</span>`;
        otherPlayers.appendChild(div);
    });
}

function addFeed(message, type = 'info') {
    const div = document.createElement('div');
    div.className = `feed-item ${type}`;
    div.textContent = message;
    playerFeed.prepend(div);
    // Limit feed items
    while (playerFeed.children.length > 20) playerFeed.lastChild.remove();
}

// ════════════════════════════════
// MOVEMENT
// ════════════════════════════════

function setMoveEnabled(enabled) {
    document.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
        btn.disabled = !enabled;
    });
}
setMoveEnabled(false);

function move(dir) {
    if (!myState || myState.currentPlayerId !== myId) return;
    if (window.SoundFX) window.SoundFX.move();
    socket.emit('player:move', { direction: dir });
}

document.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => move(btn.dataset.dir));
});

document.addEventListener('keydown', (e) => {
    const map = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        w: 'up', s: 'down', a: 'left', d: 'right'
    };
    if (map[e.key]) { e.preventDefault(); move(map[e.key]); }
});

// ════════════════════════════════
// ITEM USE
// ════════════════════════════════

function useItem(item) {
    if (!myState || myState.currentPlayerId !== myId) {
        addFeed("⚠️ You can only use items on your turn.", 'bad');
        return;
    }

    if (item.id === 'bomb') {
        // Need to pick a target player
        showItemModal(
            `💣 Bomb — Choose a target`,
            buildPlayerTargetUI(),
            (targetId) => socket.emit('item:use', { itemId: item.id, targetId })
        );

    } else if (item.id === 'teleport') {
        // Need to pick a visited tile
        showItemModal(
            `💎 Teleport — Choose a visited tile`,
            buildTilePickerUI(),
            (coords) => socket.emit('item:use', { itemId: item.id, targetCoords: coords })
        );

    } else {
        // Just use it
        socket.emit('item:use', { itemId: item.id });
    }
}

function buildPlayerTargetUI() {
    if (!myState) return '<p>No players available.</p>';
    const others = Object.values(myState.players).filter(p => p.id !== myId);
    if (others.length === 0) return '<p>No other players.</p>';
    return `<div style="display:flex;flex-direction:column;gap:0.5rem">` +
        others.map(p =>
            `<button class="btn btn-secondary target-btn" data-target="${p.id}">${p.name}</button>`
        ).join('') + `</div>`;
}

function buildTilePickerUI() {
    const tiles = Object.entries(visitedMap).filter(([k, v]) => v !== undefined);
    if (tiles.length === 0) return '<p>No visited tiles.</p>';
    return `<select id="tilePickerSelect" style="width:100%;padding:0.5rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;">` +
        tiles.map(([k, v]) => {
            const [x, y] = k.split(',');
            return `<option value="${k}">(${x},${y}) — ${v}</option>`;
        }).join('') + `</select>`;
}

function showItemModal(title, bodyHTML, onConfirm) {
    const modal = document.getElementById('itemModal');
    document.getElementById('itemModalTitle').textContent = title;
    document.getElementById('itemModalContent').innerHTML = bodyHTML;
    modal.classList.remove('hidden');

    const confirmBtn = document.getElementById('itemModalConfirm');
    const cancelBtn = document.getElementById('itemModalCancel');

    function close() { modal.classList.add('hidden'); }

    // Wire target buttons if present
    const targetBtns = modal.querySelectorAll('.target-btn');
    if (targetBtns.length > 0) {
        // Confirm fires on button click directly
        targetBtns.forEach(btn => {
            btn.addEventListener('click', () => { onConfirm(btn.dataset.target); close(); });
        });
        confirmBtn.style.display = 'none';
    } else {
        confirmBtn.style.display = '';
        const newConfirm = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
        newConfirm.addEventListener('click', () => {
            const sel = document.getElementById('tilePickerSelect');
            if (sel) {
                const [x, y] = sel.value.split(',').map(Number);
                onConfirm({ x, y });
            }
            close();
        });
    }

    const newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    newCancel.addEventListener('click', close);
}

function showWheelSpin(targetNumber, effectData, onComplete) {
    const modal = document.getElementById('wheelModal');
    const wheel = document.getElementById('spinWheel');
    const resultText = document.getElementById('wheelResult');
    const closeBtn = document.getElementById('wheelClose');

    wheel.innerHTML = '';

    let gradientParts = [];
    for (let i = 1; i <= 20; i++) {
        const startColor = (i % 2 === 0) ? '#1c2040' : '#2a2f52';
        gradientParts.push(`${startColor} ${(i - 1) * 18}deg ${i * 18}deg`);

        const num = document.createElement('div');
        num.className = 'wheel-num';
        num.textContent = i;
        const angle = (i - 1) * 18 + 9;
        const rad = angle * Math.PI / 180;
        const radius = 110;
        num.style.transform = `translate(${Math.sin(rad) * radius}px, ${-Math.cos(rad) * radius}px) rotate(${angle}deg)`;
        wheel.appendChild(num);
    }
    wheel.style.background = `conic-gradient(${gradientParts.join(', ')})`;

    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    resultText.textContent = 'Spinning...';
    resultText.className = 'wheel-result';
    closeBtn.classList.add('hidden');
    modal.classList.remove('hidden');

    void wheel.offsetWidth;

    const targetAngle = (targetNumber - 1) * 18 + 9;
    const finalRot = (360 * 6) - targetAngle; // 6 extra spins for +1.5s duration

    wheel.style.transition = 'transform 4.6s cubic-bezier(0.2, 0.8, 0.1, 1)';
    wheel.style.transform = `rotate(${finalRot}deg)`;

    // Play tick sounds as it spins
    let tickCount = 0;
    const tickInterval = setInterval(() => {
        if (window.SoundFX) window.SoundFX.tick();
        tickCount++;
        if (tickCount > 25) clearInterval(tickInterval);
    }, 150);

    setTimeout(() => {
        clearInterval(tickInterval);
        resultText.textContent = `🎲 Rolled ${targetNumber}! ${effectData.message || ''}`;
        resultText.classList.add('highlight');
        closeBtn.classList.remove('hidden');

        closeBtn.onclick = () => {
            modal.classList.add('hidden');
            if (onComplete) onComplete();
        };
    }, 4600);
}

socket.on('game:settings_updated', ({ settings }) => {
    gameSettings = settings;
    if (myState && myState.self) {
        renderFogBoard(myState.self.x, myState.self.y);
        renderOtherPlayers(myState.players, myState.currentPlayerId, myState.turnOrder);
    }
});
