#!/usr/bin/env node
/**
 * TurboScribe 自动转写
 *
 * 流程: 登录 → 上传 → 配置(鲸鱼模式+说话人识别) → 提交 → 等待 → 下载
 *
 * 用法:
 *   TURBOSCRIBE_EMAIL=... TURBOSCRIBE_PASSWORD=... node upload.js <音频文件> [语言]
 *
 * 模式选择器:
 *   - 鲸 (Whale/large-v2) - 最准确, 默认已选
 *   - 海豚 (Dolphin/small) - 平衡
 *   - 猎豹 (Cheetah/base) - 最快
 *
 * 表单字段:
 *   - name="language"            → 音频语言 (select)
 *   - name="whisper-model"       → 转录模式 (radio: base/small/large-v2)
 *   - name="bool:diarize?"       → 说话人识别 (checkbox)
 *   - name="int:num-speakers"    → 说话人数 (select: 2-8 or -1=自动)
 *   - name="bool:translate-to-english?" → 转译为英语 (checkbox)
 *   - name="bool:clean-up-audio?"      → 音频修复 (checkbox)
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

// === CREDENTIALS (from env) ===
const EMAIL = process.env.TURBOSCRIBE_EMAIL;
const PASSWORD = process.env.TURBOSCRIBE_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('❌ 请设置环境变量: TURBOSCRIBE_EMAIL 和 TURBOSCRIBE_PASSWORD');
  process.exit(1);
}

// === CONFIG ===
const AUDIO_FILE = process.argv[2];
const LANGUAGE = process.argv[3] || 'English';
const OUTPUT_DIR = path.join(process.env.HOME, 'Downloads', 'turboscribe');
const USER_DATA_DIR = path.join(process.env.HOME, '.openclaw', 'browser-profiles', 'turboscribe');

if (!AUDIO_FILE || !fs.existsSync(AUDIO_FILE)) {
  console.error('用法: node upload.js <音频文件路径> [语言]');
  console.error('语言选项: Chinese, English, "Chinese (Simplified)" 等');
  process.exit(1);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const SLEEP = ms => new Promise(r => setTimeout(r, ms));

// === CLOUDFLARE / ANTI-DETECTION ===
const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.chrome = { runtime: {} };
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN','en-US','en'] });
`;

const TURBOSCRIBE_CONFIG = {
  loginUrl: 'https://turboscribe.ai/login',
  dashboardUrl: 'https://turboscribe.ai/zh-CN/dashboard',
};

// === MAIN ===
async function main() {
  const audioName = path.basename(AUDIO_FILE);
  const fileSizeMB = (fs.statSync(AUDIO_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`\n🎤 ${audioName}  (${fileSizeMB} MB)`);
  console.log(`🗣️  语言: ${LANGUAGE}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = await context.newPage();
  await page.addInitScript(STEALTH_SCRIPT);

  let currentStep = '';
  const step = (s) => { currentStep = s; console.log(`▸ ${s}`); };

  try {

    // ── STEP 1: Login ──
    step('登录中...');
    await page.goto(TURBOSCRIBE_CONFIG.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await SLEEP(3000);

    if (page.url().includes('/login')) {
      console.log('  需要重新登录...');
      await page.goto(TURBOSCRIBE_CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await SLEEP(2000);

      await page.locator('input[name="email"]').waitFor({ state: 'visible', timeout: 15000 });
      await page.locator('input[name="email"]').fill(EMAIL);
      await page.locator('input[name="password"]').fill(PASSWORD);
      await page.locator('button:has-text("Log In")').click();
      await SLEEP(5000);

      if (page.url().includes('/login')) {
        console.error('❌ 登录失败 - 可能需要手动解决 Cloudflare Turnstile');
        console.log('   浏览器保持开启，请手动完成验证后继续...');
        await SLEEP(120000);
      }
    }
    console.log(`✅ 已登录\n`);

    // ── STEP 2: Open upload modal ──
    step('打开转写面板...');
    await page.goto(TURBOSCRIBE_CONFIG.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await SLEEP(2000);

    const uploadBtn = page.locator('span.dui3-modal-button:has-text("转录文件")').first();
    if (await uploadBtn.count() > 0 && await uploadBtn.isVisible().catch(() => false)) {
      await uploadBtn.click();
    } else {
      await page.locator('span:has-text("转录文件"):visible').first().click({ timeout: 10000 });
    }
    await SLEEP(2000);

    // ── STEP 3: Upload file ──
    step(`上传: ${audioName}...`);

    const fileInput = page.locator('form:has(h2:has-text("转录文件")) input[type="file"]').first();
    await fileInput.setInputFiles(AUDIO_FILE);
    console.log('   ✅ 文件已选择');
    console.log(`   ⏳ 上传中 (${fileSizeMB}MB)...`);

    const uploadStart = Date.now();
    const uploadTimeout = 900000; // 15min
    let handlesPopulated = false;
    let lastProgress = '';

    while (Date.now() - uploadStart < uploadTimeout) {
      await SLEEP(5000);
      const state = await page.evaluate(() => {
        const handles = document.querySelector('input[name="json:handles"]');
        const pct = document.querySelector('[data-dz-uploadprogress-percentage]');
        const err = document.querySelector('[data-dz-errormessage]');
        return {
          handlesVal: handles?.value || '',
          progress: pct?.textContent || '',
          error: err?.textContent || '',
        };
      });

      if (state.progress !== lastProgress) {
        process.stdout.write(`\r   ⏳ 上传: ${state.progress}`);
        lastProgress = state.progress;
      }

      if (state.handlesVal) {
        process.stdout.write('\n');
        console.log('   ✅ 上传+服务端处理完成');
        handlesPopulated = true;
        break;
      }

      if (state.error) {
        console.log(`\n   ❌ 上传错误: ${state.error}`);
        break;
      }
    }

    if (!handlesPopulated) {
      console.log(`\n   ❌ 上传超时 (${Math.round((Date.now() - uploadStart) / 1000)}s)`);
      await context.close();
      process.exit(1);
    }

    // ── STEP 4: Configure ──
    step('配置转写选项...');

    await page.locator('select[name="language"]').selectOption(LANGUAGE);
    console.log(`   ✅ 语言: ${LANGUAGE}`);

    const whaleRadio = page.locator('input[name="whisper-model"][value="large-v2"]');
    if (!await whaleRadio.isChecked()) {
      await whaleRadio.check({ force: true });
    }
    console.log('   ✅ 模式: 鲸 (Whale/large-v2)');

    // Expand speaker settings
    const speakerSection = page.locator('form div.cursor-pointer:has-text("说话人识别")').first();
    if (await speakerSection.count() > 0) {
      await speakerSection.scrollIntoViewIfNeeded();
      await SLEEP(300);
      await speakerSection.click();
      await SLEEP(500);
      console.log('   ✅ 展开设置面板');
    }

    const diarizeCb = page.locator('form input[name="bool:diarize?"]');
    if (await diarizeCb.count() > 0) {
      await diarizeCb.scrollIntoViewIfNeeded();
      await SLEEP(200);
      if (!await diarizeCb.isChecked()) {
        await diarizeCb.check({ force: true });
        await SLEEP(500);
      }
      console.log('   ✅ 说话人识别: 开启');

      const speakerCount = page.locator('form select[name="int:num-speakers"]');
      if (await speakerCount.count() > 0) {
        await speakerCount.scrollIntoViewIfNeeded();
        await speakerCount.selectOption('-1');
        console.log('   ✅ 说话人数: 自动检测');
      }
    }

    // Ensure translate & cleanup are off
    const translateCb = page.locator('form input[name="bool:translate-to-english?"]');
    if (await translateCb.count() > 0 && await translateCb.isChecked()) await translateCb.uncheck({ force: true });
    const cleanupCb = page.locator('form input[name="bool:clean-up-audio?"]');
    if (await cleanupCb.count() > 0 && await cleanupCb.isChecked()) await cleanupCb.uncheck({ force: true });

    // ── STEP 5: Submit ──
    step('提交转写任务...');

    const submitBtn = page.locator('button[type="submit"]:has-text("转录")');
    await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
    await SLEEP(1000);

    await page.evaluate(() => {
      const overlays = document.querySelectorAll('.dz-message, .dz-default');
      overlays.forEach(el => { el.style.pointerEvents = 'none'; });
      const btn = document.querySelector('button[type="submit"]');
      if (btn) {
        btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        btn.click();
      }
    });
    console.log('   ✅ 已提交\n');
    await SLEEP(3000);

    // Verify
    await page.goto(TURBOSCRIBE_CONFIG.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await SLEEP(2000);
    const dbText = await page.textContent('body');
    if (dbText.includes('处理中') || dbText.includes('Processing')) {
      console.log('   ✅ 转录任务已开始');
    }

    // ── STEP 6: Wait for completion ──
    step('等待转写完成...');
    const maxWaitMinutes = 60;
    const pollIntervalMs = 300000; // 5min
    const startTime = Date.now();

    for (let elapsed = 0; elapsed < maxWaitMinutes; elapsed++) {
      await SLEEP(pollIntervalMs);
      const minutes = Math.round((Date.now() - startTime) / 60000);

      await page.goto(TURBOSCRIBE_CONFIG.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await SLEEP(2000);

      const pageText = await page.textContent('body');

      if (pageText.includes('已完成') || pageText.includes('Completed')) {
        console.log(`\n✅ 转写完成! (${minutes} 分钟)\n`);
        break;
      }

      if (pageText.includes('处理中') || pageText.includes('Processing')) {
        process.stdout.write(`\r   ⏳ ${minutes} 分钟... 处理中`);
        continue;
      }

      console.log(`   ⏳ ${minutes} 分钟...`);
    }

    // ── STEP 7: Download ──
    step('下载转写结果...');

    const firstRow = page.locator('tr:has-text("已完成"), tr:has-text("Complete")').first();
    if (await firstRow.count() > 0) {
      await firstRow.click();
      await SLEEP(3000);
    }

    const downloadBtn = page.locator([
      'button:has-text("下载")',
      'button:has-text("Download")',
      'button:has-text("导出")',
      'a:has-text("下载")',
      'a:has-text("Download")',
    ].join(',')).first();

    if (await downloadBtn.count() > 0 && await downloadBtn.isVisible().catch(() => false)) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
        downloadBtn.click(),
      ]);

      if (download) {
        const savePath = path.join(OUTPUT_DIR, download.suggestedFilename() || `transcript-${Date.now()}.docx`);
        await download.saveAs(savePath);
        console.log(`   ✅ 已保存: ${savePath}`);
      }
    } else {
      const pageText = await page.textContent('body');
      const txtPath = path.join(OUTPUT_DIR, `transcript-${Date.now()}.txt`);
      fs.writeFileSync(txtPath, pageText);
      console.log(`   📄 文本保存: ${txtPath}`);
    }

    console.log('\n🏁 完成! 输出目录:', OUTPUT_DIR);

  } catch (err) {
    console.error(`\n❌ 错误 [${currentStep}]:`, err.message);
    try { await page.screenshot({ path: '/tmp/ts-error-latest.png' }); } catch {}
  } finally {
    await context.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
