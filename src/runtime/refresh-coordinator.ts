export interface RefreshCoordinator {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export class InProcessRefreshCoordinator implements RefreshCoordinator {
  private active: Promise<unknown> | null = null;

  async run<T>(operation: () => Promise<T>): Promise<T> {
    while (this.active) await this.active;

    const active = operation();
    this.active = active;
    try {
      return await active;
    } finally {
      if (this.active === active) this.active = null;
    }
  }
}