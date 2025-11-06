// ============================================================================
// File: tools/ptr-global-patch.cjs
// Usage: nodemon --exec "node -r ./tools/ptr-global-patch.cjs server.js"
// Patches ALL key exports of 'path-to-regexp' so we print the offending string.
// ============================================================================
const mod = require('path-to-regexp');

function wrap(fnName) {
  const orig = mod[fnName];
  if (typeof orig !== 'function') return;
  mod[fnName] = function patched(str, ...rest) {
    try {
      return orig.call(this, str, ...rest);
    } catch (e) {
      if (typeof str === 'string') {
        console.error('❌ path-to-regexp failed in', fnName);
        console.error('   Invalid route string:', JSON.stringify(str));
        console.error('   →', e.message);
        console.error('   Hints:');
        console.error('     • Every ":" must have a name: "/:id?", "/:path(.*)", "/:rest*".');
        console.error('     • Do NOT pass full URLs as route paths (e.g. "https://...").');
        console.error('       Use a normal path like "/api" and put the URL in proxy `target`.');
      }
      throw e;
    }
  };
}

['parse', 'tokensToRegExp', 'pathToRegexp'].forEach(wrap);

module.exports = mod;
