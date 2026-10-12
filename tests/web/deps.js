// DEPENDENCY AUDIT. A shared module used on a page that doesn't LOAD it throws a
// ReferenceError while the inline script is still evaluating, which kills the whole
// script — not just that feature. That is exactly how the lobby went blank on
// 2026-10-12: portal.html called GBClock.presets() at top level and never loaded
// web/gb-clock.js, so renderGames() and the poller never ran at all.
//
// Reads the pages as text (no DOM needed) and checks every `GBThing.` use against
// the <script src> list. Uses guarded by `window.GBThing` / `typeof GBThing` are
// soft dependencies and allowed.
var PAGES = {
  "web/index.html":       ["web/main.js"],
  "web/multiplayer.html": ["web/multiplayer.js"],
  "web/portal.html":      [],
  "web/strategy.html":    [],
  "web/learn.html":       [],
  "web/help.html":        [],
  "web/forum.html":       [],
  "web/admin.html":       [],
};
var MODULES = {
  GBAssistUI: "gb-assist-ui.js", GBSound: "gb-sound.js", GBBoardInput: "gb-board-input.js",
  GBRecap: "gb-recap.js", GBCapture: "gb-capture.js", GBStrategies: "strategies.js",
  GBTerms: "gb-terms.js", GBHelpBudget: "gb-help-budget.js", GBResign: "gb-resign.js",
  GBAiCast: "gb-ai-cast.js", GBClock: "gb-clock.js", GBStrategyState: "gb-strategy-state.js",
  GBRating: "rating.js", GBTheme: "theme.js",
};
var bad = 0, checked = 0;
Object.keys(PAGES).forEach(function (page) {
  var html;
  try { html = readFile(page); } catch (e) { return; }
  var srcs = (html.match(/src="\.\/[^"]+"/g) || []).join(" ");
  var text = html;
  PAGES[page].forEach(function (f) { try { text += readFile(f); } catch (e) {} });
  Object.keys(MODULES).forEach(function (g) {
    if (text.indexOf(g + ".") < 0) return;           // not used here
    checked++;
    var guarded = text.indexOf("window." + g) >= 0 || text.indexOf("typeof " + g) >= 0;
    if (srcs.indexOf(MODULES[g]) < 0 && !guarded) {
      print("  FAIL " + page + " uses " + g + " but never loads " + MODULES[g]);
      bad++;
    }
  });
});
print("  checked " + checked + " module uses across " + Object.keys(PAGES).length + " pages");
print(bad ? "  " + bad + " unguarded missing dependency(ies)" : "  every module used is loaded (or guarded)");
