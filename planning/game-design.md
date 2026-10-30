# Game Design Doc

## 1. The pitch
- **Working title:** _(not decided; see open questions)_
- **One-sentence pitch:** Bumper car battles on a small arena where players ram each other off the edge, grab random power-ups, and tune their car with coins they earn.
- **Genre:** Arena brawler / party knockout with car customization
- **Similar vibe to:** Chaotic item-based kart racing (random items that help lucky or losing players), mixed with bumper cars

## 2. Players
- **Mode:** Competitive, free-for-all
- **Players per server:** _TBD_
- **Session length:** Short rounds. A round ends when one player (or the last few) is still on the map.

## 3. Core gameplay loop
1. Spawn on a plain, small arena in your bumper car.
2. Ram other players and try to knock them off the map. Pick up random items that spawn around the map.
3. Earn coins for knocking players off (a "destroy") and for helping knock them off (an "assist").
4. The round ends. You get a loot box (a better one if you won, a worse one if you lost).
5. Spend coins on upgrades, then open or sell loot boxes.
6. Queue for the next round.

## 4. Progression

### Car stats and upgrades
- Stats so far: **top speed**, **acceleration**, **drift** (more or less grip)
- Players spend coins to raise **or lower** a stat.
- **Each stat has an upgrade cap, and nobody can max every stat.** This forces trade-offs, so builds differ (a speed build, an acceleration build, a drifty build, and so on).
- Proposed system: each stat has levels (for example 0 to 10). The car has a **total point budget** that's smaller than the sum of all maxes (for example 15 points across 3 stats). Lowering a stat frees up points for another one.

### Coins
- Earned from destroys and assists (and from some loot boxes)
- Spent on stat changes
- Earned by selling loot boxes and cosmetics

### Loot boxes
- Earned at the end of every round. Winners get a higher-tier box, losers get a lower-tier box.
- A box can be **opened** or **sold** for coins.
- Contents: usually coins. With luck, a **cosmetic**: a decoration, color, or texture for the car.
- Cosmetics have **rarity tiers**. Rarer items drop less often and sell for more.

## 5. World and setting
- **Map:** One plain, small arena with edges you can fall off
- **Art style:** _TBD_

## 6. Key features

| Feature | Priority | Notes |
|---------|----------|-------|
| Bumper car driving and collision physics | MUST | Bumps need to feel punchy and satisfying |
| Knock-off detection and elimination | MUST | Falling below the arena eliminates you |
| Round system (lobby, play, winner) | MUST | |
| Random item spawns | MUST | Items still to be designed |
| Coins for destroys and assists | MUST | Need a rule for who counts as an assist |
| Stat upgrades with a capped budget | MUST | Speed, acceleration, drift |
| Saving player data | MUST | Coins, stats, inventory |
| Loot box tiers (win and loss) | SHOULD | |
| Opening and selling boxes | SHOULD | |
| Cosmetics with rarity tiers | SHOULD | Decorations, colors, textures |
| Inventory and garage UI | SHOULD | |

## 7. Monetization (optional)
_Not discussed yet._ Note: if loot boxes are ever sold for Robux, Roblox rules require showing the drop odds.

## 8. Minimum playable version (MVP)
- One arena, drivable bumper cars with satisfying collisions
- Fall-off elimination and a basic round loop with a winner
- Coins for destroys and assists, saved between sessions
- 2–3 simple items
- Stat upgrades (speed, acceleration, drift) with a point budget

Loot boxes and cosmetics come in the second build step.

## 9. Open questions
- Game name?
- How many players per round? (6–12 is typical for an arena this size)
- What items? (ideas in the backlog)
- What counts as an assist? (for example, bumping someone within ~5 seconds before they fall)
- Does a round end at "last car standing", or is it timed with the most knockouts winning?
- Does the arena shrink over time to force action?
- Can players respawn, or is it one life per round?
- Are there more loot box tiers than win and loss? (for example 1st, 2nd, 3rd place)
- Rarity tier names and drop rates
- Art style
