export interface DecisionRequest {
  requestId: number;
  controller: AbortController;
}

export class DecisionLifecycle {
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;

  begin(): DecisionRequest {
    this.invalidate();
    const request: DecisionRequest = {
      requestId: this.revision,
      controller: new AbortController(),
    };
    this.controller = request.controller;
    return request;
  }

  schedule(requestId: number, callback: () => void, delayMs = 250): void {
    if (!this.isCurrent(requestId)) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.isCurrent(requestId)) callback();
    }, delayMs);
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.revision && Boolean(this.controller && !this.controller.signal.aborted);
  }

  invalidate(): void {
    this.revision += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }
}

export function createDecisionLifecycle(): DecisionLifecycle {
  return new DecisionLifecycle();
}
