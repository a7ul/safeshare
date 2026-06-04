import { test, expect } from "@playwright/test";

test.describe("Upload page", () => {
  test("loads correctly and shows the drop zone and mode toggle", async ({ page }) => {
    await page.goto("/");

    // Page heading
    await expect(page.getByRole("heading", { name: "Share anything, privately." })).toBeVisible();

    // Subtitle
    await expect(page.getByText("End-to-end encrypted")).toBeVisible();

    // Mode toggle buttons
    await expect(page.getByRole("button", { name: "Files" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Note" })).toBeVisible();

    // Drop zone visible in default file mode
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

    // Switch to Note mode
    await page.getByRole("button", { name: "Note" }).click();

    // Drop zone should be gone, note textarea should appear
    await expect(page.getByText("Drop files or click to browse")).not.toBeVisible();
    await expect(page.getByPlaceholder("Type your secure note…")).toBeVisible();

    // Note button should be active
    await expect(page.getByRole("button", { name: "Note" })).toHaveClass(/active/);

    // Switch back to Files mode
    await page.getByRole("button", { name: "Files" }).click();

    // Drop zone should reappear
    await expect(page.getByText("Drop files or click to browse")).toBeVisible();
    await expect(page.getByRole("button", { name: "Files" })).toHaveClass(/active/);
  });

  test("Encrypt & share button is disabled when no note text is entered", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Note" }).click();

    const shareBtn = page.getByRole("button", { name: /Encrypt & share/ });
    await expect(shareBtn).toBeDisabled();
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

    // In Files mode with no files, button should be disabled
    const shareBtn = page.getByRole("button", { name: /Encrypt & share/ });
    await expect(shareBtn).toBeDisabled();
  });

  test("brand title and security messaging are visible", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Secure File Share")).toBeVisible();
    await expect(page.getByText(/server never sees your content/i)).toBeVisible();
  });
});

test.describe("Download page — error states", () => {
  test("shows error when no hash is present in the URL", async ({ page }) => {
    await page.goto("/d/m");

    // Should show error state — no hash means no decryption key
    await expect(page.getByRole("heading", { name: "Something went wrong." })).toBeVisible();
    await expect(page.getByText(/No decryption key found in the URL/i)).toBeVisible();
  });

  test("shows error box with helpful message on invalid hash", async ({ page }) => {
    await page.goto("/d/m#notavalidhash");

    // Should transition to error state
    await expect(page.getByRole("heading", { name: "Something went wrong." })).toBeVisible();

    // Error box should be visible
    const errorBox = page.locator(".error-box");
    await expect(errorBox).toBeVisible();
  });

  test("shows a link to go back to the upload page from the download error page", async ({ page }) => {
    await page.goto("/d/m");

    await expect(page.getByRole("link", { name: /Share your own file securely/i })).toBeVisible();
  });

  test("navigating from download error page back to upload page works", async ({ page }) => {
    await page.goto("/d/m");

    await page.getByRole("link", { name: /Share your own file securely/i }).click();

    // Should be back on the upload page
    await expect(page.getByRole("heading", { name: "Share anything, privately." })).toBeVisible();
  });
});

test.describe("Download page — manifest loading", () => {
  test("shows loading state briefly before transitioning", async ({ page }) => {
    // Provide a valid-looking but fake manifest (base64url-encoded JSON)
    // The manifest decoding will fail gracefully
    const fakeManifest = btoa(JSON.stringify([
      { id: "fake-id-123", key: "fakekey", name: "test.txt", size: 100, mime: "text/plain" },
    ])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    await page.goto(`/d/m#${fakeManifest}`);

    // With a valid manifest structure, it should reach "ready" state
    // (even though the file won't actually download — no real server file)
    await expect(page.getByText(/file is ready|files ready/i)).toBeVisible({ timeout: 5000 });
  });

  test("download page shows file name from manifest", async ({ page }) => {
    const fakeManifest = btoa(JSON.stringify([
      { id: "fake-id-456", key: "fakekey", name: "secret-document.pdf", size: 2048, mime: "application/pdf" },
    ])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    await page.goto(`/d/m#${fakeManifest}`);

    await expect(page.getByText("secret-document.pdf")).toBeVisible({ timeout: 5000 });
  });

  test("download page shows the CTA to share your own file", async ({ page }) => {
    const fakeManifest = btoa(JSON.stringify([
      { id: "fake-id-789", key: "fakekey", name: "test.txt", size: 50, mime: "text/plain" },
    ])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    await page.goto(`/d/m#${fakeManifest}`);

    await expect(page.getByRole("link", { name: /Share your own file securely/i })).toBeVisible({ timeout: 5000 });
  });
});
