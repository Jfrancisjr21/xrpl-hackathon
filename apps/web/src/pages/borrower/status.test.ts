import type { ApplicationView } from "@hack/shared";
import { describe, expect, it } from "vitest";
import { samples } from "../../samples";
import { latestOf, timelineOf, verdictOf } from "./status";

const app = (over: Partial<ApplicationView>): ApplicationView => ({ ...samples.applicationApproved, ...over });

describe("verdictOf", () => {
  it("names each persona's outcome", () => {
    expect(verdictOf(samples.decisions.alice!)).toBe("Approved");
    expect(verdictOf(samples.decisions.carol!)).toBe("Approved");
    expect(verdictOf(samples.decisions.bob!)).toBe("Denied");
    expect(verdictOf(samples.decisions.borrower!)).toBe("Blocked");
  });
});

describe("timelineOf", () => {
  it("marks the current step while the broker reviews", () => {
    expect(timelineOf(app({ status: "pending_review" })).states).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(timelineOf(app({ status: "originating" })).states).toEqual(["done", "done", "done", "current", "todo"]);
    expect(timelineOf(app({ status: "active" }))).toEqual({ states: ["done", "done", "done", "done", "done"], note: null });
  });

  it("ends in red where it stopped, with the reason", () => {
    expect(timelineOf(app({ status: "denied", decision: samples.decisions.bob! }))).toEqual({
      states: ["done", "failed", "todo", "todo", "todo"], note: "Denied by the agent.",
    });
    expect(timelineOf(app({ status: "denied", decision: samples.decisions.borrower! })).note).toBe("Blocked by the sanctions check.");
    expect(timelineOf(app({ status: "rejected", brokerNote: "Amount too high" }))).toEqual({
      states: ["done", "done", "failed", "todo", "todo"], note: "Declined by the broker: Amount too high",
    });
    expect(timelineOf(app({ status: "failed" })).states[3]).toBe("failed");
  });
});

describe("latestOf", () => {
  it("picks the newest application whatever the order", () => {
    expect(latestOf([app({ id: 2 }), app({ id: 5 }), app({ id: 3 })])?.id).toBe(5);
    expect(latestOf([])).toBeNull();
    expect(latestOf(null)).toBeNull();
  });
});
