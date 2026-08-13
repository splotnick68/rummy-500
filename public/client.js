const socket = io();

let myId = null;
let myRoomCode = null;
let lastState = null;
const selected = new Set();

const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H', 'D']);
const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_ORDER = ['S', 'H', 'D', 'C'];
let sortMode = 'none'; // 'none' | 'rank' | 'suit' | 'manual'
let manualOrder = []; // card ids, used when sortMode === 'manual'
let dragState = null;

const el = (id) => document.getElementById(id);

function rankIndex(card) {
  return card.suit === 'JOKER' ? 99 : RANK_ORDER.indexOf(card.rank);
}

function suitIndex(card) {
  return card.suit === 'JOKER' ? 99 : SUIT_ORDER.indexOf(card.suit);
}

function sortedHand(hand) {
  if (sortMode === 'rank') {
    return [...hand].sort((a, b) => rankIndex(a) - rankIndex(b) || suitIndex(a) - suitIndex(b));
  }
  if (sortMode === 'suit') {
    return [...hand].sort((a, b) => suitIndex(a) - suitIndex(b) || rankIndex(a) - rankIndex(b));
  }
  if (sortMode === 'manual') {
    const byId = new Map(hand.map((c) => [c.id, c]));
    const ordered = manualOrder.filter((id) => byId.has(id)).map((id) => byId.get(id));
    const placed = new Set(ordered.map((c) => c.id));
    const rest = hand.filter((c) => !placed.has(c.id)); // newly drawn cards not yet positioned
    return [...ordered, ...rest];
  }
  return hand;
}

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}

// ---------- Meld validation (mirrors game/validate.js server-side logic) ----------
// Duplicated here (no shared module system in this static-file app) so the discard pile can be
// grayed out client-side instead of only rejecting the draw after the fact. Keep in sync with
// game/validate.js if that logic changes.

function isJokerCard(c) {
  return c.suit === 'JOKER';
}

function isValidSetClient(cards) {
  if (cards.length < 3) return false;
  const naturals = cards.filter((c) => !isJokerCard(c));
  const jokers = cards.length - naturals.length;
  if (naturals.length === 0) return false;
  const rank = naturals[0].rank;
  const suits = new Set();
  for (const c of naturals) {
    if (c.rank !== rank) return false;
    if (suits.has(c.suit)) return false;
    suits.add(c.suit);
  }
  if (naturals.length + jokers > 4) return false;
  return true;
}

function rankValueForRunClient(rank, aceHigh) {
  if (rank === 'A') return aceHigh ? 13 : 0;
  return RANK_ORDER.indexOf(rank);
}

function canArrangeRunClient(naturals, jokerCount, aceHigh) {
  const values = naturals.map((c) => rankValueForRunClient(c.rank, aceHigh));
  const uniqueSet = new Set(values);
  if (uniqueSet.size !== values.length) return false;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min + 1;
  const gaps = span - naturals.length;
  if (gaps < 0) return false;
  return gaps <= jokerCount && span <= 13;
}

function isValidRunClient(cards) {
  if (cards.length < 3) return false;
  const naturals = cards.filter((c) => !isJokerCard(c));
  const jokerCount = cards.length - naturals.length;
  if (naturals.length === 0) return false;
  const suit = naturals[0].suit;
  if (!naturals.every((c) => c.suit === suit)) return false;
  return canArrangeRunClient(naturals, jokerCount, false) || canArrangeRunClient(naturals, jokerCount, true);
}

function canExtendMeldClient(meld, newCards) {
  const combined = meld.cards.concat(newCards);
  if (meld.type === 'set') return isValidSetClient(combined);
  if (meld.type === 'run') return isValidRunClient(combined);
  return false;
}

function canUseCardImmediatelyClient(hand, card, melds) {
  for (const meld of melds) {
    if (canExtendMeldClient(meld, [card])) return true;
  }
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      const combo = [card, hand[i], hand[j]];
      if (isValidSetClient(combo) || isValidRunClient(combo)) return true;
    }
  }
  return false;
}

// ---------- Lobby ----------

const params = new URLSearchParams(window.location.search);
if (params.get('room')) {
  el('room-input').value = params.get('room').toUpperCase();
}

el('create-btn').addEventListener('click', () => {
  const name = el('name-input').value.trim();
  if (!name) return showLobbyError('Enter your name first');
  socket.emit('create-room', name);
});

el('join-btn').addEventListener('click', () => {
  const name = el('name-input').value.trim();
  const roomCode = el('room-input').value.trim().toUpperCase();
  if (!name) return showLobbyError('Enter your name first');
  if (!roomCode) return showLobbyError('Enter a room code');
  socket.emit('join-room', { roomCode, name });
});

function showLobbyError(msg) {
  el('lobby-error').textContent = msg;
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

socket.on('joined', ({ roomCode, playerId }) => {
  myId = playerId;
  myRoomCode = roomCode;
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomCode);
  window.history.replaceState({}, '', url);
  el('share-link').value = url.toString();
  el('localhost-warning').hidden = !LOOPBACK_HOSTNAMES.has(url.hostname);
});

el('copy-link-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el('share-link').value);
    el('copy-link-btn').textContent = 'Copied!';
    setTimeout(() => (el('copy-link-btn').textContent = 'Copy'), 1500);
  } catch {
    el('share-link').select();
  }
});

el('start-btn').addEventListener('click', () => socket.emit('start-game'));
el('next-round-btn').addEventListener('click', () => socket.emit('next-round'));
el('add-bot-btn').addEventListener('click', () => socket.emit('add-bot'));

el('sort-rank-btn').addEventListener('click', () => {
  sortMode = sortMode === 'rank' ? 'none' : 'rank';
  updateSortButtons();
  if (lastState) render(lastState);
});
el('sort-suit-btn').addEventListener('click', () => {
  sortMode = sortMode === 'suit' ? 'none' : 'suit';
  updateSortButtons();
  if (lastState) render(lastState);
});

function updateSortButtons() {
  el('sort-rank-btn').classList.toggle('active', sortMode === 'rank');
  el('sort-suit-btn').classList.toggle('active', sortMode === 'suit');
}

socket.on('error-message', (msg) => {
  const lobbyVisible = !el('lobby-screen').hidden;
  if (lobbyVisible) showLobbyError(msg);
  else {
    el('game-message').textContent = msg;
    setTimeout(() => {
      if (el('game-message').textContent === msg) el('game-message').textContent = '';
    }, 3500);
  }
});

// ---------- Main state render ----------

socket.on('state', (state) => {
  lastState = state;
  render(state);
});

function render(state) {
  if (state.phase === 'lobby') renderWaiting(state);
  else if (state.phase === 'playing') renderGame(state);
  else renderRoundEnd(state);
}

function renderWaiting(state) {
  showScreen('waiting-screen');
  const isHost = state.hostId === myId;
  const list = el('waiting-players');
  list.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent =
      p.name +
      (p.isBot ? ' (computer)' : '') +
      (p.id === state.hostId ? ' (host)' : '') +
      (p.id === myId ? ' — you' : '');
    li.appendChild(label);
    if (isHost && p.id !== state.hostId) {
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.style.marginLeft = '10px';
      removeBtn.onclick = () => socket.emit('remove-player', p.id);
      li.appendChild(removeBtn);
    }
    list.appendChild(li);
  }
  el('add-bot-btn').hidden = !isHost || state.players.length >= 8;
  el('start-btn').hidden = !isHost;
  el('start-btn').disabled = state.players.length < 2;
  el('waiting-hint').textContent = isHost
    ? state.players.length < 2
      ? 'Need at least 2 players to start — add a computer player or share the link.'
      : ''
    : 'Waiting for the host to start the game...';
}

function renderGame(state) {
  showScreen('game-screen');
  el('room-badge').textContent = 'Room ' + state.roomCode;

  const me = state.players.find((p) => p.id === myId);
  const turnPlayer = state.players.find((p) => p.id === state.turnPlayerId);
  const myTurn = state.turnPlayerId === myId;
  el('turn-indicator').textContent = myTurn
    ? "It's your turn"
    : `${turnPlayer ? turnPlayer.name + (turnPlayer.isBot ? ' (computer)' : '') : '...'}'s turn`;

  renderScoreboard(state);

  renderMelds(state, me);
  renderStock(state, myTurn);
  renderDiscard(state, myTurn, me);
  renderHand(me, myTurn, state);
  updateActionBar(state, myTurn);

  el('log-panel').innerHTML = state.log.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  el('log-panel').scrollTop = el('log-panel').scrollHeight;
}

function renderScoreboard(state) {
  const board = el('scoreboard');
  board.innerHTML = '';
  const meldsTotalByOwner = new Map();
  for (const m of state.melds) {
    meldsTotalByOwner.set(m.ownerId, (meldsTotalByOwner.get(m.ownerId) || 0) + m.value);
  }
  for (const p of state.players) {
    const badge = document.createElement('div');
    badge.className = 'player-badge';
    if (p.id === myId) badge.classList.add('me');
    if (p.id === state.turnPlayerId) badge.classList.add('on-turn');

    const nameEl = document.createElement('div');
    nameEl.className = 'player-badge-name';
    nameEl.textContent = `${p.name}${p.isBot ? ' 🤖' : ''}${p.connected ? '' : ' (offline)'}`;
    badge.appendChild(nameEl);

    const miniHand = document.createElement('div');
    miniHand.className = 'mini-hand';
    miniHand.title = `${p.handCount} card${p.handCount === 1 ? '' : 's'} in hand`;
    const stackDepth = Math.min(p.handCount, 4);
    for (let i = 0; i < Math.max(stackDepth, 1); i++) {
      const layer = document.createElement('div');
      layer.className = 'mini-card-back';
      miniHand.appendChild(layer);
    }
    const countBadge = document.createElement('span');
    countBadge.className = 'mini-hand-count';
    countBadge.textContent = p.handCount;
    miniHand.appendChild(countBadge);
    badge.appendChild(miniHand);

    const scoreEl = document.createElement('div');
    scoreEl.className = 'player-badge-score';
    scoreEl.textContent = `${p.score} pts`;
    badge.appendChild(scoreEl);

    const meldsTotal = meldsTotalByOwner.get(p.id) || 0;
    const meldsEl = document.createElement('div');
    meldsEl.className = 'player-badge-melds';
    meldsEl.textContent = `On board: ${meldsTotal}`;
    meldsEl.title = "Running total of this player's melds on the table this round (added to their score when the round ends)";
    badge.appendChild(meldsEl);

    board.appendChild(badge);
  }
}

function renderMelds(state, me) {
  const area = el('melds-area');
  area.innerHTML = '';
  const byOwner = new Map();
  for (const m of state.melds) {
    if (!byOwner.has(m.ownerId)) byOwner.set(m.ownerId, []);
    byOwner.get(m.ownerId).push(m);
  }
  for (const [ownerId, melds] of byOwner) {
    const owner = state.players.find((p) => p.id === ownerId);
    for (const meld of melds) {
      const group = document.createElement('div');
      group.className = 'meld-group';
      const h5 = document.createElement('h5');
      h5.textContent = `${owner ? owner.name : '?'} — ${meld.type} (${meld.value} pts)`;
      group.appendChild(h5);
      const row = document.createElement('div');
      row.className = 'card-row';
      for (const c of meld.cards) row.appendChild(cardEl(c));
      group.appendChild(row);
      area.appendChild(group);
    }
  }

  const select = el('layoff-target');
  const prev = select.value;
  select.innerHTML = '<option value="">Choose a meld to lay off onto...</option>';
  const selectedCards = me && me.hand ? me.hand.filter((c) => selected.has(c.id)) : [];
  const eligibleMelds =
    selectedCards.length === 0 ? state.melds : state.melds.filter((m) => canExtendMeldClient(m, selectedCards));
  for (const m of eligibleMelds) {
    const owner = state.players.find((p) => p.id === m.ownerId);
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${owner ? owner.name : '?'} — ${m.type}, ${m.value} pts (${describeMeld(m)})`;
    select.appendChild(opt);
  }
  if ([...select.options].some((o) => o.value === prev)) select.value = prev;
}

function describeMeld(meld) {
  return meld.cards.map((c) => shortCard(c)).join(' ');
}

function renderStock(state, myTurn) {
  const stockPile = el('stock-pile');
  el('stock-count').textContent = `${state.stockCount} card${state.stockCount === 1 ? '' : 's'} left`;
  stockPile.classList.toggle('disabled', !(myTurn && !state.hasDrawnThisTurn));
  stockPile.onclick = () => {
    if (myTurn && !state.hasDrawnThisTurn) socket.emit('draw-stock');
  };
}

function renderDiscard(state, myTurn, me) {
  const row = el('discard-pile');
  row.innerHTML = '';
  const canDraw = myTurn && !state.hasDrawnThisTurn;
  state.discard.forEach((c, idx) => {
    const isTop = idx === state.discard.length - 1;
    const node = cardEl(c);
    node.classList.add(isTop ? 'top' : 'non-top');
    // Cards stacked above this one (idx+1..end) come along in the same pickup, so they're
    // available to help meld the target too — mirrors the server-side check in Game.js.
    const availableCards = me && me.hand ? me.hand.concat(state.discard.slice(idx + 1)) : [];
    const usable = canDraw && me && me.hand && canUseCardImmediatelyClient(availableCards, c, state.melds);
    if (!canDraw) {
      node.classList.add('disabled');
    } else if (!usable) {
      node.classList.add('disabled');
      node.title = "Can't use this in a meld right now — pick another card or draw from the stock";
    } else {
      node.title = isTop ? 'Take this card' : `Take this and ${state.discard.length - 1 - idx} card(s) above it`;
      node.onclick = () => socket.emit('draw-discard', c.id);
    }
    row.appendChild(node);
  });
}

function renderHand(me, myTurn, state) {
  const hand = el('hand');
  hand.innerHTML = '';
  if (!me || !me.hand) return;
  for (const id of [...selected]) {
    if (!me.hand.some((c) => c.id === id)) selected.delete(id);
  }
  for (const c of sortedHand(me.hand)) {
    const node = cardEl(c);
    node.classList.add('hand-card');
    node.dataset.cardId = c.id;
    if (selected.has(c.id)) node.classList.add('selected');
    if (state.mustUseCardId === c.id) node.title = 'Must be melded or laid off this turn';
    if (state.lastStockDrawId === c.id) {
      node.classList.add('just-drawn');
      node.title = 'Just drawn from the stock';
    }
    attachHandCardDrag(node, c.id);
    hand.appendChild(node);
  }
}

function toggleCardSelection(cardId) {
  if (selected.has(cardId)) selected.delete(cardId);
  else selected.add(cardId);
  if (lastState) render(lastState);
}

// Reordering uses Pointer Events (not HTML5 drag-and-drop) so it works with both mouse and touch.
// Move/up/cancel are handled on `window` rather than per-card: once a card is reparented via
// insertBefore during the drag, per-element listeners (and pointer capture) can stop receiving
// events reliably in some browsers, which would leave the drag stuck. Tracking via the shared
// `dragState` on window-level listeners avoids that entirely.
function attachHandCardDrag(node, cardId) {
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragState = { cardId, node, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
  });
}

window.addEventListener('pointermove', (e) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const node = dragState.node;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  if (!dragState.moved) {
    if (Math.hypot(dx, dy) < 6) return;
    dragState.moved = true;
    node.classList.add('dragging');
  }
  const under = document.elementsFromPoint(e.clientX, e.clientY);
  const targetCard = under.find((el2) => el2.classList && el2.classList.contains('hand-card') && el2 !== node);
  if (targetCard) {
    const rect = targetCard.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    targetCard.parentNode.insertBefore(node, before ? targetCard : targetCard.nextSibling);
  }
});

function endDrag(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const { node, cardId, moved } = dragState;
  node.classList.remove('dragging');
  dragState = null;
  if (moved) {
    manualOrder = [...el('hand').querySelectorAll('.hand-card')].map((n) => n.dataset.cardId);
    sortMode = 'manual';
    updateSortButtons();
    if (lastState) render(lastState);
  } else {
    toggleCardSelection(cardId);
  }
}

window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

function updateActionBar(state, myTurn) {
  const canAct = myTurn && state.hasDrawnThisTurn;
  el('meld-btn').disabled = !(canAct && selected.size >= 3);
  el('meld-btn').onclick = () => {
    socket.emit('meld', [...selected]);
    selected.clear();
  };

  const targetChosen = !!el('layoff-target').value;
  el('layoff-btn').disabled = !(canAct && selected.size >= 1 && targetChosen);
  el('layoff-btn').onclick = () => {
    socket.emit('layoff', { meldId: el('layoff-target').value, cardIds: [...selected] });
    selected.clear();
  };
  el('layoff-target').onchange = () => updateActionBar(state, myTurn);

  el('discard-btn').disabled = !(canAct && selected.size === 1 && !state.mustUseCardId);
  el('discard-btn').onclick = () => {
    socket.emit('discard', [...selected][0]);
    selected.clear();
  };

  el('game-message').textContent =
    myTurn && state.hasDrawnThisTurn && state.mustUseCardId
      ? 'Play the card you picked up before discarding.'
      : '';
}

function renderRoundEnd(state) {
  showScreen('round-end-screen');
  const isGameEnd = state.phase === 'gameEnd';
  const winner = state.players.find((p) => p.id === (isGameEnd ? state.gameWinnerId : state.roundWinnerId));
  el('round-end-title').textContent = isGameEnd
    ? `🏆 ${winner ? winner.name : '?'} wins the game!`
    : `${winner ? winner.name : '?'} went out — round ${state.roundNumber} complete`;

  const scoresDiv = el('round-end-scores');
  scoresDiv.innerHTML = '';
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  for (const p of sorted) {
    const row = document.createElement('div');
    row.innerHTML = `<span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span><span>${p.score}</span>`;
    scoresDiv.appendChild(row);
  }

  const isHost = state.hostId === myId;
  el('next-round-btn').hidden = isGameEnd || !isHost;
  el('round-end-hint').textContent = isGameEnd ? '' : isHost ? '' : 'Waiting for the host to start the next round...';
}

// ---------- Card rendering helpers ----------

function cardEl(card) {
  const div = document.createElement('div');
  div.className = 'card';
  if (card.suit === 'JOKER') {
    div.classList.add('joker');
    div.innerHTML = jokerFaceSVG();
  } else {
    if (RED_SUITS.has(card.suit)) div.classList.add('red');
    div.innerHTML = cardFaceSVG(card.rank, SUIT_SYMBOL[card.suit]);
  }
  return div;
}

function cardFaceSVG(rank, suitSymbol) {
  const corner = (x, y, r) =>
    `<text x="${x}" y="${y}" font-size="34" font-weight="700" font-family="Georgia, serif" fill="currentColor">${rank}</text>` +
    `<text x="${x}" y="${y + 29}" font-size="27" font-family="Georgia, serif" fill="currentColor">${suitSymbol}</text>`;
  return `
<svg viewBox="0 0 100 140" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
  <rect x="1.5" y="1.5" width="97" height="137" rx="9" fill="#fbf8ef" stroke="#999" stroke-width="1.5"/>
  ${corner(6, 30)}
  <g transform="translate(100,140) rotate(180)">${corner(6, 30)}</g>
  <text x="50" y="82" font-size="62" font-family="Georgia, serif" fill="currentColor" text-anchor="middle" dominant-baseline="central">${suitSymbol}</text>
</svg>`;
}

function jokerFaceSVG() {
  const star = (x, y) =>
    `<text x="${x}" y="${y}" font-size="18" fill="#f4c542" text-anchor="middle" dominant-baseline="central">&#9733;</text>`;
  return `
<svg viewBox="0 0 100 140" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
  <rect x="1.5" y="1.5" width="97" height="137" rx="9" fill="#fdf6e3" stroke="#8e44ad" stroke-width="1.5"/>
  ${star(13, 14)}
  <g transform="translate(100,140) rotate(180)">${star(13, 14)}</g>
  <path d="M22,54 L32,18 L42,42 L50,12 L58,42 L68,18 L78,54 Z" fill="#8e44ad" stroke="#5a1f96" stroke-width="1"/>
  <circle cx="32" cy="18" r="4.5" fill="#f4c542"/>
  <circle cx="50" cy="12" r="4.5" fill="#f4c542"/>
  <circle cx="68" cy="18" r="4.5" fill="#f4c542"/>
  <rect x="20" y="51" width="60" height="9" rx="3" fill="#8e44ad"/>
  <circle cx="50" cy="84" r="18" fill="#f6c98d"/>
  <circle cx="43" cy="82" r="2.2" fill="#2b2b2b"/>
  <circle cx="57" cy="82" r="2.2" fill="#2b2b2b"/>
  <circle cx="50" cy="89" r="2.5" fill="#e0574c"/>
  <path d="M41,92 Q50,100 59,92" fill="none" stroke="#2b2b2b" stroke-width="2.2" stroke-linecap="round"/>
  <text x="50" y="124" font-size="22" font-weight="700" font-family="Georgia, serif" fill="#7b2cbf" text-anchor="middle" letter-spacing="1">JOKER</text>
</svg>`;
}

function shortCard(card) {
  return card.suit === 'JOKER' ? 'JOKER' : `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
