const socket = io();

const params = new URLSearchParams(window.location.search);
const w = parseInt(params.get('w')) || 10;
const h = parseInt(params.get('h')) || 10;

let state = null;
const PLAYER_EMOJIS = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];

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
function updateLobby(data) {
    const players = Object.values(data.players);
    document.getElementById('playerCount').textContent = players.length;
    const ul = document.getElementById('lobbyPlayers');
    ul.innerHTML = players.map((p, i) => `<li>${PLAYER_EMOJIS[i] || '👤'} ${p.name} — 💰 ${p.coins} coins</li>`).join('');
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
        playerPos[`${p.x},${p.y}`].push(PLAYER_EMOJIS[i] || '👤');
    });

    for (let y = 0; y < board.height; y++) {
        for (let x = 0; x < board.width; x++) {
            const tile = board.grid[y][x];
            const div = document.createElement('div');
            div.className = `tile tile-${tile.type}`;
            div.title = `(${x},${y}) ${tile.type}`;

            const icons = { good: '★', bad: '✖', shop: '🛒', exit: '🚪', start: '◉', empty: '' };
            div.textContent = icons[tile.type] || '';

            const here = playerPos[`${x},${y}`];
            if (here) {
                const marker = document.createElement('span');
                marker.className = 'tile-player-marker';
                marker.textContent = here.join('');
                div.textContent = '';
                div.appendChild(marker);
            }
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
      <div class="p-card-name">${PLAYER_EMOJIS[i]} ${p.name}${id === currentId ? ' <span style="color:var(--gold)">◀ Turn</span>' : ''}</div>
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
