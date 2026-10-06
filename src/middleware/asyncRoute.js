/**
 * ASYNC ROUTE SAFETY
 * ───────────────────────────────────────────────────────────────────────
 * Express 4 does not catch a rejected promise returned by a route
 * handler. Every controller in this codebase is `async`, so any
 * unexpected database error inside one becomes an unhandled rejection —
 * and since Node 15 that terminates the process. In practice this meant a
 * single bad query on one endpoint took the whole API down for everyone,
 * admin included, rather than returning a 500 for that one request.
 *
 * (That is not hypothetical: a MariaDB-incompatible JSON_CONTAINS call in
 * the portal's file-access check killed the server outright during
 * testing, instead of failing one download.)
 *
 * `makeAsyncSafe(router)` walks a finished router's layer stack once, at
 * startup, and wraps every handler so a rejection is forwarded to
 * `next(err)` — which lands in the existing errorHandler and produces the
 * normal JSON error response. It's applied to every router in app.js, so
 * no route file needs to change and no dependency is added.
 */

function wrap(handler) {
  // Error-handling middleware has arity 4 and must keep it — re-wrapping
  // one would change its signature and Express would stop recognising it.
  if (typeof handler !== "function" || handler.length === 4 || handler.__asyncSafe) return handler;

  const wrapped = function (req, res, next) {
    let result;
    try {
      result = handler.call(this, req, res, next);
    } catch (err) {
      return next(err);
    }
    if (result && typeof result.then === "function") {
      result.catch(next);
    }
    return result;
  };
  wrapped.__asyncSafe = true;
  return wrapped;
}

function walk(stack) {
  for (const layer of stack || []) {
    if (layer.route) {
      for (const routeLayer of layer.route.stack || []) {
        routeLayer.handle = wrap(routeLayer.handle);
      }
    } else if (layer.handle && layer.handle.stack) {
      // A nested router mounted inside this one.
      walk(layer.handle.stack);
    } else if (layer.handle) {
      layer.handle = wrap(layer.handle);
    }
  }
}

export function makeAsyncSafe(router) {
  walk(router?.stack);
  return router;
}
