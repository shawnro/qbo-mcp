let operationTail: Promise<void> = Promise.resolve();

export async function runLocalOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = operationTail.then(operation, operation);
  operationTail = run.then(() => undefined, () => undefined);
  return run;
}
