const socket = io();

const params = new URLSearchParams(window.location.search);
const w = parseInt(params.get('w')) || 10;
const h = parseInt(params.get('h')) || 10;

let state = null;

function getPlayerEmoji(index) {
    if (state && state.settings && state.settings.sprites && state.settings.sprites.players) {
        return state.settings.sprites.players[index % state.settings.sprites.players.length];
    }
    return ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'][index % 6];
}

// ── Screens ──
function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// ── Socket Connection ──
socket.emit('host:connect', { settings: { width: w, height: h } });

socket.on('host:connected', ({ settings }) => {
    document.getElementById('shareUrl').textContent = window.location.origin;
    document.getElementById('lobbySize').textContent = `${settings.width} × ${settings.height}`;
    show('lobbyScreen');
});

socket.on('host:state', (data) => {
    state = data;
    if (data.status === 'lobby') updateLobby(data);
    else if (data.status === 'playing') updateGame(data);
});

socket.on('game:started', ({ hostState }) => {
    state = hostState;
    show('gameScreen');
    renderBoard(hostState.board, hostState.players);
    renderPlayerCards(hostState.players, hostState.turnOrder, hostState.currentTurnIndex);
    renderLog(hostState.log);
});

socket.on('game:turn', ({ currentPlayerId, currentPlayerName, round }) => {
    document.getElementById('roundLabel').textContent = `Round ${round}`;
    // Player cards updated in host:state
});

socket.on('game:settings_updated', ({ settings }) => {
    if (state) state.settings = settings;
    if (!document.getElementById('gameScreen').classList.contains('hidden')) {
        renderBoard(state.board, state.players);
        renderPlayerCards(state.players, state.turnOrder, state.currentTurnIndex);
    } else if (!document.getElementById('lobbyScreen').classList.contains('hidden')) {
        updateLobby(state);
    }
});

socket.on('game:end', ({ winnerId, winnerName, reason, finalScores }) => {
    show('endScreen');
    document.getElementById('endWinner').textContent = `🏆 ${winnerName} Wins!`;
    document.getElementById('endReason').textContent = reason;
    const ul = document.getElementById('finalScores');
    ul.innerHTML = finalScores.map((p, i) =>
        `<li><span>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`} ${p.name}</span><span class="score-coins">💰 ${p.coins}</span></li>`
    ).join('');
});

socket.on('error', ({ message }) => alert('Error: ' + message));

// ── Lobby ──
let lastPlayerCount = 0;
function updateLobby(data) {
    const players = Object.values(data.players);
    if (players.length > lastPlayerCount) {
        if (window.SoundFX) window.SoundFX.join();
    }
    lastPlayerCount = players.length;

    document.getElementById('playerCount').textContent = players.length;
    const ul = document.getElementById('lobbyPlayers');
    ul.innerHTML = players.map((p, i) => `<li>${getPlayerEmoji(i)} ${p.name} — 💰 ${p.coins} coins</li>`).join('');
    document.getElementById('startBtn').disabled = players.length < 2;
}

document.getElementById('startBtn').addEventListener('click', () => {
    socket.emit('host:start_game');
});

document.getElementById('endGameBtn').addEventListener('click', () => {
    if (confirm('End the game now?')) socket.emit('host:end_game', {});
});

// ── Game Board ──
function renderBoard(board, players) {
    const el = document.getElementById('hostBoard');
    el.style.gridTemplateColumns = `repeat(${board.width}, 1fr)`;
    el.innerHTML = '';

    // Build a map of player positions
    const playerPos = {};
    Object.values(players).forEach((p, i) => {
        if (!playerPos[`${p.x},${p.y}`]) playerPos[`${p.x},${p.y}`] = [];
        playerPos[`${p.x},${p.y}`].push(getPlayerEmoji(i));
    });

    for (let y = 0; y < board.height; y++) {
        for (let x = 0; x < board.width; x++) {
            const tile = board.grid[y][x];
            const div = document.createElement('div');
            div.className = `tile tile-${tile.type}`;
            div.title = `(${x},${y}) ${tile.type}`;

            const icons = state?.settings?.sprites?.tiles || { good: '★', bad: '✖', shop: '🛒', exit: '🚪', start: '◉', empty: '' };
            div.textContent = icons[tile.type] || '';

            const here = playerPos[`${x},${y}`];
            if (here) {
                const marker = document.createElement('span');
                marker.className = 'tile-player-marker';
                marker.textContent = here.join('');
                div.textContent = '';
                div.appendChild(marker);
            }

            // Map Edit functionality
            div.addEventListener('click', () => {
                if (isEditMode && currentPaintTile) {
                    socket.emit('host:edit_tile', { x, y, type: currentPaintTile });
                }
            });

            el.appendChild(div);
        }
    }
}

// ── Player Cards ──
function renderPlayerCards(players, turnOrder, currentTurnIndex) {
    const currentId = turnOrder[currentTurnIndex];
    const container = document.getElementById('playerCards');
    container.innerHTML = '';
    turnOrder.forEach((id, i) => {
        const p = players[id];
        if (!p) return;
        const div = document.createElement('div');
        div.className = 'p-card' + (id === currentId ? ' active-turn' : '');
        const buffs = Object.entries(p.buffs || {}).filter(([k, v]) => v > 0).map(([k, v]) => `${k}(${v})`).join(', ');
        const inv = p.inventory?.map(i => i.icon || '').join(' ') || '—';
        div.innerHTML = `
      <div class="p-card-name">${getPlayerEmoji(i)} ${p.name}${id === currentId ? ' <span style="color:var(--gold)">◀ Turn</span>' : ''}</div>
      <div class="p-card-coins">💰 ${p.coins} coins</div>
      <div class="p-card-buffs">Buffs: ${buffs || 'none'}</div>
      <div class="p-card-inv">🎒 ${inv}</div>
    `;
        container.appendChild(div);
    });
}

// ── Event Log ──
function renderLog(log) {
    const ul = document.getElementById('eventLog');
    ul.innerHTML = log.map(e => `<li class="log-item log-${e.type || 'info'}">${e.message}</li>`).join('');
}

// ── Update Game ──
function updateGame(data) {
    if (!document.getElementById('gameScreen').classList.contains('hidden')) {
        renderBoard(data.board, data.players);
        renderPlayerCards(data.players, data.turnOrder, data.currentTurnIndex);
        renderLog(data.log);
        document.getElementById('roundLabel').textContent = `Round ${data.round}`;
    }
}

// ── Map Editor ──
let isEditMode = false;
let currentPaintTile = 'empty';

document.getElementById('toggleEditMapBtn').addEventListener('click', (e) => {
    isEditMode = !isEditMode;
    e.target.textContent = `Map Editor: ${isEditMode ? 'ON' : 'OFF'}`;
    e.target.className = isEditMode ? 'btn btn-secondary' : 'btn btn-primary';
    document.getElementById('editPalette').classList.toggle('hidden', !isEditMode);
    document.getElementById('hostBoard').style.cursor = isEditMode ? 'crosshair' : 'default';
});

document.querySelectorAll('.palette-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('btn-primary'));
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.add('btn-secondary'));
        e.target.classList.remove('btn-secondary');
        e.target.classList.add('btn-primary');
        currentPaintTile = e.target.dataset.type;
    });
});
// Set first paint tile as active
document.querySelector('.palette-btn[data-type="empty"]').classList.add('btn-primary');
document.querySelector('.palette-btn[data-type="empty"]').classList.remove('btn-secondary');


// ── Sprite Customization ──
const spriteModal = document.getElementById('spriteModal');

document.getElementById('customizeBtn').addEventListener('click', () => {
    if (state && state.settings && state.settings.sprites) {
        const sprites = state.settings.sprites;
        document.getElementById('sprite-good').value = sprites.tiles.good;
        document.getElementById('sprite-bad').value = sprites.tiles.bad;
        document.getElementById('sprite-shop').value = sprites.tiles.shop;
        document.getElementById('sprite-exit').value = sprites.tiles.exit;
        document.getElementById('sprite-start').value = sprites.tiles.start;
        for (let i = 0; i < 6; i++) {
            document.getElementById(`sprite-p${i}`).value = sprites.players[i] || '👤';
        }
        if (sprites.items) {
            document.getElementById('sprite-compass').value = sprites.items.compass || '🧭';
            document.getElementById('sprite-map_fragment').value = sprites.items.map_fragment || '🗺️';
            document.getElementById('sprite-sneakers').value = sprites.items.sneakers || '👟';
            document.getElementById('sprite-shield').value = sprites.items.shield || '🛡️';
            document.getElementById('sprite-bomb').value = sprites.items.bomb || '💣';
            document.getElementById('sprite-torch').value = sprites.items.torch || '🔦';
            document.getElementById('sprite-teleport').value = sprites.items.teleport || '💎';
            document.getElementById('sprite-gold_rush').value = sprites.items.gold_rush || '⚡';
        }
    }
    spriteModal.classList.remove('hidden');
});

document.getElementById('cancelSpritesBtn').addEventListener('click', () => {
    spriteModal.classList.add('hidden');
});

document.getElementById('saveSpritesBtn').addEventListener('click', () => {
    const newSprites = {
        tiles: {
            good: document.getElementById('sprite-good').value || '★',
            bad: document.getElementById('sprite-bad').value || '✖',
            shop: document.getElementById('sprite-shop').value || '🛒',
            exit: document.getElementById('sprite-exit').value || '🚪',
            start: document.getElementById('sprite-start').value || '◉',
            empty: ''
        },
        players: [],
        items: {
            compass: document.getElementById('sprite-compass').value || '🧭',
            map_fragment: document.getElementById('sprite-map_fragment').value || '🗺️',
            sneakers: document.getElementById('sprite-sneakers').value || '👟',
            shield: document.getElementById('sprite-shield').value || '🛡️',
            bomb: document.getElementById('sprite-bomb').value || '💣',
            torch: document.getElementById('sprite-torch').value || '🔦',
            teleport: document.getElementById('sprite-teleport').value || '💎',
            gold_rush: document.getElementById('sprite-gold_rush').value || '⚡'
        }
    };
    for (let i = 0; i < 6; i++) {
        newSprites.players.push(document.getElementById(`sprite-p${i}`).value || '👤');
    }

    socket.emit('host:update_sprites', { sprites: newSprites });
    spriteModal.classList.add('hidden');
});
