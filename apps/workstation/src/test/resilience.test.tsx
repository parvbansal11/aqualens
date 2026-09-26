/* Deployment resilience on the client side.
 *
 * A judge on a demo machine will hit a backend that has not started, a laptop
 * that slept mid-run, and a survey opened in a tab that was reloaded. These
 * tests pin the behaviour those situations must produce: a named failure
 * instead of the browser's "Load failed", retries only where a retry is safe,
 * and survey state that survives a transient failure instead of being thrown
 * away.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  SURVEY_STORAGE_KEY,
  failureSentence,
  fetchHealth,
  fetchJob,
  fetchReportBlob,
  fetchRuntimeSurvey,
  postReview,
  reportUrl,
  uploadSurvey,
} from "@/components/final/runtime/api";
import { AqualensApp } from "@/components/final/AqualensApp";
import survey from "./fixtures/runtime-survey.json";

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function fail(status: number, code: string, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message, detail: {} } }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("failures are classified, not flattened", () => {
  it("names an unreachable service rather than reporting a bare fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Load failed");
    }));
    const error = await fetchHealth().catch((cause) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("OFFLINE");
    expect(error.retryable).toBe(true);
    expect(failureSentence(error)).toContain("not reachable");
    expect(failureSentence(error)).toContain("no survey state was changed");
  });

  it("distinguishes a missing record from an unreachable service", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fail(404, "NOT_FOUND", "Runtime survey survey_x was not found.")));
    const error = await fetchRuntimeSurvey("survey_x").catch((cause) => cause);
    expect(error.kind).toBe("NOT_FOUND");
    expect(error.retryable).toBe(false);
    expect(failureSentence(error)).toBe("Runtime survey survey_x was not found.");
  });

  it("distinguishes a rejected upload from a service failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fail(422, "UNREADABLE_RASTER", "broken.png could not be read as an image.")));
    const rejected = await uploadSurvey(new File(["x"], "broken.png")).catch((cause) => cause);
    expect(rejected.kind).toBe("REJECTED");
    expect(rejected.code).toBe("UNREADABLE_RASTER");
    expect(rejected.retryable).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => fail(500, "INTERNAL", "worker died")));
    const broken = await uploadSurvey(new File(["x"], "pass.png")).catch((cause) => cause);
    expect(broken.kind).toBe("SERVER");
    expect(broken.retryable).toBe(true);
  });

  it("reports a non-JSON response as malformed rather than crashing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    } as unknown as Response)));
    const error = await fetchHealth().catch((cause) => cause);
    expect(error.kind).toBe("MALFORMED");
    expect(failureSentence(error)).toContain("does not recognise");
  });
});

describe("only safe requests are retried", () => {
  it("retries an idempotent read until it succeeds", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("Load failed");
      return ok({ survey_id: "survey_1", findings: [], frames: [] });
    }));
    const value = await fetchRuntimeSurvey("survey_1");
    expect(value.survey_id).toBe("survey_1");
    expect(calls).toBe(3);
  });

  it("keeps job polling cheap: one retry, so a poll never queues up behind itself", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      throw new TypeError("Load failed");
    }));
    await expect(fetchJob("job_1")).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(2);
  });

  it("never repeats an upload, because a repeat starts a second real inference run", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      throw new TypeError("Load failed");
    }));
    await expect(uploadSurvey(new File(["x"], "pass.png"))).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  it("never repeats a verdict, because the review log is append-only", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      throw new TypeError("Load failed");
    }));
    await expect(postReview("survey_1", "det_1", "CONFIRMED", "operator")).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  it("gives up on an unrecoverable read instead of hammering the service", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return fail(404, "NOT_FOUND", "gone");
    }));
    await expect(fetchRuntimeSurvey("survey_x")).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });
});

describe("a failed export is named, not left as a browser error", () => {
  it("classifies an unreachable service on the binary download path too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Load failed");
    }));
    const error = await fetchReportBlob("http://example.invalid/report").catch((cause) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("OFFLINE");
    expect(failureSentence(error)).toContain("not reachable");
  });

  it("surfaces the service's own reason when an export is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fail(422, "VALIDATION_FAILED", "scope must be contacts or observations")));
    const error = await fetchReportBlob("http://example.invalid/report").catch((cause) => cause);
    expect(error.kind).toBe("REJECTED");
    expect(failureSentence(error)).toBe("scope must be contacts or observations");
  });
});

describe("export urls name the object being exported", () => {
  it("defaults CSV to the operational object and can still export raw observations", () => {
    expect(reportUrl("survey_1", "csv")).toContain("scope=contacts");
    expect(reportUrl("survey_1", "csv", "observations")).toContain("scope=observations");
    expect(reportUrl("survey_1", "json")).not.toContain("scope");
  });
});

describe("survey state survives a transient failure", () => {
  const record = survey as unknown as { survey_id: string };

  function routeFetch(handler: (url: string) => Response | Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => handler(String(input))));
  }

  beforeEach(() => {
    window.localStorage.setItem(SURVEY_STORAGE_KEY, record.survey_id);
  });

  it("keeps the pointer to the open survey when the service is merely unreachable", async () => {
    routeFetch((url) => {
      if (url.includes("/runtime/health")) throw new TypeError("Load failed");
      throw new TypeError("Load failed");
    });
    render(<AqualensApp initial="results" />);
    await waitFor(
      () => expect(screen.getByText("This survey could not be loaded")).toBeInTheDocument(),
      { timeout: 6000 },
    );
    // The survey is still this session's survey: reconnecting must reopen it,
    // not ask the operator to upload the same raster again.
    expect(window.localStorage.getItem(SURVEY_STORAGE_KEY)).toBe(record.survey_id);
    // Stated in the shell strip and again on the screen the operator is looking at.
    expect(screen.getAllByText(/not reachable from this browser/).length).toBeGreaterThan(0);
  }, 15_000);

  it("clears the pointer only when the service says the record is gone", async () => {
    routeFetch((url) => {
      if (url.includes("/runtime/health")) return ok({ status: "ok", runtime_available: true, device: "cpu", model_loaded: false, model_sha256: "abc", class_names: {}, optional_models: {} });
      if (url.includes("/runtime/surveys?")) return ok({ items: [], total: 0 });
      return fail(404, "NOT_FOUND", "Runtime survey is no longer held.");
    });
    render(<AqualensApp initial="results" />);
    await waitFor(() => expect(window.localStorage.getItem(SURVEY_STORAGE_KEY)).toBeNull(), { timeout: 6000 });
    expect(screen.getByText(/no longer held by the analysis service/)).toBeInTheDocument();
  });

  it("offers a held survey for reconnect instead of a dead end", async () => {
    routeFetch((url) => {
      if (url.includes("/runtime/health")) return ok({ status: "ok", runtime_available: true, device: "cpu", model_loaded: false, model_sha256: "abc", class_names: {}, optional_models: {} });
      if (url.includes("/runtime/surveys?")) {
        return ok({
          items: [
            {
              survey_id: "survey_other",
              name: "earlier_pass.zip",
              created_at: "2026-09-05T08:00:00Z",
              frame_count: 1,
              finding_count: 2,
              contact_count: 1,
              reviewed_count: 0,
              navigation_status: "UNAVAILABLE",
            },
          ],
          total: 1,
        });
      }
      return fail(404, "NOT_FOUND", "Runtime survey is no longer held.");
    });
    render(<AqualensApp initial="results" />);
    await waitFor(() => expect(screen.getAllByText("earlier_pass.zip").length).toBeGreaterThan(0), { timeout: 6000 });
  });

  it("says the service is unreachable in the shell, not just on one screen", async () => {
    routeFetch(() => {
      throw new TypeError("Load failed");
    });
    render(<AqualensApp initial="results" />);
    await waitFor(() => expect(screen.getByText("Service unreachable")).toBeInTheDocument(), { timeout: 6000 });
  });
});
