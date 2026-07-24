// Kleine gedeelde tekst-helpers.

// Items beginnen altijd met een hoofdletter — ook als de gebruiker er
// geen typt. De ij is in het Nederlands één klank en wordt als geheel
// gekapitaliseerd: 'ijsklontjes' → 'IJsklontjes'.
function capitalizeItem(s) {
  const t = String(s || '');
  if (!t) return t;
  if (/^ij/i.test(t)) return 'IJ' + t.slice(2);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

module.exports = { capitalizeItem };
