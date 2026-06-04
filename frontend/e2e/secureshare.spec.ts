import { test, expect } from "@playwright/test";

test.describe("Upload page", () => {
  test("loads correctly and shows the drop zone and mode toggle", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Share files, notes and secrets securely." })).toBeVisible();
    await expect(page.getByText("End-to-end encrypted")).toBeVisible();
    await expect(page.getByRole("button", { name: "Files" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Note" })).toBeVisible();
    await expect(page.getByText("Drop files or click to browse")).toBeVisible();
  });

  test("Files mode is active by default", async ({ page }) => {
    await page.goto("/");

    const filesBtn = page.getByRole("button", { name: "Files" });
    await expect(filesBtn).toHaveClass(/active/);

    const noteBtn = page.getByRole("button", { name: "Note" });
    await expect(noteBtn).not.toHaveClass(/active/);
  });

  test("can switch to Note mode and back to Files mode", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Note" }).click();

    await expect(page.getByText("Drop files or click to browse")).not.toBeVisible();
    await expect(page.getByPlaceholder("Type your secure note…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Note" })).toHaveClass(/active/);

    await page.getByRole("button", { name: "Files" }).click();

    await expect(page.getByText("Drop files or click to browse")).toBeVisible();
    await expect(page.getByRole("button", { name: "Files" })).toHaveClass(/active/);
  });

  test("Encrypt & share button is disabled when no note text is entered", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Note" }).click();

    await expect(page.getByRole("button", { name: /Encrypt & share/ })).toBeDisabled();
  });

  test("Encrypt & share button becomes enabled after typing a note", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Note" }).click();

    const shareBtn = page.getByRole("button", { name: /Encrypt & share/ });
    await expect(shareBtn).toBeDisabled();

    await page.getByPlaceholder("Type your secure note…").fill("Hello, this is a secret note!");
    await expect(shareBtn).toBeEnabled();
  });

  test("Encrypt & share button is disabled when in Files mode with no files selected", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Encrypt & share/ })).toBeDisabled();
  });

  test("expiry picker is visible with 7 days selected by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Expires after")).toBeVisible();
    await expect(page.getByRole("button", { name: "7 days" })).toHaveClass(/active/);
  });

  test("security messaging is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/encrypted between your browser/i)).toBeVisible();
  });
});

test.describe("Download page — error states", () => {
  test("shows error when no hash is present in the URL", async ({ page }) => {
    await page.goto("/d/m");
    await expect(page.getByRole("heading", { name: "Something went wrong." })).toBeVisible();
    await expect(page.getByText(/No decryption key found in the URL/i)).toBeVisible();
  });

  test("shows error box with helpful message on invalid hash", async ({ page }) => {
    await page.goto("/d/m#notavalidhash");
    await expect(page.getByRole("heading", { name: "Something went wrong." })).toBeVisible();
    await expect(page.locator(".error-box")).toBeVisible();
  });

  test("shows a link to go back to the upload page from the download error page", async ({ page }) => {
    await page.goto("/d/m");
    await expect(page.getByRole("link", { name: /Share your own file securely/i })).toBeVisible();
  });

  test("navigating from download error page back to upload page works", async ({ page }) => {
    await page.goto("/d/m");
    await page.getByRole("link", { name: /Share your own file securely/i }).click();
    await expect(page.getByRole("heading", { name: "Share files, notes and secrets securely." })).toBeVisible({ timeout: 8000 });
  });
});

test.describe("Download page — manifest loading", () => {
  // Helpers to build fake manifests (include expiresAt as the real app does)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  function fakeManifest(entries: object[]) {
    return btoa(JSON.stringify(entries))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  test("shows loading state briefly before transitioning", async ({ page }) => {
    const manifest = fakeManifest([
      { id: "fake-id-123", key: "fakekey", name: "test.txt", size: 100, mime: "text/plain", expiresAt },
    ]);
    await page.goto(`/d/m#${manifest}`);
    await expect(page.getByText(/file is ready|files ready/i)).toBeVisible({ timeout: 5000 });
  });

  test("download page shows file name from manifest", async ({ page }) => {
    const manifest = fakeManifest([
      { id: "fake-id-456", key: "fakekey", name: "secret-document.pdf", size: 2048, mime: "application/pdf", expiresAt },
    ]);
    await page.goto(`/d/m#${manifest}`);
    await expect(page.getByText("secret-document.pdf")).toBeVisible({ timeout: 5000 });
  });

  test("download page shows the CTA to share your own file", async ({ page }) => {
    const manifest = fakeManifest([
      { id: "fake-id-789", key: "fakekey", name: "test.txt", size: 50, mime: "text/plain", expiresAt },
    ]);
    await page.goto(`/d/m#${manifest}`);
    await expect(page.getByRole("link", { name: /Share your own file securely/i })).toBeVisible({ timeout: 5000 });
  });

  test("download page shows expiry label from manifest", async ({ page }) => {
    const manifest = fakeManifest([
      { id: "fake-id-exp", key: "fakekey", name: "test.txt", size: 50, mime: "text/plain", expiresAt },
    ]);
    await page.goto(`/d/m#${manifest}`);
    await expect(page.getByText(/Expires in/i)).toBeVisible({ timeout: 5000 });
  });
});
