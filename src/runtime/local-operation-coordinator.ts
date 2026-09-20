import { getQboRequestTimeoutMs } from "../client/promisify.js";

let operationTail: Promise<void> = Promise.resolve();

export class LocalOperationQueueTimeoutError extends Error {
  readonly code = "LOCAL_OPERATION_QUEUE_TIMEOUT";

  constructor(readonly timeoutMs: number) {
    super(`Local operation did not start within ${timeoutMs} ms`);
    this.name = "LocalOperationQueueTimeoutError";
  }
}

export async function runLocalOperation<T>(
  operation: () => Promise<T>,
  options: { waitTimeoutMs?: number } = {}
): Promise<T> {
  const waitTimeoutMs = options.waitTimeoutMs ?? getQboRequestTimeoutMs();

  return new Promise<T>((resolve, reject) => {
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      reject(new LocalOperationQueueTimeoutError(waitTimeoutMs));
    }, waitTimeoutMs);

    const execute = async () => {
      if (expired) return;
      clearTimeout(timeout);
      try {
        resolve(await operation());
      } catch (error) {
        reject(error);
      }
    };

    const run = operationTail.then(execute, execute);
    operationTail = run.then(() => undefined, () => undefined);
  });
}
