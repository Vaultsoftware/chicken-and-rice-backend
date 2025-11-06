// Patches Express Router methods to log invalid route strings early.
// No top-level await. Works when preloaded via: node -r ./tools/express-route-patch.cjs server.js
const ptre = require('path-to-regexp');

function wrapRouter(RouterProto) {
  const methods = ['use','all','get','post','put','patch','delete','options','head'];
  for (const m of methods) {
    const orig = RouterProto[m];
    RouterProto[m] = function patched(path, ...rest) {
      // Only validate string paths (skip functions/regex/routers)
      if (typeof path === 'string') {
        try {
          ptre.parse(path);
        } catch (e) {
          // Print the exact offending route and a focused hint, then bail fast.
          console.error('❌ Invalid route string:', JSON.stringify(path));
          console.error('   →', e.message);
          console.error('   Fix: every ":" must have a NAME, e.g. "/:id?", "/:path(.*)", "/:rest*".');
          console.error('   Also don’t pass full URLs as paths; use a path like "/api" and put the URL in proxy target.');
          // Optional: print who called it
          const stack = new Error().stack?.split('\n').slice(2,8).join('\n');
          if (stack) console.error('   at:\n' + stack);
          process.exit(1);
        }
      }
      return orig.call(this, path, ...rest);
    };
  }
}

try {
  // Express v4/5 – require and patch before user's code loads Express
  const express = require('express');
  const Router = express.Router;
  if (Router && Router.prototype) wrapRouter(Router.prototype);
} catch {
  // Ignore if express not installed yet; user may not be using Express.
}
