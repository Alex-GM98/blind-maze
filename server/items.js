// Item definitions for the Blind Maze shop
// Each item has: id, name, cost, description, and an applyEffect function
// applyEffect(player, gameState) returns { message, stateChanges }

const ITEMS = [
  {
    id: 'compass',
    name: 'Compass',
    cost: 10,
    icon: '🧭',
    description: 'Reveals the direction to the nearest other player.',
    passive: false,
    applyEffect(player, gameState) {
      const others = Object.values(gameState.players).filter(p => p.id !== player.id && p.alive);
      if (others.length === 0) return { message: 'No other players on the map.' };
      let nearest = null;
      let minDist = Infinity;
      for (const other of others) {
        const dist = Math.abs(other.x - player.x) + Math.abs(other.y - player.y);
        if (dist < minDist) { minDist = dist; nearest = other; }
      }
      const dx = nearest.x - player.x;
      const dy = nearest.y - player.y;
      let dir = '';
      if (Math.abs(dx) >= Math.abs(dy)) {
        dir = dx > 0 ? 'East' : 'West';
      } else {
        dir = dy > 0 ? 'South' : 'North';
      }
      return { message: `The nearest player is to the ${dir} (${minDist} tiles away).` };
    }
  },
  {
    id: 'map_fragment',
    name: 'Map Fragment',
    cost: 15,
    icon: '🗺️',
    description: 'Reveals a 3×3 area around your current position on YOUR map.',
    passive: false,
    applyEffect(player, gameState) {
      const revealed = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = player.x + dx;
          const ny = player.y + dy;
          if (nx >= 0 && ny >= 0 && nx < gameState.board.width && ny < gameState.board.height) {
            const tile = gameState.board.grid[ny][nx];
            revealed.push({ x: nx, y: ny, type: tile.type });
          }
        }
      }
      return { message: 'You studied a map fragment and revealed the area around you.', revealedTiles: revealed };
    }
  },
  {
    id: 'sneakers',
    name: 'Sneakers',
    cost: 10,
    icon: '👟',
    description: 'Move 2 tiles per turn for your next 3 turns.',
    passive: true,
    duration: 3,
    applyEffect(player, gameState) {
      player.buffs = player.buffs || {};
      player.buffs.sneakers = 3;
      return { message: 'You laced up your Sneakers! Move 2 tiles for 3 turns.', buffApplied: 'sneakers' };
    }
  },
  {
    id: 'shield',
    name: 'Shield',
    cost: 12,
    icon: '🛡️',
    description: 'Block the next Bad tile effect completely.',
    passive: true,
    applyEffect(player, gameState) {
      player.buffs = player.buffs || {};
      player.buffs.shield = 1;
      return { message: 'You raised your Shield! The next Bad tile will have no effect.', buffApplied: 'shield' };
    }
  },
  {
    id: 'bomb',
    name: 'Bomb',
    cost: 20,
    icon: '💣',
    description: 'Send a chosen player back to their start tile.',
    passive: false,
    requiresTarget: true,
    applyEffect(player, gameState, targetId) {
      const target = gameState.players[targetId];
      if (!target) return { message: 'Target player not found.' };
      const oldX = target.x;
      const oldY = target.y;
      target.x = target.startX;
      target.y = target.startY;
      return {
        message: `💥 ${player.name} bombed ${target.name} back to the start!`,
        targetMoved: { playerId: targetId, x: target.startX, y: target.startY },
        targetMessage: `You were bombed by ${player.name} and sent back to the start!`
      };
    }
  },
  {
    id: 'torch',
    name: 'Torch',
    cost: 8,
    icon: '🔦',
    description: 'Reveals all tiles adjacent to your current position before moving.',
    passive: true,
    applyEffect(player, gameState) {
      player.buffs = player.buffs || {};
      player.buffs.torch = 1;
      const revealed = [];
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = player.x + dx;
        const ny = player.y + dy;
        if (nx >= 0 && ny >= 0 && nx < gameState.board.width && ny < gameState.board.height) {
          revealed.push({ x: nx, y: ny, type: gameState.board.grid[ny][nx].type });
        }
      }
      return { message: 'You lit your Torch and can see the adjacent tiles.', revealedTiles: revealed, buffApplied: 'torch' };
    }
  },
  {
    id: 'teleport',
    name: 'Teleport Stone',
    cost: 25,
    icon: '💎',
    description: 'Move to any tile you have previously visited.',
    passive: false,
    requiresVisited: true,
    applyEffect(player, gameState, targetCoords) {
      const { x, y } = targetCoords;
      player.x = x;
      player.y = y;
      return { message: `You teleported to (${x}, ${y})!`, moved: { x, y } };
    }
  },
  {
    id: 'gold_rush',
    name: 'Gold Rush',
    cost: 18,
    icon: '⚡',
    description: 'Double all coin rewards from Good tiles for your next 2 turns.',
    passive: true,
    applyEffect(player, gameState) {
      player.buffs = player.buffs || {};
      player.buffs.goldRush = 2;
      return { message: 'Gold Rush activated! Coin gains doubled for 2 turns.', buffApplied: 'goldRush' };
    }
  }
];

module.exports = { ITEMS };
