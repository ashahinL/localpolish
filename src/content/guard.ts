// Page listeners must never throw into the host page's event dispatch.
export function guarded<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    try {
      fn(...args);
    } catch (error) {
      console.warn('LocalPolish:', error);
    }
  };
}

export function settle(promise: Promise<unknown>): void {
  promise.catch((error: unknown) => console.warn('LocalPolish:', error));
}
