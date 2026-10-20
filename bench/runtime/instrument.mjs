// Runs in the extension's isolated content world, not the page's main world.
export function instrument() {
  const state = {
    calls: {},
    timeouts: new Map(),
    intervals: new Map(),
    rafs: new Set(),
    firstPreviewAt: null,
    readyAt: null,
    startedAt: null,
    markMutationRecords: 0,
  };
  globalThis.__runtimeBench = state;
  const count = (name) => (state.calls[name] = (state.calls[name] ?? 0) + 1);
  for (const [object, name] of [
    [Element.prototype, 'getBoundingClientRect'],
    [globalThis, 'getComputedStyle'],
  ]) {
    const original = object[name];
    object[name] = function (...args) {
      count(name);
      return Reflect.apply(original, this, args);
    };
  }
  for (const [object, name] of [
    [HTMLElement.prototype, 'innerText'],
    [HTMLTextAreaElement.prototype, 'value'],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    Object.defineProperty(object, name, {
      ...descriptor,
      get() {
        count(name);
        return Reflect.apply(descriptor.get, this, []);
      },
    });
  }
  for (const [setName, clearName, map, repeat] of [
    ['setTimeout', 'clearTimeout', state.timeouts, false],
    ['setInterval', 'clearInterval', state.intervals, true],
  ]) {
    const schedule = globalThis[setName];
    const cancel = globalThis[clearName];
    globalThis[setName] = function (callback, ms, ...args) {
      count(`${setName}:${ms}`);
      let id;
      id = schedule(
        function (...values) {
          if (!repeat) map.delete(id);
          if (typeof callback === 'function') return callback(...values);
          return (0, eval)(callback);
        },
        ms,
        ...args,
      );
      map.set(id, ms);
      return id;
    };
    globalThis[clearName] = function (id) {
      // Browsers share the timeout and interval ID pool.
      state.timeouts.delete(id);
      state.intervals.delete(id);
      return cancel(id);
    };
  }
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = function (callback) {
    const id = request((time) => {
      state.rafs.delete(id);
      callback(time);
    });
    state.rafs.add(id);
    return id;
  };
  globalThis.cancelAnimationFrame = function (id) {
    state.rafs.delete(id);
    return cancel(id);
  };
  const inspect = (records) => {
    const shadow = document.querySelector('localpolish-root')?.shadowRoot;
    if (!shadow) return;
    const markLayer = shadow.querySelector('[data-layer="marks"]');
    state.markMutationRecords += records.filter(
      (record) => markLayer && (record.target === markLayer || markLayer.contains(record.target)),
    ).length;
    if (state.startedAt === null) return;
    const preview = shadow.querySelector('.lp-working') && shadow.querySelector('.lp-text');
    if (preview?.textContent && state.firstPreviewAt === null)
      state.firstPreviewAt = performance.now();
    const accept = shadow.querySelector('.lp-primary');
    if (accept && !accept.disabled && state.readyAt === null) state.readyAt = performance.now();
  };
  const observed = new WeakSet();
  const observer = new MutationObserver((records) => {
    const shadow = document.querySelector('localpolish-root')?.shadowRoot;
    if (shadow && !observed.has(shadow)) {
      observed.add(shadow);
      observer.observe(shadow, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    }
    inspect(records);
  });
  observer.observe(document, { subtree: true, childList: true });
  const existing = document.querySelector('localpolish-root')?.shadowRoot;
  if (existing) {
    observed.add(existing);
    observer.observe(existing, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }
  state.reset = () => {
    state.calls = {};
    state.markMutationRecords = 0;
    state.firstPreviewAt = null;
    state.readyAt = null;
    state.startedAt = performance.now();
  };
  state.snapshot = () => ({
    calls: { ...state.calls },
    pending: {
      timeouts: state.timeouts.size,
      intervals: state.intervals.size,
      animationFrames: state.rafs.size,
    },
    firstPreviewMs: state.firstPreviewAt === null ? null : state.firstPreviewAt - state.startedAt,
    readyMs: state.readyAt === null ? null : state.readyAt - state.startedAt,
    markMutationRecords: state.markMutationRecords,
  });
}
