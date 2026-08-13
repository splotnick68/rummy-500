# Rummy 500

A browser-playable Rummy 500 game. One player creates a room and shares a link; everyone who opens it plays together in real time (Node + Socket.IO keeps everyone's game state in sync).

## Run it

```bash
cd rummy-500
npm install
npm start
```

Then open `http://localhost:3003`, create a game, and send the share link (shown on the waiting screen) to the other players. Everyone needs to be able to reach that address — same machine, same LAN, or a tunnel if playing over the internet.

Don't have enough humans? The host can click **Add computer player** on the waiting screen (up to the 8-player cap) and remove them again before the game starts. Computer players draw, meld, lay off, and discard automatically a moment after their turn begins — no need for anyone to act on their behalf.

While playing, use **Sort by rank** / **Sort by suit** above your hand to reorder your cards (click again to turn a sort off), or just drag a card to wherever you want it — that arrangement sticks (newly drawn cards land at the end) until you pick a sort or drag again. All of this is a display preference only; it doesn't affect gameplay.

Whenever you draw from the stock, that card gets a pulsing blue glow in your hand so it's easy to pick out — it clears once you draw again or your turn ends.

Each player's badge at the top shows a mini stack of cards with their current hand size on it, so you can see at a glance how close an opponent is to going out. It also shows an "On board" running total — the combined point value of everything that player currently has melded on the table this round, which gets folded into their score once the round ends.

## Rules implemented

- 2 players: single 52-card deck + 2 jokers, 13 cards dealt each.
- 3+ players: two decks + 4 jokers, 7 cards dealt each.
- On your turn: draw from the stock **or** take any card from the discard pile (you also take every card stacked above it) — the classic 500 Rum rule. The specific card you're reaching for must already be usable — able to form a new meld with cards in your hand, or lay off onto any meld on the table — or the pickup is refused outright; the cards on top of it don't have to be usable. Discard cards you can't currently use are grayed out so you can see this before clicking, not just after. Once taken, that card must actually be melded or laid off before you can discard.
- Meld sets (3-4 of a rank, distinct suits) or runs (3+ consecutive cards, one suit). Jokers are wild.
- Lay off extra cards onto *any* meld already on the table, yours or an opponent's. Once you've selected cards from your hand, the "lay off onto" dropdown only lists melds those cards could actually extend.
- Going out (emptying your hand) ends the round immediately.
- Scoring at round end: each player scores the point value of everything they've melded, minus whatever's left in hand (can go negative). Aces are worth 15, except as the low card of an A-2-3 run, where they're worth 5. Face cards are 10, jokers are 15, number cards are face value.
- First to 500 wins.

## Known simplifications

- No joker "swap-out" (trading a held natural card for a joker already in a meld).
- Reconnecting after a dropped connection re-joins as a new seat rather than resuming your old one.
