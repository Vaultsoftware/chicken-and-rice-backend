// tools/route-guard.mjs
// Robust, idempotent guard that logs bad route path strings before Express compiles them.

import express from "express";
import * as ptre from "path-to-regexp";

// prevent double-patch on hot restarts
if (!globalThis.__ROUTE_GUARD_INSTALLED__) {
  globalThis.__ROUTE_GUARD_INSTALLED__ = true;

  const appProto = express.application;
  const routerProto = express.Router && express.Router().constructor.prototype;
  const METHODS = ["use","get","post","put","patch","delete","options","head","all"];

  const isBadToken = (s) =>
    typeof s === "string" &&
    ( /\/:(\?|\*|\+)(?:\/|$)/.test(s)         // '/:?', '/:*', '/:+'
      || /\/:\(\.\*\)/.test(s) );             // '/:(.*)'

  const warnUrlMount = (s) =>
    typeof s === "string" && /^https?:\/\//i.test(s);

  function validatePathArg(arg, where) {
    if (typeof arg !== "string") return;
    try {
      // Try compiling — this is what Express will do.
      ptre.parse(arg);
    } catch (err) {
      console.error("⛔ BAD ROUTE STRING (will crash):", JSON.stringify(arg));
      console.error("   at:", where);
      console.error("   stack:\n" + (new Error().stack));
      throw err; // rethrow so behavior is unchanged
    }
    if (isBadToken(arg)) {
      console.error("⛔ Unnamed param modifier found:", JSON.stringify(arg), "at", where);
      console.error("   Fix by naming the param, e.g. '/:name?', '/:name*', '/:name+', or '/:path(.*)'");
    }
    if (warnUrlMount(arg)) {
      console.error("⛔ Full URL used as route path:", arg, "at", where);
      console.error("   Mount routers with a local path only (e.g. '/api'), not a full URL.");
    }
  }

  function wrapMethod(proto, methodLabel) {
    const orig = proto[methodLabel];
    if (typeof orig !== "function") return;

    proto[methodLabel] = function wrapped(...args) {
      // Express methods accept (path, ...handlers) OR (...handlers) with no path.
      // Validate first string argument (or array of them).
      if (args.length && (typeof args[0] === "string" || Array.isArray(args[0]) || args[0] instanceof RegExp)) {
        const first = args[0];
        const where = `express.${methodLabel}()`;
        if (typeof first === "string") {
          validatePathArg(first, where);
        } else if (Array.isArray(first)) {
          for (const item of first) if (typeof item === "string") validatePathArg(item, where);
        }
        // RegExp is allowed; no check needed.
      }
      return orig.apply(this, args);
    };
  }

  // Patch app + router prototypes
  for (const m of METHODS) {
    wrapMethod(appProto, m);
    if (routerProto) wrapMethod(routerProto, m);
  }

  console.log("[route-guard] installed");
}
