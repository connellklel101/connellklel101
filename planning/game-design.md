# Game Design Doc: Bumper Party!

## 1. The pitch
- **Title:** Bumper Party!
- **One-sentence pitch:** Bumper car battles where players ram each other off the arena, grab random power-ups, and tune their car with coins they earn, while a waterfall closes in on the map.
- **Genre:** Arena brawler / party knockout with car customization
- **Similar vibe to:** Chaotic item-based kart racing (random items that help lucky players), mixed with bumper cars

## 2. Players
- **Modes:** Several game modes, chosen by the players (see section 3)
- **Players per server:** 6–12 on the standard small map. Bigger lobbies use extended maps (see section 5).
- **Session length:** Short rounds with breaks in between

## 3. Game modes
Each mode sets its own rules for respawns and how a round ends.

| Mode (working name) | Lives | How you win | Notes |
|---------------------|-------|-------------|-------|
| **Last Car Standing** | One life | Last car on the map | Classic mode |
| **Bump Frenzy** | Respawns | Most knock-offs when time runs out | Non-stop chaos |
| **Team Bump** | One life or respawns (TBD) | Last team standing, or the team with the most knock-offs | 2 teams |

_These modes are suggestions; mode list not final._

**Choosing a mode:** _TBD:_ the lobby votes, or each player picks a queue

## 4. Core gameplay loop
1. **Break / lobby:** pick a game mode (and map size), then either
   - **spectate** players still in a round, or
   - go to your **garage** to customize and upgrade your car
2. **Round:** ram other players and knock them off the map. Grab random items. The waterfall closes in over time.
3. Earn coins for knock-offs and assists.
4. **Round ends:** get a loot box (a better one for winners, a worse one for losers).
5. Back to the break: upgrade, open or sell boxes, spectate, then queue again.

## 5. World and maps
- **Base map:** a plain, small arena with edges you can fall off
- **Map sizes:** Small (6–12 players), plus extended Medium and Large versions for bigger lobbies
  - Players can **choose** the map size. _TBD:_ by vote, or with limits on size versus player count
- **Shrinking map (waterfall hazard):** waterfalls (or something similar) close in from **randomly chosen areas** of the map over the round, which pushes players together
  - _TBD:_ does touching the waterfall wash you off the edge, or is it just a wall?
- **Art style:** _TBD_

## 6. Combat rules
- **Knock-off:** a player falls off the map. The last player to hit them gets the knock-off.
- **Assist:** any other player who helped knock the victim off (hit them shortly before they fell, for example within ~5 seconds). **Assists count no matter who got the knock-off**, in free-for-all and team modes alike.
  - _TBD:_ in team modes, does knocking off a teammate count?

## 7. Items
- Items spawn randomly around the map and give an advantage to lucky players.
- **Two kinds of item:**
  - **Basic items:** in everyone's spawn pool from the start
  - **Locked items:** more advanced items. A player must unlock them first, by **buying them with coins** or **getting them from loot boxes**.
- _TBD:_ how locked items work in a match. Suggestion: unlocking adds the item to **your personal pool**, so when you pick up a random item box you can roll items you've unlocked. Other players won't roll it unless they've unlocked it too.
- _TBD:_ how strong locked items are. Make them different rather than stronger, so new players aren't crushed.

## 8. Progression

### Car stats and upgrades (in the garage)
- Stats: **top speed**, **acceleration**, **drift**
- Players spend coins to raise **or lower** a stat.
- **Each stat has an upgrade cap, and nobody can max every stat.** This forces different builds.
- Proposed system: each stat goes from 0 to 10, with a **total point budget** of around 15. Lowering one stat frees points for another.

### Coins
- Earned from knock-offs, assists, some loot boxes, and selling boxes or cosmetics
- Spent on stat changes and locked items

### Loot boxes
- Earned at the end of every round. Winners get a better tier, losers a worse one.
- **Open** or **sell** for coins.
- Contents: usually coins. With luck: a **cosmetic** (decoration, color, texture) or a **locked item unlock**.
- Cosmetics have rarity tiers (for example Common, Uncommon, Rare, Epic, Legendary). Rarer items drop less often and **sell for more**.

## 9. Key features

| Feature | Priority | Notes |
|---------|----------|-------|
| Bumper car driving and collision physics | MUST | Bumps need to feel punchy |
| Knock-off and assist tracking | MUST | Assists count regardless of team |
| Round system | MUST | |
| At least one game mode (Last Car Standing) | MUST | |
| Waterfall map shrink from random areas | MUST | |
| Random item spawns (basic items) | MUST | |
| Coins | MUST | |
| Garage with stat upgrades and a budget | MUST | |
| Saving player data | MUST | Coins, stats, inventory, unlocks |
| Break lobby: mode select and spectating | SHOULD | |
| More game modes | SHOULD | |
| Loot box tiers, opening and selling | SHOULD | |
| Cosmetics with rarity | SHOULD | |
| Locked items (unlock with coins or boxes) | SHOULD | |
| Medium and large extended maps | LATER | |

## 10. Monetization (optional)
_Not discussed yet._ If loot boxes are ever sold for Robux, Roblox rules require showing the drop odds.

## 11. Build order
1. **MVP:** driving, bumping, fall-off, Last Car Standing, waterfall shrink, coins, knock-offs and assists, 2–3 basic items, garage stat upgrades, saved data
2. **Second step:** break lobby (mode select, spectating), Bump Frenzy mode, loot boxes and cosmetics
3. **Third step:** locked items, Team Bump, extended map sizes

## 12. Open questions
- Final list and names of game modes
- Mode and map size choice: vote, or personal queue?
- Waterfall: instant wash-off, or a push that slowly drags you to the edge?
- Locked items: personal spawn pool? How strong?
- Team-kill rules in team modes
- Exact rarity drop rates
- Art style
