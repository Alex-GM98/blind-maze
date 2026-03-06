// shop.js — shared shop modal logic used by player.js
// Exports: openShop(items, playerCoins, onBuy)

function openShop(items, playerCoins, onBuy) {
  const modal = document.getElementById('shopModal');
  const shopCoinsEl = document.getElementById('shopCoins');
  const shopItemsEl = document.getElementById('shopItems');

  shopCoinsEl.textContent = playerCoins;
  shopItemsEl.innerHTML = '';

  items.forEach(item => {
    const canAfford = playerCoins >= item.cost;
    let icon = item.icon;
    if (typeof gameSettings !== 'undefined' && gameSettings?.sprites?.items && item.id) {
      icon = gameSettings.sprites.items[item.id] || item.icon;
    }
    const div = document.createElement('div');
    div.className = 'shop-item';
    div.innerHTML = `
      <div class="shop-item-icon">${icon}</div>
      <div class="shop-item-info">
        <div class="shop-item-name">${item.name}</div>
        <div class="shop-item-desc">${item.description}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.35rem">
        <span class="shop-item-cost">💰 ${item.cost}</span>
        <button class="btn btn-primary shop-item-btn" data-id="${item.id}" ${canAfford ? '' : 'disabled'}>Buy</button>
      </div>
    `;
    shopItemsEl.appendChild(div);
  });

  // Handle buy clicks
  shopItemsEl.querySelectorAll('.shop-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      onBuy(btn.dataset.id);
      modal.classList.add('hidden');
    });
  });

  modal.classList.remove('hidden');
}

document.getElementById('shopClose')?.addEventListener('click', () => {
  document.getElementById('shopModal').classList.add('hidden');
});
