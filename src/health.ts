// Per-deployment circuit breaker: after FAILURE_THRESHOLD consecutive
// upstream failures a deployment is skipped for OPEN_MS, then retried.
const FAILURE_THRESHOLD = 3;
const OPEN_MS = 30_000;

interface DeploymentHealth {
  consecutiveFailures: number;
  openUntil: number;
  lastError?: string;
}

const state = new Map<string, DeploymentHealth>();

export function isOpen(deploymentId: string, now = Date.now()): boolean {
  return (state.get(deploymentId)?.openUntil ?? 0) > now;
}

export function recordSuccess(deploymentId: string) {
  state.delete(deploymentId);
}

export function recordFailure(deploymentId: string, error: string, now = Date.now()) {
  const current = state.get(deploymentId) ?? { consecutiveFailures: 0, openUntil: 0 };
  current.consecutiveFailures += 1;
  current.lastError = error;
  if (current.consecutiveFailures >= FAILURE_THRESHOLD) current.openUntil = now + OPEN_MS;
  state.set(deploymentId, current);
}

export function healthSnapshot(deploymentId: string, now = Date.now()) {
  const current = state.get(deploymentId);
  return {
    circuitOpen: (current?.openUntil ?? 0) > now,
    consecutiveFailures: current?.consecutiveFailures ?? 0,
    lastError: current?.lastError ?? null,
  };
}

export function resetHealth() {
  state.clear();
}
