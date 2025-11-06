// ============================================================================
// File: tools/ptr-global-patch.mjs
// Safe pre-Express guard: validates route path strings (incl. arrays of strings)
// using path-to-regexp.parse. Does NOT mutate the path-to-regexp module.
// Exits fast with clear message + stack when it finds a malformed path.
// ============================================================================
import express from 'express';
import { parse as ptreParse } from 'path-to-regexp';

const INSTALLED = Symbol.for('ptr.guard.installed');

function isFn(x)     { return typeof x === 'function'; }
function isRegex(x)  { return x instanceof RegExp; }
function isString(x) { return typeof x === 'string'; }
function isArray(x)  { return Array.isArray(x); }
function isRouter(x) { return x && typeof x === 'function' && typeof x.handle === 'function'; }

function* iterPathStrings(args) {
  // Scan leading args until we hit a handler/router; collect string paths.
  for (const a of args) {
    if (isFn(a) || isRouter(a)) break;
    if (isRegex(a)) continue;
    if (isString(a)) { yield a; continue; }
    if (isArray(a)) {
      for (const inner of a) if (isString(inner)) yield inner;
      continue;
    }
  }
}

function validateOne(str, tag) {
  try {
    ptreParse(str);
  } catch (e) {
    console.error('❌ Invalid route string:', JSON.stringify(str));
    console.error('   method:', tag);
    console.error('   →', e?.message || e);
    console.error('   Fix examples:');
    console.error('     "/users/:id?"        // optional param with a NAME');
    console.error('     "/files/:path(.*)"   // catch-all with named param + regex');
    console.error('     "/api/:rest*"        // repeatable param (named)');
    console.error('   Avoid full URLs as mount paths (e.g. "https://...").');
    const stack = new Error().stack?.split('\n').slice(2, 16).join('\n');
    if (stack) console.error('   at:\n' + stack);
    process.exit(1);
  }
}

function patch(proto, label) {
  if (!proto || proto[INSTALLED]) return;
  const methods = ['use','all','get','post','put','patch','delete','options','head'];

  for (const m of methods) {
    const orig = proto[m];
    if (typeof orig !== 'function') continue;

    proto[m] = function patched(...args) {
      for (const s of iterPathStrings(args)) {
        if (process.env.DEBUG_EXPRESS_GUARD) console.log(`[guard:${label}.${m}]`, s);
        validateOne(s, `${label}.${m}`);
      }
      return orig.apply(this, args);
    };
  }

  Object.defineProperty(proto, INSTALLED, { value: true, enumerable: false });
}

// Install on Router prototype and on the application prototype.
try {
  const Router = express?.Router;
  const appProto = Object.getPrototypeOf(express());
  if (Router?.prototype) patch(Router.prototype, 'router');
  if (appProto)          patch(appProto,       'app');
} catch {
  // No-op; if Express import changes, guard just won’t install.
}
