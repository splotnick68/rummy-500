const { createShuffledDeck, cardValue, isJoker } = require('./deck');
const { isValidMeld, meldType, canExtendMeld, canUseCardImmediately } = require('./validate');

const TARGET_SCORE = 500;

let meldIdCounter = 1;

class Game {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.players = []; // { id, name, hand: [card], connected }
    this.hostId = null;
    this.phase = 'lobby'; // lobby | playing | roundEnd | gameEnd
    this.stock = [];
    this.discard = []; // last element is top of pile
    this.melds = []; // { id, ownerId, type, cards: [] }
    this.turnIndex = 0;
    this.scores = {}; // playerId -> cumulative score
    this.roundNumber = 0;
    this.hasDrawnThisTurn = false;
    this.mustUseCardId = null; // card that must be melded/laid off this turn (taken from mid-pile)
    this.lastStockDrawId = null; // most recent card drawn from the stock this turn, for UI highlighting
    this.log = [];
  }

  addPlayer(id, name) {
    if (this.phase !== 'lobby') throw new Error('Game already in progress');
    if (this.players.length >= 8) throw new Error('Room is full');
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('Name already taken in this room');
    }
    if (!this.hostId) this.hostId = id;
    this.players.push({ id, name, hand: [], connected: true, isBot: false });
    this.scores[id] = 0;
  }

  addBotPlayer() {
    if (this.phase !== 'lobby') throw new Error('Game already in progress');
    if (this.players.length >= 8) throw new Error('Room is full');
    const botNumbers = this.players
      .filter((p) => p.isBot)
      .map((p) => parseInt(p.name.replace('Computer ', ''), 10))
      .filter((n) => !isNaN(n));
    const nextNumber = botNumbers.length ? Math.max(...botNumbers) + 1 : 1;
    const id = 'bot-' + Math.random().toString(36).slice(2, 10);
    this.players.push({ id, name: `Computer ${nextNumber}`, hand: [], connected: true, isBot: true });
    this.scores[id] = 0;
    return id;
  }

  removePlayerFromLobby(id) {
    if (this.phase !== 'lobby') throw new Error('Can only remove players before the game starts');
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx === -1) return;
    if (this.players[idx].id === this.hostId) throw new Error('Cannot remove the host');
    this.players.splice(idx, 1);
    delete this.scores[id];
  }

  reconnect(oldId, newId, socketId) {
    const p = this.players.find((pl) => pl.id === oldId);
    if (p) {
      p.id = newId;
      p.connected = true;
    }
  }

  removePlayer(id) {
    const p = this.players.find((pl) => pl.id === id);
    if (p) p.connected = false;
  }

  currentPlayer() {
    return this.players[this.turnIndex];
  }

  startGame() {
    if (this.players.length < 2) throw new Error('Need at least 2 players');
    this.phase = 'playing';
    this.startRound();
  }

  startRound() {
    this.roundNumber++;
    const numDecks = this.players.length >= 4 ? 2 : 1;
    this.stock = createShuffledDeck(numDecks);
    this.discard = [];
    this.melds = [];
    this.hasDrawnThisTurn = false;
    this.mustUseCardId = null;
    this.lastStockDrawId = null;

    const dealCount = this.players.length === 2 ? 13 : 7;
    for (const p of this.players) {
      p.hand = this.stock.splice(0, dealCount);
    }
    this.discard.push(this.stock.pop());
    this.turnIndex = (this.roundNumber - 1) % this.players.length;
    this.log = [`Round ${this.roundNumber} started.`];
  }

  requirePlayerTurn(playerId) {
    const cp = this.currentPlayer();
    if (!cp || cp.id !== playerId) throw new Error('Not your turn');
    return cp;
  }

  drawFromStock(playerId) {
    const player = this.requirePlayerTurn(playerId);
    if (this.hasDrawnThisTurn) throw new Error('Already drew this turn');
    if (this.stock.length === 0) this.reshuffleDiscardIntoStock();
    if (this.stock.length === 0) throw new Error('No cards left to draw');
    const card = this.stock.pop();
    player.hand.push(card);
    this.hasDrawnThisTurn = true;
    this.mustUseCardId = null;
    this.lastStockDrawId = card.id;
    this.log.push(`${player.name} drew from the stock.`);
    return card;
  }

  reshuffleDiscardIntoStock() {
    if (this.discard.length <= 1) return;
    const top = this.discard.pop();
    this.stock = shuffleArray(this.discard);
    this.discard = [top];
  }

  // Take a specific card from the discard pile, plus every card stacked above it.
  // The targeted card must be used in a meld/lay-off before the player may discard again.
  drawFromDiscard(playerId, cardId) {
    const player = this.requirePlayerTurn(playerId);
    if (this.hasDrawnThisTurn) throw new Error('Already drew this turn');
    const idx = this.discard.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new Error('Card not found in discard pile');
    const targetCard = this.discard[idx];
    // Cards stacked above the target come along in the same pickup, so they're available to help
    // meld the target too (e.g. target=5H with 4H sitting on top of it, plus a 6H already in hand).
    const collateralCards = this.discard.slice(idx + 1);
    const availableCards = player.hand.concat(collateralCards);
    if (!canUseCardImmediately(availableCards, targetCard, this.melds)) {
      throw new Error("You can't use that card in a meld right now — pick a different card or draw from the stock");
    }
    const taken = this.discard.splice(idx);
    player.hand.push(...taken);
    this.hasDrawnThisTurn = true;
    this.mustUseCardId = cardId;
    this.lastStockDrawId = null;
    this.log.push(`${player.name} picked up ${taken.length} card(s) from the discard pile.`);
    return taken;
  }

  _removeFromHand(player, cardIds) {
    const set = new Set(cardIds);
    const removed = [];
    player.hand = player.hand.filter((c) => {
      if (set.has(c.id)) {
        removed.push(c);
        return false;
      }
      return true;
    });
    if (removed.length !== cardIds.length) throw new Error('Card not in hand');
    return removed;
  }

  meldCards(playerId, cardIds) {
    const player = this.requirePlayerTurn(playerId);
    if (!this.hasDrawnThisTurn) throw new Error('Draw a card before melding');
    if (cardIds.length < 3) throw new Error('A meld needs at least 3 cards');
    const cards = cardIds.map((id) => player.hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) throw new Error('Card not in hand');
    const type = meldType(cards);
    if (!type) throw new Error('Not a valid set or run');
    this._removeFromHand(player, cardIds);
    const meld = { id: 'm' + meldIdCounter++, ownerId: playerId, type, cards };
    this.melds.push(meld);
    this._clearMustUseIfSatisfied(cardIds);
    this.log.push(`${player.name} laid down a ${type} of ${cards.length}.`);
    this._checkGoOut(player);
    return meld;
  }

  layOff(playerId, meldId, cardIds) {
    const player = this.requirePlayerTurn(playerId);
    if (!this.hasDrawnThisTurn) throw new Error('Draw a card before laying off');
    const meld = this.melds.find((m) => m.id === meldId);
    if (!meld) throw new Error('Meld not found');
    const cards = cardIds.map((id) => player.hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) throw new Error('Card not in hand');
    if (!canExtendMeld(meld, cards)) throw new Error('Cards cannot extend that meld');
    this._removeFromHand(player, cardIds);
    meld.cards.push(...cards);
    this._clearMustUseIfSatisfied(cardIds);
    this.log.push(`${player.name} laid off ${cards.length} card(s).`);
    this._checkGoOut(player);
    return meld;
  }

  _clearMustUseIfSatisfied(cardIds) {
    if (this.mustUseCardId && cardIds.includes(this.mustUseCardId)) {
      this.mustUseCardId = null;
    }
  }

  discardCard(playerId, cardId) {
    const player = this.requirePlayerTurn(playerId);
    if (!this.hasDrawnThisTurn) throw new Error('Draw a card before discarding');
    if (this.mustUseCardId) {
      throw new Error('You must play the card you picked up from the discard pile first');
    }
    const [card] = this._removeFromHand(player, [cardId]);
    this.discard.push(card);
    this.log.push(`${player.name} discarded ${describeCard(card)}.`);
    if (player.hand.length === 0) {
      this._endRound(player.id);
      return card;
    }
    this._advanceTurn();
    return card;
  }

  _checkGoOut(player) {
    if (player.hand.length === 0) {
      this._endRound(player.id);
    }
  }

  _advanceTurn() {
    this.hasDrawnThisTurn = false;
    this.mustUseCardId = null;
    this.lastStockDrawId = null;
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
  }

  _endRound(wentOutId) {
    for (const player of this.players) {
      let melded = 0;
      for (const meld of this.melds) {
        if (meld.ownerId !== player.id) continue;
        melded += sumMeldValue(meld);
      }
      const handValue = player.hand.reduce((sum, c) => sum + cardValue(c, false), 0);
      this.scores[player.id] += melded - handValue;
    }
    this.phase = 'roundEnd';
    this.roundWinnerId = wentOutId;
    this.log.push(`${this.players.find((p) => p.id === wentOutId).name} went out! Round scored.`);
    if (Object.values(this.scores).some((s) => s >= TARGET_SCORE)) {
      this.phase = 'gameEnd';
      const best = Object.entries(this.scores).sort((a, b) => b[1] - a[1])[0];
      this.gameWinnerId = best[0];
      this.log.push(`${this.players.find((p) => p.id === this.gameWinnerId).name} wins the game!`);
    }
  }

  continueToNextRound() {
    if (this.phase !== 'roundEnd') throw new Error('Round is not over');
    this.phase = 'playing';
    this.startRound();
  }

  // Returns a state snapshot safe to send to `forPlayerId` (own hand visible, others hidden).
  getStateFor(forPlayerId) {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      hostId: this.hostId,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        isBot: p.isBot,
        handCount: p.hand.length,
        hand: p.id === forPlayerId ? p.hand : undefined,
        score: this.scores[p.id] || 0,
      })),
      turnPlayerId: this.players[this.turnIndex] ? this.players[this.turnIndex].id : null,
      stockCount: this.stock.length,
      discard: this.discard,
      melds: this.melds.map((m) => ({ ...m, value: sumMeldValue(m) })),
      hasDrawnThisTurn: this.hasDrawnThisTurn,
      mustUseCardId: this.mustUseCardId,
      lastStockDrawId: this.lastStockDrawId,
      roundNumber: this.roundNumber,
      roundWinnerId: this.roundWinnerId,
      gameWinnerId: this.gameWinnerId,
      log: this.log.slice(-30),
    };
  }
}

function sumMeldValue(meld) {
  const isLowAceRun = meld.type === 'run' && meld.cards.some((c) => c.rank === 'A') && runIsLowAce(meld.cards);
  return meld.cards.reduce((sum, c) => {
    const lowAce = c.rank === 'A' && isLowAceRun;
    return sum + cardValue(c, lowAce);
  }, 0);
}

function runIsLowAce(cards) {
  const naturals = cards.filter((c) => !isJoker(c));
  const ranks = naturals.map((c) => c.rank);
  return ranks.includes('A') && ranks.includes('2');
}

function describeCard(card) {
  if (isJoker(card)) return 'a Joker';
  return `${card.rank}${card.suit}`;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = Game;
