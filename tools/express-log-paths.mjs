// Stronger route arg logger: prints paths, and on crash dumps full args.
// Safe: does not mutate path-to-regexp or Express internals.
import express from 'express';

const INSTALLED = Symbol.for('express.log.paths.v2');
const METHODS = ['use','all','get','post','put','patch','delete','options','head'];

const isFn   = (x) => typeof x === 'function';
const isStr  = (x) => typeof x === 'string';
const isReg  = (x) => x instanceof RegExp;
const isArr  = Array.isArray;
const isRou  = (x) => x && typeof x === 'function' && typeof x.handle === 'function';

function* extractPathStrings(args) {
  // Yield every string path-like arg until we hit the first handler/router.
  for (const a of args) {
    if (isFn(a) || isRou(a)) break;
    if (isReg(a)) continue;
    if (isStr(a)) { yield a; continue; }
    if (isArr(a)) for (const s of a) if (isStr(s)) yield s;
  }
}

function brief(x) {
  try {
    if (isStr(x)) return x;
    if (isReg(x)) return String(x);
    if (isFn(x))  return `[Function ${x.name||'anon'}]`;
    if (isRou(x)) return `[Router]`;
    if (isArr(x)) return `[Array ${x.length}]`;
    if (x && typeof x === 'object') return `[Object ${x.constructor?.name||'Object'}]`;
    return String(x);
  } catch { return '[Unprintable]'; }
}

function patch(proto, label) {
  if (!proto || proto[INSTALLED]) return;
  for (const m of METHODS) {
    const orig = proto[m];
    if (typeof orig !== 'function') continue;

    proto[m] = function patchedRegister(...args) {
      // pre-log all path-like strings
      for (const s of extractPathStrings(args)) {
        console.log(`[route-log:${label}.${m}]`, s);
        if (/^https?:\/\//i.test(s) || /\/:(\?|\*|\+)\b|\/:\(\.\*\)/.test(s)) {
          console.warn(`  ↳ suspicious: ${JSON.stringify(s)} (URL-like or unnamed token)`);
        }
      }

      // call and trap throws so we can print the exact failing args
      try {
        return orig.apply(this, args);
      } catch (err) {
        console.error(`\n[route-log:CRASH in ${label}.${m}]`);
        console.error(`Args:`);
        args.forEach((a, i) => console.error(`  [${i}] ${brief(a)}`));
        // try to show first string-ish path again for clarity
        const firstPath = [...extractPathStrings(args)][0];
        if (firstPath) console.error(`First path-like arg: ${JSON.stringify(firstPath)}`);
        console.error(`Error: ${err?.stack || err}`);
        throw err; // rethrow so nodemon behaves normally
      }
    };
  }
  Object.defineProperty(proto, INSTALLED, { value: true });
}

try {
  const Router = express?.Router;
  const appProto = Object.getPrototypeOf(express());
  if (Router?.prototype) patch(Router.prototype, 'router');
  if (appProto)          patch(appProto,       'app');
} catch {
  // noop
}
