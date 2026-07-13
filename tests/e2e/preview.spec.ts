import { expect, test } from "@playwright/test";

const screenshots = "artifacts/screenshots";
const preview = (query = "") =>
  `/?preview=1${query ? `&${query}` : ""}&time=19:43&weather=partly-cloudy&presence=1`;

async function capture(
  page: import("@playwright/test").Page,
  name: string,
  width = 1920,
  height = 1200,
): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.screenshot({ path: `${screenshots}/${name}.png` });
}

test("deterministic glance closely follows the 16:10 reference", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto(preview());
  await expect(page.getByRole("heading", { name: "Good evening, Sahith" })).toBeVisible();
  await expect(page.getByText("Partly cloudy", { exact: true })).toBeVisible();
  await expect(page.getByText("5 commits today", { exact: true })).toBeVisible();
  await expect(page.getByText("All tasks completed!", { exact: true })).toBeVisible();
  await capture(page, "clear-evening-glance-1920x1200");
});

test("rainy night remains composed at a second 16:10 viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(preview("time=22:15&weather=rain"));
  await expect(page.getByText("Rain", { exact: true })).toBeVisible();
  await expect(page.locator(".scores-card")).toBeVisible();
  await capture(page, "rainy-night-glance-1440x900", 1440, 900);
});

test("refined glass mock is captured at desktop size", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(preview("time=20:18&weather=partly-cloudy"));
  await expect(page.getByRole("heading", { name: "Good evening, Sahith" })).toBeVisible();
  await capture(page, "glass-refinement-1440x900", 1440, 900);
});

test("a short desktop window flows cards without overlap", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 840 });
  await page.goto(preview("time=08:10"));

  const blocks = await page
    .locator(".hero, .calendar-card, .contributions-card, .focus-card, .scores-card, .alarm-card")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
      }),
    );

  for (let index = 0; index < blocks.length; index += 1) {
    for (let comparison = index + 1; comparison < blocks.length; comparison += 1) {
      const left = blocks[index];
      const right = blocks[comparison];
      const overlaps =
        left.left < right.right &&
        left.right > right.left &&
        left.top < right.bottom &&
        left.bottom > right.top;
      expect(overlaps).toBe(false);
    }
  }
});

test("ambient and mid-reveal are deterministic", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto(preview("mode=ambient&presence=0"));
  await expect(page.locator(".ambient-display__islands")).toHaveCount(0);
  await capture(page, "ambient-no-ui-1920x1200");

  await page.goto(preview("mode=awakening"));
  await expect(page.locator(".hero")).toBeVisible();
  await page.waitForTimeout(220);
  await capture(page, "mid-reveal-1920x1200");
});

test("alarm, celebration, settings, and offline fallback render without layout failures", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1200 });

  await page.goto(preview("mode=alarm"));
  await expect(page.getByRole("dialog", { name: "Alarm" })).toBeVisible();
  await capture(page, "alarm-1920x1200");

  await page.goto(preview("mode=celebration"));
  await expect(page.getByText("All tasks completed!", { exact: true })).toBeVisible();
  await capture(page, "celebration-1920x1200");

  await page.goto(preview("mode=settings"));
  await expect(page.getByRole("dialog", { name: "Display settings" })).toBeVisible();
  await expect(page.getByText("In-app wallpaper", { exact: true })).toBeVisible();
  await expect(page.getByText("Google Calendar", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Google Calendar connects only from the native desktop app. Local reminders work in this preview.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await capture(page, "settings-1920x1200");

  await page.goto(preview("offline=1"));
  await expect(page.locator(".scores-card")).toHaveCount(0);
  await expect(page.getByText("5 commits today", { exact: true })).toBeVisible();
  await capture(page, "offline-fallback-1920x1200");
});

test("local camera presence is an explicit persisted opt-in and preview stays camera-free", async ({
  page,
}) => {
  await page.goto(preview("mode=settings"));

  await page.getByRole("button", { name: "Enable local camera presence" }).click();
  await expect(page.getByRole("button", { name: "Disable local camera presence" })).toBeVisible();
  await expect(
    page.getByText(
      "Saved locally. Future launches start local face detection; disable it to release the camera immediately.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Preview mode keeps the camera off. Keyboard and mouse wake are available.", {
      exact: true,
    }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Disable local camera presence" })).toBeVisible();

  await page.getByRole("button", { name: "Disable local camera presence" }).click();
  await expect(page.getByRole("button", { name: "Enable local camera presence" })).toBeVisible();
  await expect(
    page.getByText(
      "Off. No camera frames are stored or sent. Keyboard and mouse wake are available.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("typed commands update local-first data and keyboard shortcut recovers the overlay", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(preview("mode=interactive"));
  const command = page.getByRole("textbox", { name: "Command" });
  await command.fill("remind me tomorrow at 9 AM to call the dentist");
  await command.press("Enter");
  await expect(
    page.getByText("Reminder created: call the dentist.", { exact: true }),
  ).toBeVisible();

  await command.fill("add review motion to my tasks");
  await command.press("Enter");
  await expect(
    page.getByText("Added “review motion” to daily tasks.", { exact: true }),
  ).toBeVisible();

  await command.fill("mark review motion complete");
  await command.press("Enter");
  await expect(page.getByText("Marked “review motion” complete.", { exact: true })).toBeVisible();
  await capture(page, "interactive-commands-1440x900", 1440, 900);

  await page.goto(preview("mode=ambient&presence=0"));
  await expect(page.locator(".app-shell")).toHaveAttribute("data-display-mode", "ambient");
  await page.getByRole("button", { name: "Wake display" }).press("Control+Shift+Space");
  await expect(page.locator(".hero")).toBeVisible();
  await page.waitForTimeout(950);
  await expect(page.getByRole("heading", { name: "Good evening, Sahith" })).toBeVisible();
});

test("a normal launch never presents preview fixtures as real daily data", async ({ page }) => {
  await page.setViewportSize({ width: 1917, height: 1093 });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/?mode=glance");

  await expect(page.getByText("Weather unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("No events today", { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing planned yet", { exact: true })).toBeVisible();
  await expect(page.getByText("5 commits today", { exact: true })).toHaveCount(0);
  await expect(page.locator(".scores-card")).toHaveCount(0);
  await expect(page.getByText("Morning run", { exact: true })).toHaveCount(0);
  await capture(page, "classy-sparse-dell-1917x1093", 1917, 1093);
});
