import { describe, expect, it } from "vitest";
import { activityPanelSize } from "./activity-panel-layout";

describe("activity panel natural sizing", () => {
  it("measures hidden overflow instead of feeding back the clipped viewport height", () => {
    expect(activityPanelSize({ width: 380, height: 70 }, { scrollHeight: 420, clientHeight: 68, offsetHeight: 70 })).toEqual({ width: 380, height: 422 });
  });
  it("keeps normal measured size when no overflow exists", () => {
    expect(activityPanelSize({ width: 380, height: 210 }, { scrollHeight: 208, clientHeight: 208, offsetHeight: 210 })).toEqual({ width: 380, height: 210 });
  });
});
