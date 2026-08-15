/**
 * Serialize async work that must run one at a time.
 *
 * `state.json` is read-modify-written by every parallel analyst as it
 * finishes. Two of those writes running concurrently would let the second
 * clobber the first's read. Chaining every write through the same queue
 * guarantees each one sees what the previous one wrote.
 */

export interface SerialQueue {
  run(task: () => Promise<void>): Promise<void>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    run(task: () => Promise<void>): Promise<void> {
      tail = tail.then(task);
      return tail;
    },
  };
}
