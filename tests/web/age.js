function chAge(startedSecs) {
  if (!startedSecs) return '';
  const s = Math.max(0, Math.floor(NOW / 1000 - startedSecs));
  if (s < 120) return 'just posted';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
var NOW = 1791400000000, t = NOW/1000;
print("  now        -> " + chAge(t));
print("  5 min ago  -> " + chAge(t - 300));
print("  3 h ago    -> " + chAge(t - 3*3600));
print("  2 d ago    -> " + chAge(t - 2*86400));
print("  missing    -> '" + chAge(0) + "'");
