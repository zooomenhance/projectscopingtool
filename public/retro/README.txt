Retro assets for your GeoCities-style theme
---------------------------------------------

Files:
- bg_stars.gif           (tile this as the page background)
- divider_rainbow.gif    (repeat-x horizontal divider)
- under_construction.gif (blinky badge)

Install:
1) Create /public/retro in your project and copy these files inside.
2) In your CSS, reference:
   body.retro { background: #000 url('/retro/bg_stars.gif') repeat; }
   .info:before { background: url('/retro/divider_rainbow.gif') repeat-x left center / auto 14px; }
   <img src="/retro/under_construction.gif" alt="Under Construction" height="18" />

Suggested CSS variables:
:root {
  --retro-cyan:#0ff;
  --retro-magenta:#f0f;
  --retro-yellow:#ff0;
  --retro-green:#22a745;
  --retro-bg:#000;
  --retro-panel: rgba(0,0,0,0.6);
}
