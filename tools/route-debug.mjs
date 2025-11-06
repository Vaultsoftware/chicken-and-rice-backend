// ============================================================================
// File: tools/route-debug.mjs
// Non-fatal diagnostics: logs suspicious route strings and URL-like mounts.
// Never throws; only warns. Useful alongside ptr-global-patch.mjs.
// ============================================================================
import express from 'express';

const INSTALLED = Symbol.for('route.debug.installed');

function isFn(x)     { return typeof x === 'function'; }
function isRegex(x)  { return x instanceof RegExp; }
function isString(x) { return typeof x === 'string'; }
function isArray(x)  { return Array.isArray(x); }
function isRouter(x) { return x && typeof x === 'function' && typeof x.handle === 'function'; }

function* iterPathLike(args) {
  for (const a of args) {
    if (isFn(a) || isRouter(a)) break;
    if (isRegex(a)) continue;
    if (isString(a)) { yield a; continue; }
    if (isArray(a)) for (const inner of a) if (isString(inner)) yield inner;
  }
}

function looksUrl(s) { return /^https?:\/\//i.test(s); }
function looksBadToken(s) { return /\/:(\?|\*|\+)\b|\/:\(\.\*\)/.test(s) || /\/:\?/.test(s) || /\/:\*/.test(s) || /\/:\+/.test(s); }

function warn(tag, m, s) {
  const lines = [];
  if (looksUrl(s)) lines.push(`⚠️ URL-like mount path detected: ${JSON.stringify(s)}`);
  if (looksBadToken(s)) lines.push(`⚠️ Possible unnamed param token in: ${JSON.stringify(s)}  → use "/:name?" "/:name*" "/:name(.*)"`);
  if (lines.length) {
    console.warn(`[route-debug:${tag}.${m}]`);
    for (const L of lines) console.warn(' ', L);
    const stack = new Error().stack?.split('\n').slice(2, 10).join('\n');
    if (stack) console.warn('  at:\n' + stack);
  }
}

function patch(proto, label) {
  if (!proto || proto[INSTALLED]) return;
  const methods = ['use','all','get','post','put','patch','delete','options','head'];

  for (const m of methods) {
    const orig = proto[m];
    if (typeof orig !== 'function') continue;

    proto[m] = function debugPatched(...args) {
      for (const s of iterPathLike(args)) warn(label, m, s);
      return orig.apply(this, args);
    };
  }

  Object.defineProperty(proto, INSTALLED, { value: true, enumerable: false });
}

try {
  const Router = express?.Router;
  const appProto = Object.getPrototypeOf(express());
  if (Router?.prototype) patch(Router.prototype, 'router');
  if (appProto)          patch(appProto,       'app');
} catch {
  // swallow
}
