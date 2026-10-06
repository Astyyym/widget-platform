import { invoke } from "@tauri-apps/api/core";

export interface MetricsBridge {
  sample(sessionId: string): Promise<unknown>;
}

export const metricsBridge: MetricsBridge = {
  sample: (sessionId) => invoke<unknown>("metrics_sample", { sessionId }),
};
