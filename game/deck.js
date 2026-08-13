const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

let nextId = 1;

function makeCard(rank, suit) {
  return { id: 'c' + nextId++, rank, suit };
}

// numDecks: 1 for 2-3 players, 2 for 4+ players. Each deck contributes 2 jokers.
function createShuffledDeck(numDecks) {
  const cards = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push(makeCard(rank, suit));
      }
    }
    cards.push(makeCard(null, 'JOKER'));
    cards.push(makeCard(null, 'JOKER'));
  }
  return shuffle(cards);
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function isJoker(card) {
  return card.suit === 'JOKER';
}

// Point value of a single card. `lowAce` marks an Ace used as the low card of an A-2-3 run.
function cardValue(card, lowAce) {
  if (isJoker(card)) return 15;
  if (card.rank === 'A') return lowAce ? 5 : 15;
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  if (card.rank === '10') return 10;
  return parseInt(card.rank, 10);
}

module.exports = { SUITS, RANKS, createShuffledDeck, isJoker, cardValue };
