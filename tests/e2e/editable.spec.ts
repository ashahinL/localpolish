import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

// Closing a context exits Chromium when it was launched with --single-process.
// Keep one context for the worker and open a new page per test.
const test = base.extend<{ page: Page }, { sharedContext: BrowserContext }>({
  sharedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: 'http://localhost:5179' });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  page: async ({ sharedContext }, use) => {
    const page = await sharedContext.newPage();
    await use(page);
    await page.close();
  },
});

type ApplyResult = { ok: true } | { ok: false; reason: 'changed' | 'rejected' };

type PageApi = {
  __t: { text: string } | null;
  __lp: {
    captureTarget: (opts: { wholeFieldIfEmpty: boolean }) => { text: string } | null;
    applyReplacement: (target: { text: string } | null, text: string) => Promise<ApplyResult>;
    draftText: () => string;
    lexicalBlocks: () => string[];
  };
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => {
    const api = (window as unknown as Partial<PageApi>).__lp;
    return typeof api?.draftText === 'function';
  });
});

test('textarea replaces the selection and undoes it', async ({ page }) => {
  await page.locator('#ta').click();
  await page.keyboard.type('i has went home');
  await page.locator('#ta').evaluate((el) => {
    if (!(el instanceof HTMLTextAreaElement)) throw new Error('expected textarea');
    el.setSelectionRange(2, 10);
  });

  expect(await captureText(page, false)).toBe('has went');
  await page.locator('#outside').click();
  expect(await apply(page, 'went')).toEqual({ ok: true });
  await expect(page.locator('#ta')).toHaveValue('i went home');

  await page.locator('#ta').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#ta')).toHaveValue('i has went home');
});

test('input replaces the whole selection', async ({ page }) => {
  await page.locator('#inp').click();
  await page.keyboard.type('she dont like it');
  await page.keyboard.press('ControlOrMeta+a');

  expect(await captureText(page, false)).toBe('she dont like it');
  await page.locator('#outside').click();
  expect(await apply(page, "She doesn't like it.")).toEqual({ ok: true });
  await expect(page.locator('#inp')).toHaveValue("She doesn't like it.");
});

test('email input is not a target', async ({ page }) => {
  await page.locator('#email').click();
  await page.keyboard.type('ada@example.com');
  expect(await captureText(page, true)).toBeNull();
});

test('plain contenteditable replaces the selection', async ({ page }) => {
  await page.locator('#ce').click();
  await page.keyboard.type('i has went home');
  await page.keyboard.press('ControlOrMeta+a');

  expect(await captureText(page, false)).toBe('i has went home');
  await page.locator('#outside').click();
  expect(await apply(page, 'I went home.')).toEqual({ ok: true });
  expect((await page.locator('#ce').innerText()).trim()).toBe('I went home.');
});

test('Draft.js updates its editor state', async ({ page }) => {
  await page.locator('#draft .public-DraftEditor-content').click();
  await page.keyboard.type('i has went home');
  await page.keyboard.press('ControlOrMeta+a');

  expect(await captureText(page, false)).toBe('i has went home');
  await page.locator('#outside').click();
  expect(await apply(page, 'I went home.')).toEqual({ ok: true });
  const draftText = () => page.evaluate(() => (window as unknown as PageApi).__lp.draftText());
  expect(await draftText()).toBe('I went home.');

  await page.locator('#draft .public-DraftEditor-content').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await expect.poll(draftText).toBe('I went home');
});

test('Lexical keeps line breaks and undoes the change', async ({ page }) => {
  const blocks = () => page.evaluate(() => (window as unknown as PageApi).__lp.lexicalBlocks());
  await page.locator('#lexical').click();
  await page.keyboard.type('hi ahmed,');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('hope you are havng a god day');
  await page.keyboard.press('ControlOrMeta+a');

  expect(await captureText(page, false)).toBe('hi ahmed,\n\nhope you are havng a god day');
  await page.locator('#outside').click();
  expect(await apply(page, 'Hi Ahmed,\n\nHope you are having a good day!')).toEqual({ ok: true });
  expect(await blocks()).toEqual(['Hi Ahmed,', '', 'Hope you are having a good day!']);

  await page.locator('#lexical').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(blocks).toEqual(['hi ahmed,', '', 'hope you are havng a god day']);
});

test('apply reports changed when the field text moved', async ({ page }) => {
  await page.locator('#ta').click();
  await page.keyboard.type('i has went home');
  await page.locator('#ta').evaluate((el) => {
    if (!(el instanceof HTMLTextAreaElement)) throw new Error('expected textarea');
    el.setSelectionRange(2, 10);
  });
  expect(await captureText(page, false)).toBe('has went');
  await page.locator('#outside').click();

  await page.locator('#ta').evaluate((el) => {
    if (!(el instanceof HTMLTextAreaElement)) throw new Error('expected textarea');
    el.value = 'something else';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  expect(await apply(page, 'went')).toEqual({ ok: false, reason: 'changed' });
  await expect(page.locator('#ta')).toHaveValue('something else');
});

for (const [name, selector] of [
  ['Lexical', '#lexical'],
  ['Draft.js', '#draft .public-DraftEditor-content'],
] as const) {
  test(`${name} does not paste into another editor during the wait`, async ({ page }) => {
    await page.locator(selector).click();
    await page.keyboard.type('i has went home');
    await page.keyboard.press('ControlOrMeta+a');
    expect(await captureText(page, false)).toBe('i has went home');

    const result = await page.evaluate(() => {
      const api = window as unknown as PageApi;
      const pending = api.__lp.applyReplacement(api.__t, 'I went home.');
      setTimeout(() => {
        const other = document.getElementById('other') as HTMLElement;
        other.focus();
        const range = document.createRange();
        range.selectNodeContents(other);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      }, 0);
      return pending;
    });

    expect(result).toEqual({ ok: false, reason: 'changed' });
    await expect(page.locator('#other')).toHaveText('Other editor original text');
    await expect(page.locator(selector)).toHaveText('i has went home');
  });
}

test('Lexical keeps edits made during the paste wait', async ({ page }) => {
  await page.locator('#lexical').click();
  await page.keyboard.type('i has went home');
  await page.keyboard.press('ControlOrMeta+a');
  expect(await captureText(page, false)).toBe('i has went home');

  const result = await page.evaluate(() => {
    const api = window as unknown as PageApi;
    const pending = api.__lp.applyReplacement(api.__t, 'I went home.');
    setTimeout(() => {
      document.execCommand('insertText', false, 'edited while waiting');
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('lexical') as HTMLElement);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }, 0);
    return pending;
  });

  expect(result).toEqual({ ok: false, reason: 'changed' });
  await expect(page.locator('#lexical')).toHaveText('edited while waiting');
});

test('apply reports changed when paragraph splits moved', async ({ page }) => {
  await page.locator('#ce').evaluate((el) => {
    el.innerHTML = '<p>hello world</p><p>line two</p>';
  });
  await page.locator('#ce').click();
  await page.keyboard.press('ControlOrMeta+a');
  expect(await captureText(page, false)).toBe('hello world\nline two');
  await page.locator('#outside').click();
  await page.locator('#ce').evaluate((el) => {
    el.innerHTML = '<p>hello</p><p>world line two</p>';
  });

  expect(await apply(page, 'Hello world.\nLine two.')).toEqual({ ok: false, reason: 'changed' });
  const paragraphs = await page
    .locator('#ce p')
    .evaluateAll((els) => els.map((el) => el.textContent));
  expect(paragraphs).toEqual(['hello', 'world line two']);
});

test('apply rejects a line-break rewrite that the editor ignores', async ({ page }) => {
  await page.locator('#ce').click();
  await page.keyboard.type('hello world');
  await page.keyboard.press('ControlOrMeta+a');
  expect(await captureText(page, false)).toBe('hello world');
  await page.locator('#outside').click();
  await page.locator('#ce').evaluate((el) => {
    el.addEventListener('input', () => {
      el.textContent = 'hello world';
    });
    el.addEventListener('paste', (event) => event.preventDefault());
  });

  expect(await apply(page, 'hello\nworld')).toEqual({ ok: false, reason: 'rejected' });
  expect(await page.locator('#ce').innerText()).toBe('hello world');
});

test('wholeFieldIfEmpty selects the field only when asked', async ({ page }) => {
  await page.locator('#ta').click();
  await page.keyboard.type('i has went home');

  expect(await captureText(page, false)).toBeNull();
  expect(await captureText(page, true)).toBe('i has went home');
});

test('textarea accepts a multi-line replacement', async ({ page }) => {
  await page.locator('#ta').click();
  await page.keyboard.type('line one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('line two');

  expect(await captureText(page, true)).toBe('line one\nline two');
  await page.locator('#outside').click();
  expect(await apply(page, 'Line one.\nLine two.')).toEqual({ ok: true });
  await expect(page.locator('#ta')).toHaveValue('Line one.\nLine two.');
});

test('contenteditable accepts a multi-line replacement', async ({ page }) => {
  await page.locator('#ce').click();
  await page.keyboard.type('line one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('line two');
  await page.keyboard.press('ControlOrMeta+a');

  expect(await captureText(page, false)).toBe('line one\nline two');
  await page.locator('#outside').click();
  expect(await apply(page, 'Line one.\nLine two.')).toEqual({ ok: true });

  const lines = (await page.locator('#ce').innerText())
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  expect(lines).toContain('Line one.');
  expect(lines).toContain('Line two.');
});

test('paragraph editor keeps one block per paragraph', async ({ page }) => {
  await page.locator('#ce').evaluate((el) => {
    el.innerHTML = '<p>line one</p><p>line two</p>';
  });
  await page.locator('#ce').click();
  await page.keyboard.press('ControlOrMeta+a');

  expect(await captureText(page, false)).toBe('line one\nline two');
  await page.locator('#outside').click();
  expect(await apply(page, 'Line one.\nLine two.')).toEqual({ ok: true });

  const paragraphs = await page
    .locator('#ce p')
    .evaluateAll((els) => els.map((el) => el.textContent));
  expect(paragraphs).toEqual(['Line one.', 'Line two.']);
});

test('whole paragraph editor survives its blocks being swapped', async ({ page }) => {
  const html = '<p><br></p><p>hi ahmed,</p><p><br></p><p>hope your having a good day</p>';
  await page.locator('#ce').evaluate((el, html) => {
    el.innerHTML = html;
  }, html);
  await page.locator('#ce p').nth(1).click();

  expect(await captureText(page, true)).toBe('\nhi ahmed,\n\nhope your having a good day');
  await page.locator('#outside').click();
  // LinkedIn replaces its paragraphs when the box gets focus again.
  await page.locator('#ce').evaluate((el, html) => {
    el.addEventListener(
      'focus',
      () => {
        el.innerHTML = html;
      },
      { once: true },
    );
  }, html);
  expect(await apply(page, "\nHi Ahmed,\n\nHope you're having a good day!")).toEqual({
    ok: true,
  });

  const paragraphs = await page
    .locator('#ce p')
    .evaluateAll((els) => els.map((el) => el.textContent));
  expect(paragraphs).toEqual(['', 'Hi Ahmed,', '', "Hope you're having a good day!"]);
});

test('a blank line inside <pre> survives next to a paragraph', async ({ page }) => {
  await page.locator('#ce').evaluate((el) => {
    el.innerHTML = '<p>Title</p><pre>first\n\nsecond</pre>';
    const range = document.createRange();
    range.selectNodeContents(el.querySelector('pre') as Node);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  });

  expect(await captureText(page, false)).toBe('first\n\nsecond');
});

test('a part selection only replaces what was selected', async ({ page }) => {
  await page.locator('#ce').evaluate((el) => {
    el.style.whiteSpace = 'pre';
    el.textContent = '  hello  ';
  });
  await page.locator('#ce').click();
  await page.locator('#ce').evaluate((el) => {
    const range = document.createRange();
    range.setStart(el.firstChild as Node, 2);
    range.setEnd(el.firstChild as Node, 7);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  });

  expect(await captureText(page, false)).toBe('hello');
  await page.locator('#outside').click();
  expect(await apply(page, 'Hello.')).toEqual({ ok: true });
  expect(await page.locator('#ce').evaluate((el) => el.textContent)).toBe('  Hello.  ');
});

test('applying the same text leaves the field untouched', async ({ page }) => {
  await page.locator('#ta').click();
  await page.keyboard.type('i has went home');
  await page.locator('#ta').evaluate((el) => {
    if (!(el instanceof HTMLTextAreaElement)) throw new Error('expected textarea');
    el.setSelectionRange(2, 10);
  });
  const text = await captureText(page, false);
  expect(text).toBe('has went');
  await page.locator('#outside').click();

  expect(await apply(page, text ?? '')).toEqual({ ok: true });
  await expect(page.locator('#ta')).toHaveValue('i has went home');
  await expect(page.locator('#outside')).toBeFocused();
});

async function captureText(page: Page, wholeFieldIfEmpty: boolean): Promise<string | null> {
  return page.evaluate((wholeFieldIfEmpty) => {
    const api = window as unknown as PageApi;
    api.__t = api.__lp.captureTarget({ wholeFieldIfEmpty });
    return api.__t ? api.__t.text : null;
  }, wholeFieldIfEmpty);
}

async function apply(page: Page, text: string): Promise<ApplyResult> {
  return page.evaluate(async (replacement) => {
    const api = window as unknown as PageApi;
    return api.__lp.applyReplacement(api.__t, replacement);
  }, text);
}
