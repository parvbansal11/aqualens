import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { RuntimeSurvey } from "../src/lib/runtime/wire";
const raw = JSON.parse(
  await readFile(
    new URL("./fixtures/runtime-survey.json", import.meta.url),
    "utf8",
  ),
) as RuntimeSurvey;
async function station(
  page: import("@playwright/test").Page,
  survey = "epitomeNavigated",
  role = "analyst",
) {
  await page.goto("/");
  await page.evaluate(
    ({ survey, role }) => {
      sessionStorage.setItem("astra.role", role);
      sessionStorage.setItem("astra.survey", survey);
    },
    { survey, role },
  );
}
test("canonical entry selects a survey before the four stations and Workspace Home", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "Launch Workspace", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/intake$/);
  await expect(
    page.getByRole("heading", { name: "Start with the survey." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Sonar Analyst/ })).toHaveCount(
    0,
  );
  await page
    .getByText("Explore an illustrative survey", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Harbour approach ILLUSTRATIVE" })
    .click();
  await expect(page).toHaveURL(/\/roles$/);
  for (const name of [
    "Field Officer",
    "Sonar Analyst",
    "Mission Supervisor",
    "Decision Viewer",
  ])
    await expect(
      page.getByRole("button", { name: new RegExp(name) }),
    ).toBeVisible();
  await page.getByRole("button", { name: /Sonar Analyst Follow/ }).click();
  await page.getByRole("button", { name: "Enter Workspace" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(
    page.getByRole("heading", { name: /harbour approach/i }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /harbour approach/i }),
  ).toBeVisible();
});
test("deep links respect exact role access", async ({ page }) => {
  await page.goto("/workspace/map");
  await expect(page).toHaveURL(/\/intake$/);
  await station(page, "epitomeNavigated", "decision");
  await page.goto("/workspace/map");
  await expect(page).toHaveURL(/\/workspace$/);
  await page.goto("/workspace/contact/CT-01");
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(
    page.getByRole("link", { name: "Review", exact: true }),
  ).toHaveCount(0);
});
test("sonar-only fixture removes geographic/depth components and leaves Contact workflow", async ({
  page,
}) => {
  await station(page, "epitomeNoNavigation");
  await page.goto("/workspace");
  await expect(page.getByRole("link", { name: "Open Map" })).toHaveCount(0);
  await page
    .getByRole("link", { name: "View Contacts", exact: true })
    .first()
    .click();
  await expect(page.locator(".result-row")).toHaveCount(3);
  await page.locator(".result-row").first().click();
  await expect(page.getByText("Depth", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Locate on map" })).toHaveCount(
    0,
  );
  await expect(page.getByText(/Navigation not supplied/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Inspect evidence", exact: true }),
  ).toBeVisible();
});
test("manual observation survives navigation, and evidence drawer returns keyboard focus", async ({
  page,
}) => {
  await station(page);
  await page.goto("/workspace/contact/CT-01");
  await expect(
    page.getByRole("button", { name: "Select observation 1" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Select observation 2" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Select observation 2" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Locate on map" }).click();
  await page.getByRole("link", { name: "Inspect Contact" }).click();
  await expect(
    page.getByRole("button", { name: "Select observation 2" }),
  ).toHaveAttribute("aria-pressed", "true");
  const viewport = page.getByRole("region", { name: /Sonar viewport/ });
  await viewport.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".sonar-stage")).toHaveCSS(
    "transform",
    "matrix(1.25, 0, 0, 1.25, -30, 0)",
  );
  await page.keyboard.press("0");
  await expect(page.locator(".sonar-stage")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)",
  );
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page.locator(".result-row").first().click();
  await expect(
    page.getByRole("button", { name: "Select observation 2" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Inspect evidence", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByText("Detector", { exact: true }).click();
  await expect(
    page.getByText(
      "No detector was run for this illustrative survey. Raw detector score is not supplied.",
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Inspect evidence", exact: true }),
  ).toBeFocused();
});
test("real file selection remains visible; no fake upload is allowed in detached mode", async ({
  page,
}) => {
  await station(page);
  await page.goto("/workspace/upload");
  await page
    .getByLabel("Choose sonar survey file")
    .setInputFiles("public/sonar/viator-detail.png");
  await expect(
    page.getByRole("heading", { name: "viator-detail.png" }),
  ).toBeVisible();
  await expect(page.getByText("1 sonar frame", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Process Survey" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Remove selected file" }).click();
  await expect(
    page.getByRole("heading", { name: "Drop your survey here." }),
  ).toBeVisible();
  await page.getByLabel("Choose sonar survey file").setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not sonar"),
  });
  await expect(page.getByRole("alert")).toContainText("Choose a PNG");
});
test("ZIP intake reports actual entries, not an assumed survey size", async ({
  page,
}) => {
  await station(page);
  await page.goto("/workspace/upload");
  await page
    .getByLabel("Choose sonar survey file")
    .setInputFiles("tests/fixtures/intake.zip");
  await expect(page.getByText("2 sonar frames", { exact: true })).toBeVisible();
  await expect(page.getByText("Navigation", { exact: true })).toBeVisible();
  await page.getByText("View bundle contents", { exact: true }).click();
  await expect(page.getByText("navigation.csv", { exact: true })).toBeVisible();
});
test("map selection, theme, layers and fit remain synchronized", async ({
  page,
}) => {
  await station(page);
  await page.goto("/workspace/map");
  await page.locator(".map-contact-row").first().click();
  await expect(page.locator(".contact-popup")).toContainText("CONTACT CT-01");
  await expect(page.locator(".depth-profile header")).toContainText("41.8 m");
  await page.locator(".map-contact-row").nth(1).click();
  await expect(page.locator(".map-contact-row.is-selected")).toContainText(
    "CT-02",
  );
  await expect(page.locator(".contact-popup")).toContainText("CONTACT CT-02");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Map layers", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Supplied depth", exact: true })
    .uncheck();
  await expect(page.locator(".depth-profile")).toHaveCount(0);
  await page.getByRole("button", { name: "Close map layers" }).click();
  await page.getByRole("button", { name: "Fit survey to map" }).click();
  await page.getByRole("button", { name: "Expand map" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.fullscreenElement?.classList.contains("survey-map"),
      ),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".contact-map-marker")).toHaveCount(3);
});
test("reduced motion and failed video sources retain a visible poster", async ({
  page,
}) => {
  await page.route("**/media/*.mp4", (r) => r.abort());
  await page.route("**/media/*.webm", (r) => r.abort());
  await page.goto("/");
  await expect(page.locator(".ocean-poster")).toBeVisible();
  await expect(page.locator(".ocean-video")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Aqualens", exact: true }),
  ).toBeVisible();
});
test("manual processing preview cannot imply inference on a selected file", async ({
  page,
}) => {
  await station(page);
  await page.goto("/workspace/processing?preview=1");
  await expect(
    page.getByText("PROCESSING PREVIEW", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Illustrative survey", { exact: true }),
  ).toBeVisible();
  while (await page.getByRole("button", { name: "Next phase" }).count())
    await page.getByRole("button", { name: "Next phase" }).click();
  await page.getByRole("link", { name: "Choose your station" }).click();
  await expect(page).toHaveURL(/\/roles$/);
  await page.getByRole("button", { name: "Enter Workspace" }).click();
  await page
    .getByRole("link", { name: "View Contacts", exact: true })
    .first()
    .click();
  await expect(page.locator(".result-row")).toHaveCount(3);
});
test("configured adapter follows only backend job events, keeping filename through readiness", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let polls = 0,
    uploads = 0;
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    let body: unknown;
    if (url.endsWith("/runtime/health"))
      body = { status: "ok", runtime_available: true, model_loaded: false };
    else if (url.includes("/runtime/surveys?")) body = { items: [], total: 0 };
    else if (url.endsWith("/surveys/upload")) {
      uploads++;
      body = { job_id: "job-qa", survey_id: raw.survey_id, state: "QUEUED" };
    } else if (url.endsWith("/jobs/job-qa")) {
      polls++;
      body = {
        job_id: "job-qa",
        survey_id: raw.survey_id,
        state: polls < 3 ? "INFERENCE" : "COMPLETED",
        stage: "inference",
        files_parsed: 1,
        images_processed: polls < 3 ? 0 : 1,
        tiles_processed: 0,
        detections_generated: 0,
        steps: [
          {
            id: "inference",
            label: "Detector inference",
            state: polls < 3 ? "running" : "done",
          },
        ],
        upload: {
          filename: "viator-detail.png",
          bytes: 2048,
          kind: "RASTER",
          decoded: true,
          raster_count: 1,
        },
      };
    } else if (url.endsWith("/raster")) {
      await route.fulfill({
        contentType: "image/png",
        body: await readFile("public/sonar/viator-detail.png"),
      });
      return;
    } else if (url.endsWith(`/runtime/surveys/${raw.survey_id}`))
      body = {
        ...raw,
        name: "API contract QA fixture",
        mission: {
          ...raw.mission,
          notes: "SYNTHETIC_DEMO_METADATA: supplied only for this bundle.",
        },
      };
    else {
      await route.fulfill({
        status: 404,
        json: { error: { message: "QA route missing" } },
      });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.goto("http://127.0.0.1:5274/");
  await page.evaluate(() => sessionStorage.setItem("astra.role", "analyst"));
  await page.goto("http://127.0.0.1:5274/workspace/upload");
  await expect(
    page.getByText("Service connected", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Choose sonar survey file")
    .setInputFiles("public/sonar/viator-detail.png");
  await page.getByRole("button", { name: "Process Survey" }).click();
  await expect(page).toHaveURL(/\/processing$/);
  await expect(page.locator(".processing-file")).toContainText(
    "viator-detail.png",
  );
  await expect(page).toHaveURL(/\/roles$/, { timeout: 12000 });
  await page.getByRole("button", { name: "Enter Workspace" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await page
    .getByRole("link", { name: "View Contacts", exact: true })
    .first()
    .click();
  expect(uploads).toBe(1);
  expect(polls).toBe(3);
  expect(
    await page.evaluate(() => sessionStorage.getItem("astra.survey")),
  ).toBe(raw.survey_id);
  await expect(
    page.getByRole("combobox", { name: "Current survey" }),
  ).toHaveValue(raw.survey_id);
  await expect(page.locator(".result-row")).toHaveCount(
    raw.contacts?.length ?? 0,
  );
  await page.getByRole("link", { name: "Open Map", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Follow the survey." }),
  ).toBeVisible();
  await expect(
    page.getByText("Illustrative survey metadata · not field measurements"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand map" })).toBeVisible();
  await expect(page.locator(".contact-map-marker")).toHaveCount(
    raw.contacts?.filter((c) => c.latitude != null && c.longitude != null)
      .length ?? 0,
  );
  await page.waitForTimeout(1200);
  await expect(page.locator(".depth-profile")).toHaveCount(0);
  await page.screenshot({ path: "qa/screenshots/map-runtime-no-depth.png" });
  expect(errors).toEqual([]);
});
