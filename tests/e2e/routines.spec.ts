import { expect, test } from "@playwright/test";

const settingsPreview = "/?preview=1&mode=settings&time=19:43&weather=partly-cloudy&presence=1";

test("weekday-selected local routines persist from settings", async ({ page }) => {
  await page.goto(settingsPreview);

  const taskForm = page.getByRole("form", { name: "Add a local task" });
  await taskForm.getByRole("textbox", { name: "Task name" }).fill("Review weekly plan");
  await taskForm.getByRole("button", { name: "Repeat on Monday" }).click();
  await taskForm.getByRole("button", { name: "Repeat on Wednesday" }).click();
  await expect(taskForm.getByRole("button", { name: "Repeat on Monday" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await taskForm.getByRole("button", { name: "Add task" }).click();

  const reminderForm = page.getByRole("form", { name: "Add a local reminder" });
  await reminderForm.getByRole("textbox", { name: "Reminder name" }).fill("Stand and stretch");
  await reminderForm.getByRole("button", { name: "Repeat on Tuesday" }).click();
  await reminderForm.getByRole("button", { name: "Repeat on Thursday" }).click();
  await reminderForm.getByRole("button", { name: "Add reminder" }).click();

  const alarmForm = page.getByRole("form", { name: "Add a local alarm" });
  await alarmForm.getByRole("textbox", { name: "Alarm name" }).fill("Weekend walk");
  await alarmForm.getByRole("button", { name: "Repeat on Saturday" }).click();
  await alarmForm.getByRole("button", { name: "Repeat on Sunday" }).click();
  await alarmForm.getByRole("button", { name: "Add alarm" }).click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(window.localStorage.getItem("ambient-glass.local-data.preview.v1") ?? "{}"),
      ),
    )
    .toMatchObject({
      tasks: expect.arrayContaining([
        expect.objectContaining({ title: "Review weekly plan", daysOfWeek: [1, 3] }),
      ]),
      reminders: expect.arrayContaining([
        expect.objectContaining({
          title: "Stand and stretch",
          recurrence: { frequency: "weekly", daysOfWeek: [2, 4] },
        }),
      ]),
      alarms: expect.arrayContaining([
        expect.objectContaining({ label: "Weekend walk", daysOfWeek: [0, 6] }),
      ]),
    });
});
