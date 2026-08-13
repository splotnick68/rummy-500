const { isJoker, RANKS } = require('./deck');

const RANK_ORDER = RANKS; // 'A' is index 0 (low); handled specially for high runs

function rankIndexLow(rank) {
  return RANK_ORDER.indexOf(rank); // A=0,2=1,...,K=12
}

// Validates a brand-new set (3+ of same rank, distinct suits, jokers wild).
function isValidSet(cards) {
  if (cards.length < 3) return false;
  const naturals = cards.filter((c) => !isJoker(c));
  const jokers = cards.length - naturals.length;
  if (naturals.length === 0) return false; // can't be all jokers
  const rank = naturals[0].rank;
  const suits = new Set();
  for (const c of naturals) {
    if (c.rank !== rank) return false;
    if (suits.has(c.suit)) return false; // duplicate suit not allowed
    suits.add(c.suit);
  }
  // A set can have at most 4 members total (one per suit)
  if (naturals.length + jokers > 4) return false;
  return true;
}

// Validates a brand-new run (3+ consecutive same suit, jokers fill gaps, Ace high or low but not both).
function isValidRun(cards) {
  if (cards.length < 3) return false;
  const naturals = cards.filter((c) => !isJoker(c));
  const jokerCount = cards.length - naturals.length;
  if (naturals.length === 0) return false;
  const suit = naturals[0].suit;
  if (!naturals.every((c) => c.suit === suit)) return false;

  // try both low-ace and high-ace orderings, see if either can be arranged validly
  return canArrangeRun(naturals, jokerCount, false) || canArrangeRun(naturals, jokerCount, true);
}

function rankValueForRun(rank, aceHigh) {
  if (rank === 'A') return aceHigh ? 13 : 0;
  return rankIndexLow(rank);
}

function canArrangeRun(naturals, jokerCount, aceHigh) {
  const values = naturals.map((c) => rankValueForRun(c.rank, aceHigh));
  const uniqueSet = new Set(values);
  if (uniqueSet.size !== values.length) return false; // duplicate rank in same suit run
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min + 1;
  const gaps = span - naturals.length;
  if (gaps < 0) return false;
  return gaps <= jokerCount && span <= 13;
}

function isValidMeld(cards) {
  return isValidSet(cards) || isValidRun(cards);
}

function meldType(cards) {
  if (isValidSet(cards)) return 'set';
  if (isValidRun(cards)) return 'run';
  return null;
}

// Can `newCards` be added to an existing meld (extending a run at either end, or filling out a set)?
function canExtendMeld(meld, newCards) {
  const combined = meld.cards.concat(newCards);
  if (meld.type === 'set') return isValidSet(combined);
  if (meld.type === 'run') return isValidRun(combined);
  return false;
}

// Could `card` be melded/laid-off right now, using only cards already in `hand` (not counting
// `card` itself) plus melds already on the table? Used to enforce that a card taken from the
// discard pile can actually be put to use before the pickup is allowed.
function canUseCardImmediately(hand, card, melds) {
  for (const meld of melds) {
    if (canExtendMeld(meld, [card])) return true;
  }
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      const combo = [card, hand[i], hand[j]];
      if (isValidSet(combo) || isValidRun(combo)) return true;
    }
  }
  return false;
}

module.exports = { isValidSet, isValidRun, isValidMeld, meldType, canExtendMeld, canUseCardImmediately };
