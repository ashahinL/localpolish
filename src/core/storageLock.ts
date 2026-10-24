export function createStorageLock(name: string): <T>(work: () => Promise<T>) => Promise<T> {
  let queue: Promise<void> = Promise.resolve();

  return <T>(work: () => Promise<T>): Promise<T> => {
    if (globalThis.navigator?.locks) {
      return navigator.locks.request(name, work);
    }
    const result = queue.then(work);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
