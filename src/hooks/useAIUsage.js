// AI daily usage tracking removed — stubs kept to avoid import errors
export function useAIUsage() {
  return { usage: { used: 0, limit: 0 }, loading: false, error: null, refresh: () => {} };
}
export function useAIUsagePolling(interval, onThresholdCrossed) {
  return { used: 0, limit: 0 };
}
