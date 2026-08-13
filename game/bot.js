const { isJoker, cardValue, RANKS } = require('./deck');
const { isValidSet, isValidRun, canExtendMeld, canUseCardImmediately } = require('./validate');

function playBotTurn(game, playerId) {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return;

  if (!game.hasDrawnThisTurn) {
    const top = game.discard[game.discard.length - 1];
    if (top && canUseCardImmediately(player.hand, top, game.melds)) {
      game.drawFromDiscard(playerId, top.id);
    } else {
      game.drawFromStock(playerId);
    }
  }

  let progressed = true;
  while (progressed && player.hand.length > 0) {
    progressed = false;

    if (game.mustUseCardId) {
      const forced = resolveCard(game, player, game.mustUseCardId);
      if (forced) {
        progressed = true;
        continue;
      }
    }

    const layoffMove = findAnyLayoff(game, player);
    if (layoffMove) {
      game.layOff(playerId, layoffMove.meldId, layoffMove.cardIds);
      progressed = true;
      continue;
    }

    const meldMove = findNewMeld(player.hand);
    if (meldMove) {
      game.meldCards(playerId, meldMove);
      progressed = true;
      continue;
    }
  }

  if (player.hand.length > 0 && !game.mustUseCardId) {
    const cardId = chooseDiscard(player.hand);
    game.discardCard(playerId, cardId);
  }
}

// Try to specifically play `cardId` this turn, either onto a table meld or as part of a new meld.
function resolveCard(game, player, cardId) {
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) return false;

  for (const meld of game.melds) {
    if (canExtendMeld(meld, [card])) {
      game.layOff(player.id, meld.id, [card.id]);
      return true;
    }
  }

  const hand = player.hand;
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].id === card.id || hand[j].id === card.id) continue;
      const combo = [card, hand[i], hand[j]];
      if (isValidSet(combo) || isValidRun(combo)) {
        game.meldCards(player.id, combo.map((c) => c.id));
        return true;
      }
    }
  }
  return false;
}

function findAnyLayoff(game, player) {
  for (const card of player.hand) {
    for (const meld of game.melds) {
      if (canExtendMeld(meld, [card])) {
        return { meldId: meld.id, cardIds: [card.id] };
      }
    }
  }
  return null;
}

function dedupeBySuit(cards) {
  const seen = new Set();
  const out = [];
  for (const c of cards) {
    if (seen.has(c.suit)) continue;
    seen.add(c.suit);
    out.push(c);
  }
  return out;
}

function findNewMeld(hand) {
  const naturals = hand.filter((c) => !isJoker(c));
  const jokers = hand.filter(isJoker);

  const byRank = {};
  for (const c of naturals) {
    (byRank[c.rank] = byRank[c.rank] || []).push(c);
  }
  for (const rank of Object.keys(byRank)) {
    const group = dedupeBySuit(byRank[rank]);
    if (group.length >= 3) return group.slice(0, 4).map((c) => c.id);
    if (group.length === 2 && jokers.length >= 1) return [...group, jokers[0]].map((c) => c.id);
  }

  const bySuit = {};
  for (const c of naturals) {
    (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
  }
  for (const suit of Object.keys(bySuit)) {
    const run = findRunInSuit(bySuit[suit], jokers);
    if (run) return run;
  }

  return null;
}

function findRunInSuit(cards, jokers) {
  for (const aceHigh of [false, true]) {
    const withValues = cards
      .map((c) => ({ card: c, value: c.rank === 'A' ? (aceHigh ? 13 : 0) : RANKS.indexOf(c.rank) }))
      .sort((a, b) => a.value - b.value);
    // dedupe identical values (can't use two of the same rank/suit in one run)
    const unique = [];
    const seenValues = new Set();
    for (const item of withValues) {
      if (seenValues.has(item.value)) continue;
      seenValues.add(item.value);
      unique.push(item);
    }
    for (let start = 0; start < unique.length; start++) {
      for (let end = start; end < unique.length; end++) {
        const span = unique[end].value - unique[start].value + 1;
        const naturalCount = end - start + 1;
        const gaps = span - naturalCount;
        if (gaps < 0 || gaps > jokers.length) continue;
        if (naturalCount + gaps < 3) continue;
        const cardIds = unique.slice(start, end + 1).map((item) => item.card.id);
        const jokerIds = jokers.slice(0, gaps).map((j) => j.id);
        return [...cardIds, ...jokerIds];
      }
    }
  }
  return null;
}

function chooseDiscard(hand) {
  let worst = null;
  let worstScore = Infinity;
  for (const card of hand) {
    if (isJoker(card)) continue; // never discard a joker if avoidable
    const usefulness = usefulnessScore(card, hand);
    const risk = cardValue(card, false);
    const score = usefulness * 100 - risk; // prefer low usefulness, then high value (get rid of expensive dead weight)
    if (score < worstScore) {
      worstScore = score;
      worst = card;
    }
  }
  if (!worst) worst = hand[0];
  return worst.id;
}

function usefulnessScore(card, hand) {
  if (isJoker(card)) return 99;
  let score = 0;
  for (const other of hand) {
    if (other.id === card.id) continue;
    if (isJoker(other)) {
      score += 1;
      continue;
    }
    if (other.rank === card.rank) score += 2;
    if (other.suit === card.suit) {
      const diff = Math.abs(RANKS.indexOf(other.rank) - RANKS.indexOf(card.rank));
      if (diff === 1) score += 2;
      else if (diff === 2) score += 1;
    }
  }
  return score;
}

module.exports = { playBotTurn };
