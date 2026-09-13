import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.viewport canvas')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.save-state')).toHaveText('Saved on this device');
});

test('desktop scene is rendered, responsive, and the main run is physical', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'Color sorting', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/desktop-workbench.png', fullPage: true });
  const pixels = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const copy = document.createElement('canvas');
    copy.width = 80;
    copy.height = 80;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, 80, 80);
    const data = ctx.getImageData(0, 0, 80, 80).data;
    const colors = new Set<string>();
    for (let i = 0; i < data.length; i += 4)
      colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
    return colors.size;
  });
  expect(pixels).toBeGreaterThan(35);
  await page.getByRole('combobox', { name: 'Simulation speed' }).selectOption('4');
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-run-status', 'running');
  await expect(page.locator('.app')).toHaveAttribute('data-run-status', 'complete', {
    timeout: 30000,
  });
  await expect(page.getByText('All objects on target', { exact: true })).toBeVisible();
  await expect(page.locator('.pass-tag')).toHaveCount(3);
  await page.screenshot({ path: 'docs/completed-run.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('pause, task step, undo, editing and project export round trip', async ({ page }) => {
  await page.getByRole('button', { name: 'Step one task', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-run-status', 'paused');
  await expect(page.getByRole('button', { name: 'Resume simulation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.locator('.task-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Undo edit' }).click();
  await expect(page.locator('.task-card')).toHaveCount(3);
  await page.getByRole('textbox', { name: 'Project name' }).fill('My verified routine');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue(
    'My verified routine',
  );
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('robot-task.json');
  const path = await download.path();
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.getByText('Project imported.', { exact: true })).toBeVisible();
});

test('ten-layout benchmark finishes and exports real results', async ({ page }) => {
  await page.getByRole('tab', { name: 'Runs', exact: true }).click();
  await page.getByRole('button', { name: 'Test 10 layouts' }).click();
  await expect(page.locator('.batch-seeds .pass')).toHaveCount(10, { timeout: 30000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export validation CSV' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('robot-task-results.csv');
});

test('stacking lab runs and Python is a distinct export', async ({ page }) => {
  await page.getByRole('button', { name: /Lab library/ }).click();
  await page.locator('.library-item').filter({ hasText: 'Build a tower' }).click();
  await expect(page.getByRole('heading', { name: 'Build a tower', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Simulation speed' }).selectOption('4');
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(page.getByText('All objects on target', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Python recipe' }).click();
  await expect(page.locator('.export-code')).toContainText('class RobotAdapter');
  await expect(page.locator('.export-code')).toContainText('not a hardware driver');
});

test('precision lab exposes failures and invalid imports do not replace the project', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Lab library/ }).click();
  await page.locator('.library-item').filter({ hasText: 'Precision placement' }).click();
  await page.getByRole('slider', { name: 'Placement offset' }).fill('0.08');
  await page.getByRole('combobox', { name: 'Simulation speed' }).selectOption('4');
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(page.getByText('Placement needs a correction', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator('.fail-tag')).toHaveCount(3);
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(
    page.getByRole('heading', { name: 'Precision placement', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.toast')).toBeVisible();
});

test('canvas frames are nonblank and camera interaction works across viewports', async ({
  page,
}) => {
  const canvas = page.locator('.viewport canvas');
  async function sample() {
    return canvas.evaluate((source: HTMLCanvasElement) => {
      const copy = document.createElement('canvas');
      copy.width = 100;
      copy.height = 100;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(source, 0, 0, 100, 100);
      const data = ctx.getImageData(0, 0, 100, 100).data;
      const colors = new Set<string>();
      let checksum = 0;
      for (let i = 0; i < data.length; i += 4) {
        colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
        checksum = (checksum + data[i] * i + data[i + 1]) >>> 0;
      }
      return { colors: colors.size, checksum };
    });
  }
  for (const [width, height] of [
    [320, 740],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => (await sample()).colors).toBeGreaterThan(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `docs/viewport-${width}.png`, fullPage: true });
  }
  const before = (await sample()).checksum;
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('top');
  await expect.poll(async () => (await sample()).checksum).not.toBe(before);
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('perspective');
  const box = (await canvas.boundingBox())!;
  const startX = box.x + box.width * 0.5,
    startY = box.y + box.height * 0.6;
  const beforeOrbit = (await sample()).checksum;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 100, startY + 30, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await sample()).checksum).not.toBe(beforeOrbit);
  const beforeRun = (await sample()).checksum;
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect.poll(async () => (await sample()).checksum).not.toBe(beforeRun);
});

test('mobile workspace has a nonblank canvas and reachable controls without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.viewport canvas')).toBeVisible();
  await page.screenshot({ path: 'docs/mobile-workbench.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-run-status', 'paused');
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Task destination' })).toBeVisible();
  await page.screenshot({ path: 'docs/mobile-inspector.png', fullPage: true });
});
