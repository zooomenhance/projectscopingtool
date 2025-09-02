Extra Retro Goodies
--------------------
- bg_stars_animated.gif  (tileable animated starfield; use with body.retro background)
- badge_best_viewed_800x600.gif  (classic 88x31 badge)
- badge_powered_by_frames.gif    (classic 88x31 badge)

Usage:
1) Place files in /public/retro
2) CSS background (animated):
   body.retro { background: #000 url('/retro/bg_stars_animated.gif') repeat; }
   /* or stick with the static bg_stars.gif if you prefer */

3) Badges in your HTML/JSX:
   <img src="/retro/badge_best_viewed_800x600.gif" width="88" height="31" alt="Best viewed at 800x600" />
   <img src="/retro/badge_powered_by_frames.gif"   width="88" height="31" alt="Powered by Frames" />

Pro tip: Add 'image-rendering: pixelated' in CSS if your browser smooths the badges.
