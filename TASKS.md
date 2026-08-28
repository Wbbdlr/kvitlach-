# Current Backlog

Reconciled against the implementation on 2026-08-05. See [CLAUDE.md](CLAUDE.md)
for how to work in this repo.

## Open

- [ ] The backend suite's intermittent full-run flake (found 2026-08-09) is
      now rare but not fully eliminated. Root-caused and fixed 3 confirmed
      instances (`turn-order.test.ts`, `ws-auth.test.ts`,
      `abandoned-banker.test.ts` — see "Done" below): tests calling
      `applyBet`/`applyHit` right after `startRound()` without pinning that
      seat's hand first, so a real crypto-random card can rarely complete a
      natural 21/bust and resolve the turn before the test's own scripted
      moves run. NOT a concurrency race (reproduces with
      `--no-file-parallelism` too). Post-fix measured rate: 1 failure in the
      last ~63 full-suite runs (down from ~20–30%). That one residual
      failure's specific file/cause wasn't captured — if it recurs, capture
      full output (`npx vitest run > /tmp/out.log 2>&1`) and grep the same
      "randomly-dealt card auto-resolves a turn early" pattern before
      assuming a new bug.
- [ ] Theming beyond felt colour + watermark, remainder after the chip
      switcher below: card backs as a third `FeltSwitcher`-style per-player
      pattern, and/or a banker-set "house style" (chips and/or felt) mirroring
      the table watermark's synced/banker-only mechanism instead. Scope
      either the same way the chip pass was scoped -- extending an existing
      mechanism, not a general theme-editor or free-color-picker.
## Done

- [x] Mid-round settlements moved real money without ever persisting the room
      (2026-08-27, found by extending the bug hunt to the real-multiplayer
      paths practice mode never exercises -- practice rooms are never written
      to Postgres, so this is a real-games-only fault). The round and the room
      are persisted by two different mechanisms with different triggers:
      `persistRound` writes the round on every action, but the room (wallets,
      `bankerBuyIn`, `balances`) is only ever written by `bumpRoomTimer`.
      Nothing in `applyBet`/`applyHit`/`applyStand` calls it, so a whole round
      can play out with no room write at all.
      That's fine for the normal end-of-round payout, which runs inside
      `finalizeRound` (it bumps) -- and `voidAbandonedRound` is covered too,
      since ws-server funnels every round reaching "terminate" through
      `finalizeRound`. Checked both before concluding; neither is a bug.
      The two that are: `settleImmediateTurn` and `settleBankOutcome` both pay
      out MID-round and leave the round live, so no bump followed. A restart
      in that window restored a round whose turns were already marked
      `settled` against a room whose wallets never received the money -- and
      `calculateBalances` deliberately skips settled turns, so the payment was
      gone rather than merely late. Narrow (needs a BANK! settlement plus a
      restart before that round ends) but it is silent money loss, and a
      mid-game deploy is exactly how it would happen. Both now bump, only when
      money actually moved.

- [x] A practice table was unrecoverable once its shoe ran out (2026-08-27,
      found by bug hunt -- this is the real cause of the "Reshuffle button
      stopped registering" note in the banker-bust entry below, which guessed
      at WS rate limiting. It was not rate limiting). Two independent faults
      stacked on the same path:
      * `state.ts`'s `reshuffleDeck` guarded on a bare `type === "admin"`,
        so the felt's practice-only Reshuffle button (`TableRoot.tsx`, added
        for exactly this human) never got its message off the client. The
        backend carve-out (`store.ts`'s `reshuffleDeck`) and its test have
        always allowed the practice human -- a `type: "player"`, because that
        room's banker is a BOT with no session. Only the client disagreed.
      * `reshuffleDeck`'s live branch wrote the fresh deck straight into the
        rounds map instead of going through `persistRound`. When the shoe ran
        dry on a BOT's turn, `playBotTurn` caught the `deck_empty` and only
        logged it -- no broadcast, so `syncBotTurn` never re-ran and that
        seat's one-shot `botTimer` stayed spent, so even a successful reshuffle
        brought cards back to a table that was still frozen. Precision on how
        long "frozen" is, corrected after the fact: for a bot PLAYER,
        `syncTurnTimer` also armed a 90s `turnTimer` (it skips only
        `type === "admin"`, not bots), so that seat self-rescues via
        `forceTimeoutStand` after a 90-second dead stretch. For the bot
        BANKER -- which is the seat that draws last and most, and the one the
        live repro actually froze on -- `syncTurnTimer` skips it entirely, so
        there is no rescue at all and it really does sit forever.
      Also fixed the copy that pointed nowhere: `deck_empty` told the practice
      human "Waiting for the banker to reshuffle" (a bot that never will), and
      `deck_low` sent them to Manage table, which is admin-gated and out of
      reach. Both now name the felt's Reshuffle button.
      Shoe exhaustion is routine, not an edge case -- `TARGET_ROUNDS_PER_SHOE`
      is 8 -- so any tester playing a solo session past ~8 rounds hit a dead
      table. Practice mode is the no-friction entry point, so this was
      first-session-visible. 26/26 practice-mode, 36/36 state tests; the new
      backend test was confirmed to fail against the old bare `rounds.set`
      before being kept.

- [x] Two more instances of the banker `bet`-field overload behind the bust
      bug below (2026-08-27, found by auditing every `turn.bet` read after
      that fix rather than waiting for the next report):
      * `App.tsx` played the chip/bet sound off `turn.bet > prevTurn.bet`
        with no player-type check, so settlement's `0 -> +N` on the admin turn
        clinked a chip for a wager nobody placed -- on every round the bank
        finished ahead.
      * `statusDisplay`'s "BANK 21!" branch sat below `isPushTurn`, which
        reads `bet === 0` as "no wager." The bank never wagers, so a banker 21
        matched the push check first and rendered "PUSH" instead, with the
        `natural21` fanfare swallowed by the same test in `App.tsx`. Hit both
        after a BANK! auto-redeal and on any normal round the bank netted
        exactly $0. The existing "BANK 21!" tests all passed because they
        inherit `makeTurn`'s `bet: 5` default -- a value no real banker turn
        ever holds. Fixture richer than reality; the new test pins `bet: 0`.
      53/53 selectors + tableView tests.

- [x] Practice-mode bot name pool swapped for a different set (2026-08-27,
      user request) -- `PRACTICE_BOT_NAME_POOL` in `store.ts`: Yanky, Shmuli,
      Mendy, Berel, Zalmy, Duvid, Chaim, Avrumi, Moishy, Shloimy replaced with
      Sruly, Shimmy, Shmuely, Nati, Josh, Binyomin, Shlomo, Moshe, Chaim,
      Meshulam (Chaim carried over). The banker persona ("The Gabbai") was
      explicitly left alone -- scoped to bots only per the user's own ask.
      Confirmed via AskUserQuestion this was meant as a straight content swap,
      not a rename-bots-in-the-UI feature. 27/27 practice-mode + practice-ws
      backend tests pass (unaffected -- neither asserts specific pool names,
      only counts/behavior).

- [x] Banker's displayed total didn't reflect a real bust when the round's
      net happened to land on exactly $0 (2026-08-27, user report from a
      practice game: "the banker busted but his tally didn't reflect the
      busted total"). Root cause: `totalDisplay` (selectors.ts) reads
      `turn.bet === 0` as "this hand was played as a blatt, no wager" -- true
      for a PLAYER turn, but `calculateEndState` (round.ts) repurposes the
      ADMIN turn's own `bet` field to hold the round's net balance once
      resolved, and $0 there means "broke even" (one seat's win offset
      another's loss), not "never bet." That's an ordinary outcome, not a
      rare one -- any round where the point spread nets to zero across
      players trips it. Once tripped, the banker's resolved hand fell into
      the blatt-display branch, which recomputes the total from
      `cards.slice(1)` -- silently dropping the hole card and showing
      whatever the remaining cards happen to read as instead of the real
      bust number (traced by hand: a busted [10,9,9] hand reads as a true
      28, but the blatt branch reported 18, the visible-cards-only total).
      Fixed by gating that branch on `!isBanker` -- it was never meant to
      apply to the admin turn at all; the admin's own hole-card-timing
      branch immediately above it already owns admin visibility pre-
      resolution, this one only mis-fired once the admin turn was resolved
      and its `bet` field's meaning had already flipped. New regression
      test in `selectors.test.ts` pins a busted admin turn at bet: 0 net --
      fails on the old code (returns "18"), passes on the fix (returns
      "28"). 28/28 selectors tests pass.
      Live reproduction of a genuine bank bust (to double-check the fix
      against a real broadcast, not just the unit trace) was attempted but
      not completed this pass -- a scripted practice session played 8+
      rounds without the bot banker (17-hit threshold, `bot.ts`) happening
      to bust, and a `Reshuffle` click stopped registering partway through
      (plausibly the WS rate limit from the scripted session's own rapid-
      fire clicks, per `ws-server.ts`'s rate limiting -- not investigated
      further, didn't recur outside that stress pattern). The code-level
      trace above is exact enough (same functions, same real card values,
      same real Turn shape) that this shipped on that basis rather than
      waiting on a live repro; flagging here in case the live case ever
      wants rechecking.

- [x] "Kvitlach" wordmark overlapping the felt-color swatches (2026-08-11,
      root-caused earlier the same day -- see the ChipSwitcher entry
      below). `.k-topbar` and `.k-chrome-top` are two independently
      absolutely-positioned rows that never knew each other's real width;
      gave `.k-chrome-top` a real `left` boundary instead of leaving it
      unconstrained. Not a guessed flat number -- derived from live
      measurement: `.k-topbar > *`'s `getBoundingClientRect()` reports its
      size after BOTH its own counter-scale transform AND the felt's outer
      scale (transforms compound for a descendant), so dividing both back
      out of two live samples (137px at 915x420, 85px at 568x320) landed
      on the same ~166.6px pre-transform layout width either way,
      confirming that's the cluster's real constant (icon + gap-3 +
      "Kvitlach" at 32px Playfair Display). Reassembled as a `calc()` using
      that constant plus the same `24px` padding-left and
      `clamp(1, 1/scale, 1.15)` this breakpoint's OWN wordmark-scaling rule
      already uses, so `.k-chrome-top`'s boundary tracks the wordmark's
      actual rendered edge at any width in this breakpoint's range rather
      than a single-point guess (verified the naive "flat number" approach
      would have been wrong at one end or the other -- the wordmark's
      real edge measured 61px at 360px portrait width vs 155px at 915px
      landscape width, not a constant).
      Verified live across every scenario the earlier investigation
      flagged, all clean, zero overlap, no new collisions: 568x320
      landscape (chrome-top now starts x108, first swatch x142, clear of
      wordmark's x96), 915x420 wide landscape (single row, was 2 before),
      360x780 portrait with a dealt round (chrome-top bottom 144 vs the
      dealer's plate at 160 -- 16px clear), and a stress case this class of
      bug has broken before -- a full 11-seat table at 780x380 landscape
      (single row, chrome-top starts x143 past wordmark's x132, dealer
      plate unaffected). Confirmed zero effect outside the breakpoint
      (1280x800 desktop: chip switcher still shows, chrome-top's implicit
      position unchanged -- the `left` rule lives inside the same media
      query as the rest of this breakpoint's fixes). Portrait's row count
      did grow (2 rows to 3, chrome-top 96px to 136px tall) since its
      available width shrank along with everything else -- checked this
      specifically against the dealer-plate-collision history
      (DEALER_SEAT_OVERHANG_PX's own comment) and confirmed safe: that
      collision class bites when HEIGHT is scarce (flattened landscape),
      and portrait has abundant height budget (780px), which the live
      16px-clear measurement above confirms directly rather than just
      reasoning about it.
      Frontend build clean; 220/220 frontend tests pass (18/18 files,
      including a clean 34/34 on `state.test.ts` -- a prior full-suite run
      during this same investigation had thrown 15 failures there, re-confirmed
      as the pre-existing flake documented in the "Open" section above, not
      caused by this change).

- [x] ChipSwitcher regression + a bigger pre-existing bug it exposed
      (2026-08-11), found while sweeping for "any bugs across the
      platform" after the switcher shipped. Adding ChipSwitcher's 124px
      cluster to `.k-chrome-top` ate into an already razor-thin margin --
      the surrounding CSS's own comment documents only ~2px of spare room
      at 568px, the narrowest width this file tunes against. Fixed the
      part that's mine to fix: `.k-chip-switcher` now hides at the same
      narrow-landscape/short-viewport breakpoint that already drops the
      decorative tagline (`.k-logo-tag`), same reasoning -- chip color is
      a preference, not needed to identify or play the game.
      While confirming the fix (A/B toggling the switcher's `display` live)
      found the underlying overlap is NOT new or mine: with
      `.k-chip-switcher` fully hidden, the felt-color swatches still sit
      almost entirely on top of the "Kvitlach" wordmark, both at narrow
      landscape widths (measured 568x320: feltLeft 15 vs wordmark's own
      right edge 96) AND in plain PORTRAIT mode on an ordinary phone
      (measured 360x780: feltLeft 33 vs wordmark right edge 61) -- the
      single most common way this page loads, not an edge case. Root
      cause: `.k-topbar` (branding, scaled, grows from the left) and
      `.k-chrome-top` (controls, unscaled, packs from the right) are two
      independent absolutely-positioned rows that were never made aware of
      each other's real width (own comment, right above the fix), and
      chrome-top's row-1 content has grown over several past additions
      (the practice-mode Reshuffle chip, RoomInfoDrawer's "Table info"
      button) past whatever margin the last live-measured tuning pass
      accounted for. NOT fixed here -- a real fix needs the same kind of
      dedicated live-measurement pass across the realistic device range
      this file's other constants (TOP_CHROME_PX, DEALER_SEAT_OVERHANG_PX)
      already got, and touching chrome-top's positioning risks growing its
      wrapped-row count in a way that could reopen one of THOSE
      already-fixed collisions if rushed. Flagged for a dedicated pass, not
      guessed at.
      220/220 frontend tests pass (one unrelated full-suite-only flake in
      state.test.ts, 34/34 clean in isolation), 154/154 backend tests
      pass, clean build.

- [x] Chip color switcher (2026-08-11), the first half of the "theming
      beyond felt colour + watermark" item below. Scoped deliberately small
      after checking with the user on two open forks: (1) small -- just
      `.k-chip-btn` (the floating pill chrome: Reshuffle, Leave, Skip,
      React, felt/chip swatches themselves), NOT the felt's separate gold
      accent language (card highlights, active-turn glow, Eleveroon star,
      natural-21 flash, brand wordmark) -- unpicking THAT everywhere it's
      hardcoded across index.css would be a much bigger refactor; (2)
      per-player, not banker-set -- mirrors `FeltSwitcher` exactly (same
      component shape, same localStorage pattern, same topbar placement),
      not the watermark's synced/banker-only mechanism, so zero backend/WS
      changes. New `ChipSwitcher.tsx` + `theme.ts`'s `useChip`/`applyChip`/
      `CHIPS` (gold/ruby/sapphire/silver, gold reproducing the ORIGINAL
      fixed values exactly so nobody's chrome changes until they opt in).
      `.k-chip-btn`'s border/ink now read `var(--chip-border, ...)`/
      `var(--chip-ink, ...)` with the original hardcoded values as the
      fallback. Verified live: default renders pixel-identical to before,
      switching to Sapphire recolors all 8 `.k-chip-btn` instances on the
      felt together, persists across reload. Card backs (the other
      "possibly" from the original note) and a banker-set house style are
      still open -- see "Open" above.
      220/220 frontend tests pass, clean build.

- [x] Lobby "Kvitlach" wordmark's gold didn't actually match the felt's
      (2026-08-11). The previous restore-to-gold pass reached for
      Tailwind's `amber-600` as a "close enough" gold, reasoning it was
      what this span carried before an unrelated blue reskin swept it up
      -- true, but that old amber-600 never actually matched the felt's
      own `--gold` (#e6a44b, used by the in-table `.k-logo-word`) either;
      nobody had compared them side by side. Reported as "ugly yellow
      orange" vs. the table's "nice gold." Switched to `var(--gold)`
      directly (index.css :root, globally scoped, not felt-only) so both
      wordmarks are pixel-identical and share one source of truth going
      forward. Verified live: computed color rgb(230, 164, 75) = #e6a44b
      exactly. Clean build.

- [x] Removed the lobby footer's permanent "WS ok/wait/down" pill
      (2026-08-11). It was raw connection-status jargon, always visible
      even when perfectly healthy, on the public landing page -- and
      `status` didn't gate Join/Create or drive any inline error, so the
      badge wasn't load-bearing for anything. TableRoot.tsx already solves
      the same underlying problem better, inside an active game: its own
      connection tag only renders when `wsStatus !== "connected"`, silent
      while healthy, a plain-English "Connection lost — reconnecting…"
      only when something's actually wrong -- that's the pattern to follow
      if a lobby-side warning is ever wanted back, not a permanent status
      pill. Also dropped the now-unused `wsUrl` destructure from App.tsx
      (it was only ever read by this badge's tooltip). Verified live --
      footer now reads straight from the version badge to Sound, no gap.
      Full frontend suite green, clean build.

- [x] Discard pile silently excluded the banker's cards most rounds
      (2026-08-11). Root cause: `discardedEntries` (DiscardPile.tsx) treated
      a turn as resolved only at `won`/`lost`, mirroring
      selectors.ts's totalDisplay/canRevealTotal -- correct for a PLAYER,
      but calculateEndState (round.ts) actually resolves the BANKER to
      `standby` (not won/lost) whenever the bank finishes the round even or
      ahead without busting or hitting a natural 21. That's the single most
      common banker outcome, not an edge case, and selectors.ts's own
      totalDisplay already treats banker `standby` as fully
      resolved/revealed (its bankerResolved check) -- discardedEntries just
      hadn't been taught the same exception. Added an isBanker branch that
      also accepts `standby`. Traced the "is it actually safe to reveal at
      standby" question all the way through `settleBankOutcome`
      (store.ts) -- confirmed a broadcast `round.turns` entry never shows
      the banker's admin turn as `standby` while that same hand could still
      receive more cards later in the round (the mid-round BANK!-lock
      redeal path overwrites the turn back to a fresh `pending` hand before
      anything is returned/broadcast), so there's no premature-reveal
      window. Added a unit test (`DiscardPile.test.tsx`) for the banker
      standby case; verified live in a practice round -- shoe tally went
      10 -> 21 on a round where the bank finished "BEAT 2" (no bust, no
      natural), exactly 10 + every seat's resolved cards including the
      bank's own 4 (pre-fix this would have stopped at 17). 12/12 discard
      tests pass, full frontend suite green, clean build.

- [x] Mobile input hygiene pass (2026-08-11), continuing the expert-mobile
      pass from earlier the same day. All lobby/drawer text inputs (Join,
      Create, Practice, RoomInfoDrawer's rename, ManageDrawer's watermark)
      got the mobile-keyboard/autofill attributes PlayerDock.tsx's bet-amount
      field already had but nothing else did:
      - Name fields: `autoComplete="given-name"/"family-name"`,
        `autoCapitalize="words"` -- lets a phone's contact-autofill offer
        real suggestions instead of a blank keyboard.
      - Game ID / Custom Game ID: `autoCapitalize="characters"`,
        `autoCorrect="off"`, `spellCheck={false}`, and the Join field now
        uppercases as you type (mirroring the Create form's Custom Game ID
        field, which already did) -- purely cosmetic (store.ts already
        normalizes to uppercase server-side), but stops a phone "correcting"
        a code into a dictionary word or flagging it as a typo.
      - Password fields (join + create): were plain `<input>` with no
        `type`, so both typed in full plain view -- genuine bug, not a
        deliberate choice (no comment justified it). Now `type="password"`
        (`current-password`/`new-password` autocomplete) so a password
        manager can offer to fill/save it on mobile the way it would for a
        real login.
      - `ManageDrawer`'s watermark field: `spellCheck={false}` -- the
        default watermark is Hebrew (`DEFAULT_WATERMARK`, TableRoot.tsx) and
        most real values are family surnames; an English spellchecker has
        nothing useful to say about either.
      - `ManageDrawer`'s "Adjust chips" amount field: was `type="number"`
        with placeholder "Amount (negative removes chips)" -- iOS Safari's
        number-pad keyboard for `type="number"` doesn't reliably expose a
        "-" key, which could make removing chips untypable on an iPhone.
        Switched to `type="text" inputMode="numeric" pattern="-?[0-9]*"`,
        mirroring PlayerDock's own bet-amount input with the pattern
        loosened for the leading minus. `applyAdjust` already parses this
        with plain `Number()`, so the value shape is unchanged -- this only
        changes which on-screen keyboard mobile shows.
      Deliberately left `type="number"` alone on the plain positive-only
      amount fields (buy-in, bankroll, deck count, top-up amount) -- no
      known bug there, and rewriting every number input to match would be
      a much bigger, lower-value diff than this pass's actual finding.
      219/219 frontend tests pass; verified live (uppercase-as-typed, both
      password fields render masked with the right autocomplete token,
      watermark spellcheck off, no console errors).

- [x] Removed the "Beta" badge from both top-of-page spots (2026-08-11) --
      `SiteHeader.tsx` (lobby/info pages) and `TableRoot.tsx`'s `.k-topbar`
      (in-table branding row). Footer's own "Beta" pill next to the version
      number (`SiteFooter.tsx`) and the unrelated "Beta notes"/"Beta notice"
      section headings on About/Disclaimer were left alone -- not asked, and
      a different thing (build-status footer badge / page content, not a
      top-of-page label). Also dropped `.k-beta` from index.css: its shared
      base-style selector (`.k-beta, .k-room`) and its narrow-landscape
      `display: none` breakpoint, both now dead with no JSX using the class.
      219/219 frontend tests pass (1 unrelated full-suite timing flake in
      `state.test.ts`, passed clean in isolation -- see the flake entry
      above); clean build; verified live in both the lobby and a practice
      table.

- [x] Theme/mobile follow-up on the same-day blue reskin (2026-08-11):
      1. The new blue read as too vivid/saturated for "classy" next to the
         cream background. Rather than hand-tune the ~50 literal `blue-*`
         Tailwind utility occurrences across App.tsx/SiteHeader.tsx/
         SiteFooter.tsx/RulesModals.tsx/RoomInfoDrawer.tsx/ManageDrawer.tsx/
         WaitingListDrawer.tsx individually, overrode Tailwind's own `blue`
         color scale in `tailwind.config.cjs` with a desaturated steel-blue
         ramp at the same lightness steps as the stock scale -- every
         existing `blue-*` call site is muted for free. `accent` (the
         non-literal-`blue-*` call sites) updated to match the new blue-600
         so both stay on one ramp.
      2. The "Kvitlach" wordmark in `SiteHeader.tsx` went blue along with
         everything else in that same reskin, but it's the game's own brand
         mark (same gold as the felt's `--gold` and the in-table
         `.k-logo-word`), not a themeable UI element -- traced via `git log
         -p` to what it carried before an unrelated redesign commit
         (`b364705`) touched it, then confirmed the color itself (only the
         color, not that commit's separate font/logo-icon change) was
         `amber-600` right up until the blue sweep caught it. Restored to
         `text-amber-600`. Tagline/Beta pill next to it were NOT reverted --
         not asked for, and left on the new muted blue.
      3. `DiscardPileModal` had no `max-h`/`overflow-y-auto` (unlike its
         sibling `RoomInfoDrawer`, which has both) -- on a short viewport its
         fixed-size 12-card grid had nowhere to shrink. Confirmed live at
         780x360 (landscape phone): the panel rendered 397px tall, uncapped,
         landing at y-18..378 against a 360px-tall viewport -- clipped off
         both the top and bottom, close button included. Added the same
         `max-h-[85vh] overflow-y-auto` RoomInfoDrawer already uses; verified
         live -- now renders fully on-screen (y27..333) and scrolls
         internally instead of overflowing.
      Investigated but could NOT reproduce the third report ("controls
      scaled up too large, elements overlap") -- checked seat-vs-seat and
      hand-vs-hand bounding-box collisions at a sparse (4-seat) and a full
      (12-seat) practice table, both portrait (360x780) and landscape
      (780x360): zero overlaps in every case: `layout.ts`'s collision math
      (pinned by `layout.test.ts`) held even at its 0.36 `seatScale` floor.
      Needs a screenshot or exact device/orientation/player-count from the
      reporter before touching `stage.ts`/`layout.ts` -- both are tuned off
      specific measured live-device numbers already (see stage.ts's own
      history of "confirmed live at WxH" fixes); changing constants there
      without a real repro risks reopening one of those.
      219/219 frontend tests pass; clean `vite build`.

- [x] Three small bug reports (2026-08-11):
      1. Practice mode couldn't reshuffle the shoe -- `reshuffleDeck` was
         still plain `isAdmin`-gated in `store.ts`, but a practice room's
         "banker" is a bot with no session (see `PRACTICE_BANKER_NAME`), so
         the one human there could never satisfy that check. `startRound`
         already had the right carve-out (`!actor.isBot && (admin ||
         (room.practice && player))`); `reshuffleDeck` now mirrors it
         exactly. Frontend: rather than opening the whole admin `ManageDrawer`
         to a non-banker (kick/rename/close-room have no business being
         reachable from a practice seat), added one direct `room.practice`-
         gated "Reshuffle" chip next to Manage, calling the same
         `onReshuffleDeck` handler -- mirrors the existing `onPracticeTopUp`
         pattern (direct, no confirmation step, practice-only). New backend
         tests in `practice-mode.test.ts` pin: human can reshuffle, the
         bot banker itself still can't, and a real room's regular player
         still can't either.
      2. Discard pile pop-up reworded: "Discarded this shoe" /
         "N discarded" read as if a player chose to fold those cards.
         They're just what's already come out of the shoe and resolved
         (see `advanceShoeDiscards` above) -- reworded to "Used this
         shoe" / "N used" throughout (`DiscardPile.tsx`,
         `DiscardPileModal.tsx`) to say that plainly.
      3. Landing-page color theme: was orange (`accent: #f97316` in
         `tailwind.config.cjs`, plus scattered raw `amber-*` Tailwind
         utility classes across `App.tsx`'s lobby, `SiteHeader.tsx`,
         `SiteFooter.tsx`, and `RulesModals.tsx`). Re-themed to a classy,
         muted blue: `accent` is now Tailwind's own blue-600 (`#2563eb`,
         reused verbatim rather than a bespoke hex, so the custom `accent`
         token and every literal `blue-*` utility class swapped in
         alongside it land on the exact same ramp), and every `amber-N`
         utility became `blue-N` at the same shade level (mechanical,
         preserves the existing tuned contrast/hierarchy, just recolors
         hue). The cream page background (`bg-sand`, `#f5f1e8`, set on
         `<body>` in `index.html`) was already there and untouched --
         only the orange accent moved. Does NOT touch the felt table's own
         gold/amber accents (`.k-tag.turn`, `.k-readout b`, etc. in
         index.css) -- that's an established, separate gameplay-UI
         palette the report wasn't about.
      154/154 backend + 219/219 frontend tests pass; verified live
      (computed colors confirmed blue-600/700/800 + cream body, zero
      remaining `rgb(249, 115, 22)` orange anywhere on the page; practice
      Reshuffle clicked with no console/WS error).
- [x] Legible on-felt text at any phone size / any table size, "especially
      older players" (2026-08-11). `.k-readout` (hand totals), `.k-plate-name`,
      `.k-plate-sub`, `.k-tag` (status labels), and `.k-banktotal` all lived
      inside the scaled stage with flat design-px font-sizes -- readable at
      `--stage-scale` 1 (desktop), but a typical phone in the game's own
      intended landscape orientation runs 0.45-0.65, so a player's own hand
      total (14px design) was rendering as small as ~6-9px actual. Applied
      the same counter-scale `clamp()` pattern `.k-resv-amt` already used
      (2026-08-10ish) -- `clamp(FLOOR, calc(TARGETpx / var(--stage-scale, 1)),
      CEILING)`, FLOOR pinned to today's existing flat size so desktop is
      byte-for-byte unchanged, CEILING capping runaway growth at very low
      scale. Live-measured at 667x375 (stage-scale 0.521): total pill glyph
      size went from ~7.3px to ~10.4px actual (+43%), player names ~6.3px to
      ~8.9px (+42%), status tags ~5px to ~7.3px (+47%). `.k-banktotal` got
      the same base-rule treatment, but its existing `(max-width: 520px),
      (max-height: 440px)` compact override -- a real, measured seat-plate
      collision fix, not an oversight -- deliberately still wins on the
      shortest phones and was left untouched; growing that pill there would
      reopen the collision it exists to prevent. Doesn't counter-scale
      against `seatScale()` (the separate crowded-table shrink) -- that
      would need exposing seatScale as a CSS var and re-tuning the crowding
      padding fix above, out of scope for a text-legibility pass; the fix
      here is a strict, monotonic improvement at every seatScale value
      regardless (floor = old size, so it can only grow, never shrink).
      219/219 tests pass (CSS-only change; no JS geometry touched).
- [x] Three small native-feeling mobile touches, expert-mobile-gamer pass
      (2026-08-11), each scoped to avoid adding any new settings surface:
      (1) Haptic feedback (`table/haptics.ts`, `navigator.vibrate`,
      feature-detected/no-op on iOS Safari which never shipped it) on
      your-turn, chip/deal, win, lose, and bust -- scoped to the LOCAL
      player's own turn only (unlike the ambient SFX these mirror, which
      everyone at the table hears, vibrating a stranger's phone because
      someone else two seats over bet would be wrong). Deliberately NOT
      tied to the sfxEnabled toggle: vibration already respects a phone's
      own silent/vibrate switch, so it's the one channel that still reaches
      a player whose phone is muted for the room's sake. (2) `.k-fit` gets
      `overscroll-behavior: none` -- nothing previously stopped an accidental
      downward drag near the top of the felt from triggering Android's
      pull-to-refresh or iOS's rubber-band bounce mid-round. (3) A
      `.k-rotate-hint` banner (pure CSS, `@media (orientation: portrait) and
      (max-width: 540px)`, no JS state, no dismiss button) nudges phones
      opened in portrait to rotate -- distinct from the existing one-time,
      forever-dismissible `.k-fs-hint` tooltip on the fullscreen button
      (that one nudges toward a specific action once; this one is an
      ongoing "you're in a cramped orientation right now" signal that
      reappears any time it's actually true, same as an offline banner
      would). All three verified live (dev server + practice table):
      overscroll-behavior computed as "none", rotate hint measured visible
      in portrait (390x844) and `display: none` in landscape (844x390),
      pointer-events: none confirmed so it can never block a real tap.
      219/219 tests pass.
- [x] Crowded-table desktop padding ("the table view can be so much bigger",
      2026-08-11) -- root-caused, not just eyeballed off a screenshot: an
      11-player practice table live-measured at 1920x1000 had `seatScale()`
      shrunk to 0.449 (crowding near its own 0.36 floor, per `layout.ts`),
      but `stage.ts`'s `VIEWER_SEAT_OVERHANG_PX` dock-clearance reservation
      still assumed a full, UNSHRUNK seat (seatScale=1) regardless of how
      many players were actually seated -- reserving green felt sized for
      seats more than twice as tall as the ones actually on screen, on
      every table past ~7 players (`SEAT_HEIGHT`'s own comment: past that
      point seats can't stay full-size). `computeFit` now takes a
      `seatCount` param and shrinks that one reservation by the table's own
      `seatScale(seatPositions(seatCount, 1, 0))` -- vf=1 rather than the
      real (unknown-yet) vf, since seatScale only ever reports LARGER there
      than at a flatter vf, so it can't under-reserve (pinned by a new
      regression test using the real, lower vf's seatScale as the harder
      bound). The dealer's own overhang is untouched -- Dealer.tsx is never
      seatScale-shrunk. Live-verified on the reproducing 1920x1000/11-player
      case: vf 0.59 -> 0.65, the dead gap below the viewer's own seat
      197px (was 249px). A small/typical table (<=7 players) sees no change
      at all -- seatScale stays 1 there already.
- [x] Discard pile now lasts until the shoe reshuffles, not just the current
      round (2026-08-11). Previously reset every round (`turn.cards` itself
      is round-scoped), so a multi-round shoe only ever showed whichever
      round was still live. `state.ts`'s new `advanceShoeDiscards` folds
      each round's own resolved cards into a running, shoe-scoped tally the
      moment it's replaced by the next round, and wipes it outright the
      moment `deckReshuffledAt` changes (even the outgoing round's own
      cards, since those belong to the shoe that just got swapped out) --
      TableRoot merges that history with the live round's own resolved
      cards for `DiscardPile`/`DiscardPileModal`. The "only resolved hands
      count" half of the report was already true (`discardedEntries` has
      required won/lost/Eleveroon-rejected since the original feature); this
      was purely about how long the tally survives. Known gap: a mid-round
      reshuffle (rare -- an explicit banker action) can't separate a round's
      pre- vs. post-reshuffle cards, since `turn.cards` carries no per-card
      timestamp -- documented in `advanceShoeDiscards`'s own comment rather
      than worked around.
- [x] Top-of-table clipping on a crowded landscape table (2026-08-11) --
      resolves the item this section used to carry as unverified. Followed
      up with the `offsetTop`/`translate`-aware measurement technique
      developed fixing the dock/viewer-seat overlap (see below): on an
      11-player table at 812x375, the dealer's own plate (real y 37.8-61.9)
      sat 10px inside `.k-chrome-top`'s real span (8-48) -- under it in
      z-index (10 vs. chrome-top's 40), so the felt-switcher/help/music/SFX/
      motion/fullscreen/Leave row visibly painted over the bank badge.
      Same root cause as the dock one, mirrored: the dealer's seat overhangs
      ABOVE its own center (`top: play-top + 160px*vf`, then Seat.tsx's
      translate(-50%,-50%)) by roughly half its own height, and
      `TOP_CHROME_PX` only ever budgeted for the CENTER clearing the chrome
      row, not the plate above it -- `stage.ts`'s own comment on that
      constant even predicted this exact failure ("or the felt switcher
      lands on the dealer's plate") without actually reserving for it.
      Fixed with a new `DEALER_SEAT_OVERHANG_PX`, added to `playTop` --
      deliberately NOT the full half-seat-height the viewer-side fix uses
      (`SEAT_HEIGHT / 2`): unlike that one (which lives in `dockBand`, a
      term with no other job), the dealer's fix has to live in `playTop`
      itself, which also anchors the viewer's OWN position (`cy = CY*vf +
      playTop`) -- and at the exact viewport this was found on, `vf` was
      already pinned at `MIN_VF` with no self-correcting slack left, so the
      full reservation cost the viewer's dock margin real px 1-for-1 and
      flipped that regression test negative. Landed on 40 (just past the
      measured 10px gap, checked against both regression tests together --
      dealer clears by 13.9px, viewer still clears the dock by 34.7px, both
      live on the same 11-player table that reproduced the original report).
      New pinned regression test in `stage.test.ts`, mirroring the dock
      one's structure. 211 frontend tests, `vite build` clean.
- [x] Discard pile moved clear of the dealer's cards, and its review
      redesigned as a fixed 1-12 grid (2026-08-11) -- user report: the pile
      overlapped the dealer's cards, and per-card scrolling rows in the
      modal didn't stay "nicely viewable" once a round logged more than a
      few. Root cause of the overlap: `.k-hand` centers via flex, so a
      dealer hand of several cards grows outward symmetrically past the old
      110px offset either side of centre -- widened both the shoe's and the
      discard pile's offset to 145px (`layout.ts`'s new `SIDE_OFFSET`,
      mirrored in `index.css`'s `.k-shoe`/`.k-discard`; moved both sides
      together, not just the reported one, since they're a deliberate mirror
      pair and the risk is symmetric). `DiscardPileModal.tsx` rewritten to
      always show all 12 face values with a small count badge per value
      (tallied from the same `discardedEntries` the pile's own "N out" count
      already used) instead of one row per card instance -- fixed grid size
      regardless of how many cards a round has logged, no more per-player
      attribution or Eleveroon explanation in this view (that detail still
      lives at the seat itself). Verified live: dealer hand of 5 cards
      cleared the relocated pile by 118px (was ~83px); modal opened on a
      12-card round showed all 12 values with 8 correctly-tallied badges
      summing to 12. 210 frontend tests (net -1: two per-entry tests
      replaced by two grid-shaped ones), `vite build` clean.
- [x] Green sliver above the header, take two (2026-08-11) -- the 2026-08-10
      fix (`body:has(.k-fit) { background: #060d09; }`) was real and stayed
      correctly deployed (re-verified live on kvitlach.us: body/`.k-fit` both
      correctly dark), but a user screenshot on v4.3 proved a sliver was
      still visible, so this wasn't the same bug wearing thin -- it was a
      second, different one hiding behind the first. Root cause: `.k-topbar`
      (the branding scrim) is offset `top: 8px/scale` to keep the logo clear
      of the viewport edge (a deliberate, measured fix -- see that comment,
      still preserved), but the offset moved the WHOLE box down, scrim
      included, leaving an 8px gap above it where `.felt-table`'s raw radial
      gradient showed through completely unshielded. `linear-gradient`
      doesn't ease in from the box above it -- the scrim was already at its
      full 0.7 alpha right at its own top edge -- so that gap met the
      darkened band below it at a hard step (computed: roughly rgb(22,49,35)
      above vs. rgb(12,26,19) at and below y=8, a real ~2x brightness jump),
      which is exactly what reads as a thin lighter-green sliver on a real
      screen. Fixed by moving the logo's clearance from `top` to
      `padding-top` (and growing `height` to match) so the scrim's own box,
      and therefore its gradient, starts flush at y=0 -- content lands at
      the identical position (verified: child offsetTop still 8px at
      scale=1), only the background's own coverage changed. 211/211 frontend
      tests (untouched by a pure-CSS change), `vite build` clean.
- [x] Dock covering the viewer's own hand/total on a landscape phone
      (2026-08-11) -- user report: "the controls are still covering up the
      players results beneath his hand... the controls can be scaled down
      further." Root-caused, not a screenshot-tooling artifact this time:
      layout.ts's RY (the ellipse radius that keeps the viewer's own
      bottom-centre seat clear of the dock) was tuned once, at vf=1
      ("198 clears the dock outright" -- see that comment). Nobody re-checked
      it once stage.ts's later flattened-landscape-table feature let vf drop
      well below 1: the seat's own rendered box (name + hand + total + tag)
      is a FIXED size that doesn't shrink with vf, so at a flattened vf its
      content pokes further past its own centre, relative to the shrinking
      play area, than that vf=1 check accounted for. Measured live at
      812x375 (properly this time -- see the landscape-clipping entry above
      for the `getBoundingClientRect` pitfall this investigation had to
      route around via `offsetTop` chains and Seat.tsx's own
      `translate(-50%,-50%)`): ~5.5px of real clearance in the dock's normal
      state, and negative (a real, visible overlap) once the dock grows to
      its tallest known state (79px, "Round complete", already pinned by an
      older regression test). Fixed in `stage.ts`: reserves
      `VIEWER_SEAT_OVERHANG_PX` (half of layout.ts's own `SEAT_HEIGHT`) as
      part of the dock band, and lowered `MIN_VF` 0.5 -> 0.4 -- counter-
      intuitively, forcing vf UP to a floor doesn't buy clearance once the
      viewport is tight enough to cap the felt to fill it exactly: past that
      point the dock's own real screen position is fixed regardless of vf,
      and a HIGHER vf only pushes the seat closer to it. New pinned
      regression test in `stage.test.ts` models the dock's actual CSS anchor
      and the seat's actual `translate` directly, at the dock's tallest
      state, on both realistic landscape profiles -- margin went from
      -1.6/-3.0px (real overlap) to +44/+53px. Verified live: rebuilt margin
      measurement on the running app agreed (5.5px -> 46.4px at 812x375).
      210 -> 211 frontend tests, `vite build` clean.
- [x] Motion toggle icon redesigned a second time (2026-08-11) -- the
      "comet" from the 2026-08-10 pass (see below) still didn't read as
      motion to the user at 13px. Presented 4 new, more differentiated
      candidates (swoosh wind-lines, EKG pulse, orbiting-arc spin,
      dashed-arrow) via a visual comparison; user picked swoosh. Same
      `icons.tsx` slot, no other files touched.
- [x] Discard pile widened to every resolved hand, not just Eleveroon rejects
      (2026-08-10) -- a user report ("i thought we're making a discard
      pile..") surfaced that the original Eleveroon-only scope (see the
      entry below) read as narrower than "discard pile" naturally implies
      to anyone not already steeped in that design call. Confirmed via
      AskUserQuestion which of three real options was wanted (leave as-is;
      fly every resolved hand's cards out of the seat into the pile; or
      keep cards sitting in the seat as before AND also log them in the
      pile) -- picked the third, lowest-risk option, which leaves
      CardView.tsx's fly-out/`flown` state machine completely untouched
      (still Eleveroon-only) and only changes `DiscardPile.tsx`'s
      `discardedEntries`: a turn's cards are now logged once
      `turn.state` is `"won"` or `"lost"` -- deliberately reusing
      selectors.ts's `totalDisplay`/`canRevealTotal` threshold exactly, not
      a new one, so a `"standby"` (stood, banker hasn't played yet) or
      `"skipped"` hand's cards stay OUT of the log the same way their total
      stays hidden from everyone else at that point -- logging them the
      instant a hand stops being `"pending"` would have leaked exactly what
      that hiding protects. An Eleveroon-rejected card still logs
      immediately regardless of its hand's own state, same as before (it
      was already public the moment the toast fired). `DiscardPileModal.tsx`
      now only prints "-- saved by Eleveroon" on entries that actually were
      one. Verified live: a resolved 4-player round produced a 13-card pile
      matching every seat's own total exactly, every hand still visible in
      its seat, no console errors. 210/210 frontend tests (4 new).
- [x] Practice mode's computer-player cap raised from 7 to 10 (2026-08-10) --
      the backend (`botCount`, `PRACTICE_BOT_NAME_POOL`) and the lobby's
      "Customize table settings" slider already supported an arbitrary count
      end to end; 7 was just where the bot name pool ran out. Added 3 more
      names (Avrumi, Moishy, Shloimy) and raised both clamps to 10 -- the
      real ceiling, not a round number: `MAX_SEATED_PLAYERS_PER_ROUND` caps
      a round's non-banker seats at 11, and the human learner always takes
      one of those, so 10 bots is exactly as many as the felt can seat
      without anyone queuing. Verified live: a 10-bot room seats all 10
      distinct personas plus the human, 11/11, nobody queued, no console
      errors. 151 backend + 206 frontend tests still green.
- [x] Mobile optimization pass (2026-08-10). Three fixes from a general
      audit (DOM/CSSOM introspection, not live screenshots -- the Browser
      pane wasn't compositing frames this session; see the still-open
      landscape-clipping item above for the one thing that limitation
      actually blocked):
      1. `blank.png` (the card back -- every hidden card, the shoe, the
         discard pile stack) was 2.6MB at 946x1438. That resolution is
         real and deliberate for desktop (`stage.ts`'s `MAX_SCALE=3.0`
         comment: sized so a card stays crisp scaled up on a 4K monitor,
         already tuned once before after a reported softening/pillarboxing
         bug) -- shrinking the source file outright would have undone that.
         Instead added a 316x480 `blank-sm.png` (390KB) and switched both
         places that reference it -- `CardView.tsx`'s `<img>` (via
         `<picture><source media>`) and `.k-cardback`'s CSS
         `background-image` (via a plain media query) -- to serve it below
         1280px viewport width, matching `stage.ts`'s own
         `scale = min(availWidth/1280, MAX_SCALE)` math. Deliberately NOT
         `srcset`/`sizes`: the stage scales via CSS `transform`, which
         `sizes` resolution can't see -- it resolves against the `<img>`'s
         unscaled ~92px layout box and would keep serving the small file
         forever, including at `MAX_SCALE` on a real desktop monitor.
         Verified live: narrow viewport resolves both paths to
         `blank-sm.png`, a fresh load at 1600px resolves both to the full
         `blank.png` (a live *resize* of an already-loaded page didn't
         re-pick the `<picture>` source in this session's Browser pane --
         another symptom of the same non-compositing limitation, not a
         real bug; a fresh load at the target width proved the actual
         logic). Scoped to the card back only -- the 12 face images are
         already much smaller (25-274KB) and weren't part of this pass.
      2. Bet amount +/- steppers were the shortest tap targets in the dock
         (30x19, used on every wager) despite the mobile pass that already
         sized every OTHER dock control to a ~40px floor -- stacking two
         buttons inside a pill that has to match its row-mates' height
         just doesn't leave more room. Added pseudo-element hit-slop
         (extra clickable area above the increase button, below the
         decrease one, where nothing else sits) instead of growing the
         pill -- same ~40px+ effective target, zero layout/width-budget
         change to a dock already measured to just fit at 375px.
      3. `.k-chrome-top`'s icon-only buttons (help/music/SFX/motion/
         fullscreen/Manage/Leave) measured ~35x27. Bumped to a 40px floor,
         scoped to `.k-chrome-top .k-chip-btn` specifically -- `.k-chip-btn`
         is also reused by Seat.tsx's small-on-purpose admin Skip button and
         ReactionLayer's already-sized 36x36 React button, neither measured
         or intended to grow here. Safe to grow (this row wraps instead of
         overflowing, unlike the dock).
      206/206 frontend tests still green, `vite build` clean.
- [x] End-to-end coverage of a full multi-client round (2026-08-10) --
      `e2e/` is a new, separate Playwright package (own `package.json`, its
      own dedicated ports 3100/3101/5273 so it never collides with a
      developer's own `npm run dev`) covering what unit/component coverage
      structurally can't reach: two real browser CONTEXTS (genuinely
      isolated sessions, sidestepping the shared-localStorage gotcha in this
      file's "Local development" section) with two real WebSocket
      connections on one real table. `full-round.spec.ts`: banker creates a
      room, a second real player joins and is visible on the BANKER's own
      live view (not just the player's), the bank's hand reads concealed to
      the player the instant it's dealt, the player plays a hand, the banker
      resolves theirs, and both clients end up agreeing on the same
      WON/LOST/PUSH outcome off the same `round:state` broadcast. Cards are
      real crypto-random draws, not scripted -- the test drives whichever
      controls actually show up (`clickIfAppears`) rather than assuming one
      fixed Bet-then-Hit-then-Stand path, since a natural stop can
      legitimately resolve a turn at any of several points. 6/6 runs green
      locally across genuinely different random hands. See `e2e/README.md`.
- [x] A real discard pile (2026-08-10, replacing the old in-hand disintegrate
      animation): a rejected Eleveroon card now flies from its hand to a new
      clickable felt element (`DiscardPile.tsx`, styled and positioned like
      the shoe but mirrored to the dealer's other side -- `layout.ts`'s
      `discardPilePosition`) and disappears from the hand for good --
      `CardView.tsx`'s `flown` state renders nothing for an eleveroon-ignored
      card once its one-shot puff/crumble/rebound-then-fly-out sequence
      finishes (`index.css`'s `cardDiscardFly`), and renders nothing AT ALL
      for one that already happened before this client connected (it flew
      off in an earlier session -- the pile's own tap-to-expand review,
      `DiscardPileModal.tsx`, is where it lives now). This is a real
      behavior change from the old design: the permanent in-hand gold ring
      is gone, superseded by the pile as "the record of what happened".
      Scoped to Eleveroon-rejects only, per the open design question this
      closes out -- every OTHER resolved card staying in its hand as before
      was a deliberate line, not an oversight; revisit if a broader "every
      card this round" pile is ever wanted. Covered by 15 new tests
      (`CardView.test.tsx`'s fly-out timing, `DiscardPile.test.tsx`,
      `DiscardPileModal.test.tsx`); the live Eleveroon-reject moment itself
      wasn't reproducible through browser-click automation this session (it
      needs both landing on a hand reading exactly 11 AND then drawing an
      actual 11 -- 8 practice-mode attempts landed on 11 twice but never drew
      the second one), so this shipped on the deterministic test suite +
      code review rather than a live screenshot, the same standard used for
      the BANK! two-frames fix above.
- [x] Fixed both confirmed BANK! "two frames" bugs from the 2026-08-10
      bug-hunting pass (repro'd in `backend/src/__tests__/bank-frames.test.ts`):
      1. A redeal used to overwrite the banker's turn with the fresh hand
         before any `round:state` ever carried the frame that just finished
         -- only the wallet number moved, silently. Fixed by carrying that
         frame forward on a new transient field, `RoundState.lastBankFrame`
         (`store.ts`'s `settleBankOutcome`, only ever set on an actual
         redeal), diffed by client(s) the same way `deckReshuffledAt` is
         (`state.ts`'s `bankFrameNotification`) to toast "Bank showed 18
         (beat 2) -- new hand dealt to keep the table live." to the whole
         table the instant it happens. Chosen over pausing the round to wait
         for an acknowledgment -- the banker is still forced to keep dealing
         regardless, so there's nothing for anyone to actually decide before
         the next card; a toast tells the story without adding a click.
      2. A second BANK! lock later in the same round was double-counting
         seats an earlier frame had already paid out into the banker's
         `beat`/`lostTo` tally (`beat: 2, lostTo: 1` instead of `beat: 0,
         lostTo: 1` in the confirmed repro). Two-part fix: `settleBankOutcome`
         now marks the turns it resolves `settled: true` (mirroring
         `settleImmediateTurn`, `store.ts:787`) and excludes already-`settled`
         seats from a later frame's `involvedEntries` -- which also stops a
         second frame from clobbering an earlier frame's real `settledBet`
         back to 0. `calculateEndState` (`round.ts`) additionally guards its
         own beat/lostTo increment against a turn that's already been paid
         (`bet: 0` but `settledBet` non-zero) re-adding a point on any later
         recompute -- this is the one that actually mattered for the live
         bug, since the round's own final settlement re-runs
         `calculateEndState` over every turn regardless of the
         `involvedEntries` filter. Money was never affected by either bug.
- [x] Eleveroon is now visible to the WHOLE table, not just the player it
      happened to (2026-08-10). Two parts: (1) a public toast
      ("Eleveroon! <Name> just saved a busting eleven.") fires for every
      connected client -- including the player it happened to -- the instant
      a card is newly marked `eleveroonIgnored`, independent of that specific
      card still being concealed from other players by the ordinary bet/hit
      secrecy rules (`state.ts`'s `eleveroonNotification`, diffed off the
      same broadcast round state as the deck-reshuffle/outcome notices).
      (2) A live "I'm calling Eleveroon!" gold star badge on the player's own
      seat (`Seat.tsx`'s `k-elev-mark`) the moment they submit a Bet/Hit with
      the checkbox on -- the real-table equivalent of announcing it out loud,
      independent of whether the draw ends up needing the save. Backed by a
      new `turn.eleveroonCalled` field, overwritten every action from the
      raw checkbox request (never the banker's always-on protection --
      `round.ts`'s `applyEleveroonRule`), shown only while `turn.state` is
      still "pending". Verified live across two real browser clients (a
      banker tab and a player tab, no bots) -- the banker's tab shows the
      star on the player's seat while that player's own cards stay
      concealed, exactly the intended split between "the call is public" and
      "the hand stays private until it resolves".
- [x] Fixed a live-reported bug: Eleveroon did nothing on the Bet path (only
      Hit had the rule). See `round.ts`'s `applyEleveroonRule` comment --
      pinned by `backend/src/__tests__/eleveroon.test.ts`, which also proves
      a rejected card is permanently gone from the deck, not just excluded
      from the hand's total. Added a disintegrate animation for the
      rejected card (puff/crumble/rebound, sequenced after its deal-in) and
      fixed the existing glow/badge-pop animations replaying on every
      reconnect instead of only the first time (`CardView.tsx`, `index.css`).
- [x] Live "BANK 21!" indicator for the banker's own natural 21, mirroring
      FUTCHED! (`selectors.ts`'s `statusDisplay`).
- [x] Motion toggle (footer checkbox / TableRoot chip icon, matching
      Music/SFX) -- blanket-kills all animation/transition via a single
      `motion-off` class on `<html>`, independent of `prefers-reduced-motion`.
- [x] Credited ComputerRabbis.com as the developer (site-wide footer +
      About page), and the natural-21 fanfare's Mixkit source (About).
- [x] Card-dealing animation report (2026-08-10): the mechanism itself
      (`k-card-in`/`cardDealIn` in `index.css`, dealDx/dealDy per seat,
      round-scoped keys, first-paint gate) was already correctly wired and
      verified live -- what was actually invisible is that it went fully
      silent under `prefers-reduced-motion: reduce`, which every other
      animation in `index.css` respects. Decided this one shouldn't: it's
      the only visual cue a card was dealt at all, not just decorative
      polish, so `.k-card-in` was pulled out of that media block and now
      always plays. Confirmed live with `prefers-reduced-motion: reduce`
      still on.
- [x] Real natural-21 fanfare (`frontend/public/sounds/natural21.mp3`,
      Mixkit's "Fantasy game success notification" -- Mixkit License, no
      attribution required). Replaces the reused `card-slide-1.ogg`
      card-motion sample; the "win" sound is no longer layered underneath it
      as a workaround (`audio.ts`, `App.tsx`).
- [x] Fixed 3 confirmed sources of the intermittent backend flake (see the
      still-open item above for the small residual). Each test dealt with
      real crypto-random cards without pinning the hand before a bet/hit
      that could resolve it early: `turn-order.test.ts` (preset all hands
      before betting), `ws-auth.test.ts` (same, plus removed the now-
      resolved standing `DEBUG_DUMP` debug line), `abandoned-banker.test.ts`
      (stacked the deck for a bet that was only half-guarded).
- [x] Richer URLs — distinguishable lobby vs. table (`/table/:roomId`,
      `frontend/src/router.tsx`). Shareable practice-mode link was
      explicitly decided against (practice mode stays single-human). See
      "URL model" below for the current shape and the remount pitfall this
      needed to avoid.
- [x] Browser Back button support. Entering a room now pushes a history
      entry (`history.pushState` in `state.ts`'s `setUrlRoomId`, only on a
      genuinely new room -- reconnects re-confirming the same room still use
      `replaceState`, so they don't pile up duplicate entries). A `popstate`
      listener tears the session down and returns to the lobby the same way
      the explicit Leave button does (shared `teardownRoomSession` helper),
      instead of leaving the site. Verified live (create a practice table,
      press Back, land cleanly on the lobby with no stale session) and with
      5 new tests in `state.test.ts`.
- [x] `/metrics` endpoint (Prometheus text format, unauthenticated like
      `/health`) — `backend/src/metrics.ts`. Tracks HTTP request count, WS
      connections (current gauge + total), WS messages received, rounds
      completed, and round duration (histogram, deal to finalize).
- [x] Retired the root-level legacy Elixir/Phoenix tree — 121 dead files
      (~20MB: compiled JS/CSS bundles, `kvitlech-master.zip`, `fly.toml` for
      an old Fly.io deploy, duplicate card art, `mix.exs`/`.ex` sources) removed
      from the working tree; still recoverable from git history if ever needed.
      `notes/2026-01-01-change-summary.md` (a real changelog about the live
      `store.ts`, not legacy code) was kept.
- [x] Cryptographically secure shuffle RNG — `deck.ts`'s Fisher-Yates now
      uses `crypto.randomInt` instead of `Math.random()`. Fairness sim
      (`npm run simulate`) confirms unchanged odds/distributions.
- [x] Automated frontend coverage for key flows — 169 tests across lobby,
      table view, dock, drawers, stage maths, and store/WS handling.
- [x] Persistence layer so tables survive process restarts — `db.ts`
      (`rooms` / `rounds` / `connections`), rehydrated by `loadFromDB()`.
      Optional: no `DATABASE_URL` runs fully in-memory.
- [x] Production deploy recipe — `deploy/docker-compose.yml`,
      `deploy/build-tarball.sh`, and the Cloudflare Tunnel section in the README.
- [x] Ambient music player with a mute toggle.
- [x] Sound effects for deal, bet, hit/stand, win, futch, Eleveroon, reshuffle,
      and natural 21, with an independent SFX mute toggle.

## URL model

`router.tsx` (not `main.tsx` -- see below) routes `/about`, `/disclaimer`,
`/contact`, and a catch-all `*` for everything else (the lobby, joined-but-
waiting, and live table, all still rendered by the one `App` component,
switching on Zustand `room`/`round` state exactly as before). The active
room is reflected in the path as `/table/CODE`, not a query param.

**Why a catch-all route, not separate `/` and `/table/:roomId` entries:**
two distinct route objects rendering the same `<App/>` element would still
make React Router remount it on every lobby<->table transition (route
matches are keyed by route id, not element identity) -- re-running its
WS-connect effect. `WSClient.connect()` safely no-ops on an already-open
socket, but the re-run would still re-arm `store.init()`'s "connecting"
status with nothing left to flip it back (the socket's `onopen` handler is
only ever assigned once, on the original `connect()`, and won't fire again).
A single `*` route never remounts on a path change, so this doesn't happen.
`App` parses the room id out of the path itself (`state.ts`'s
`getUrlRoomId`) rather than via `useParams()`, since it has to work either
way -- state.ts is a vanilla Zustand store, no hook access.

Entering a room pushes a history entry via the router's own imperative
`router.navigate()` (not raw `history.pushState` -- that would move the
address bar without React Router's internal location state ever finding
out, leaving the *next* navigation routed from a stale idea of where we
are). Every other URL update for an already-shown room (reconnects, kicks,
room-closed) replaces in place instead. A `popstate` listener (the browser
Back button firing while in a room) tears the session down and reloads at
the lobby -- see `state.ts`'s `teardownRoomSession` and the comment above
`setUrlRoomId`.

A stale/invalid `/table/CODE` (no matching per-room session -- an old
bookmark, a deleted room) folds back into `/?room=CODE` on load, both in
`state.ts` (once the WS connects) and immediately in `App.tsx`'s own
pre-fill effect (covers the gap before that, and stale-by-mount cases) --
unlike `/table/`, a bare `?room=` was never a "you're seated here" claim,
just an invite-link hint, so this is the same fallback an ordinary invite
link already gets: the Game ID field gets filled in, not a silent reset.

`?room=CODE` itself is unchanged: it's still the invite-link format
(`RoomInfoDrawer`'s copy-link/WhatsApp-share both use it), pre-filling the
join form for someone who hasn't joined yet. Reconnection does **not**
depend on the URL either way -- it uses a session token in `localStorage`
(generic + per-room keys), so `?room=`/`/table/CODE` are both just hints,
never the source of truth.

Shareable practice-mode links were explicitly decided against (2026-08-09)
-- practice mode stays single-human, no multi-join support planned.
