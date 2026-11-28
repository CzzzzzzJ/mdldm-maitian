// Per-profile single flight and a short cooldown if the debug port never opens.
export function chromeStartGuard(reachable, start, now = Date.now) {
  let pending, failure, failedAt = -Infinity;
  return async function ensure() {
    if (await reachable()) { failure = undefined; return; }
    if (pending) return pending;
    if (failure && now() - failedAt < 60000) throw failure;
    pending = Promise.resolve().then(start).catch(error => {
      failure = error;
      failedAt = now();
      throw error;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
