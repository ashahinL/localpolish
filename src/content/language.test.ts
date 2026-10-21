import { describe, expect, it } from 'vitest';
import { type ChromeLanguageResult, type DetectFn, detectLanguages } from './language';

function fakeDetector(
  result: ChromeLanguageResult = {
    isReliable: true,
    languages: [{ language: 'en', percentage: 100 }],
  },
) {
  const calls: string[] = [];
  const detect: DetectFn = async (text) => {
    calls.push(text);
    return result;
  };
  return { detect, calls };
}

describe('detectLanguages', () => {
  it.each([
    ['The silver kite landed nearby', { main: 'en', parts: ['en'] }],
    ['وصل القطار إلى القرية', { main: 'ar', parts: ['ar'] }],
    ['ana 3ayez a7ki m3ak bokra', { main: 'franco', parts: ['franco'] }],
    ['ana mesh fahem keda khalas', { main: 'franco', parts: ['franco'] }],
    ['The silver kite وصل nearby', { main: 'en', parts: ['en', 'ar'] }],
    ['وصل القطار إلى القرية silver kite', { main: 'ar', parts: ['ar', 'en'] }],
    ['silver kite وصل القطار', { main: 'en', parts: ['en', 'ar'] }],
    ['silver وصل', { main: null, parts: ['en', 'ar'] }],
    ['وصل', { main: null, parts: ['ar'] }],
    ['ana', { main: null, parts: ['franco'] }],
    ['', { main: null, parts: [] }],
    ['синий воздушный змей', { main: 'other', parts: ['other'] }],
    ['silver kite وصل синий', { main: 'en', parts: ['en', 'ar', 'other'] }],
  ])('classifies %j', async (text, expected) => {
    const fake = fakeDetector();
    expect(await detectLanguages(text, fake.detect)).toEqual(expected);
    expect(fake.calls.length).toBeLessThanOrEqual(1);
  });

  it.each(['وصل القطار إلى القرية', 'ana 3ayez a7ki m3ak bokra', 'ana mesh fahem keda khalas'])(
    'does not call Chrome for %j',
    async (text) => {
      const fake = fakeDetector();
      await detectLanguages(text, fake.detect);
      expect(fake.calls).toEqual([]);
    },
  );

  it('keeps counts, times and ordinals out of the Franco score', async () => {
    const fake = fakeDetector();
    expect(
      await detectLanguages('2026 3pm 5k 1st 2nd 3rd 4th https://kite.example/3ayez', fake.detect),
    ).toEqual({ main: 'en', parts: ['en'] });
    expect(fake.calls).toEqual(['3pm 5k 1st 2nd 3rd 4th']);
  });

  it.each([
    '@ana #mesh ana@kite.example https://kite.example/ana www.kite.example 😄 👩🏽‍💻 123 !!! `ana mesh khalas`',
    '2026 ٢٣٤ !!! 😄',
  ])('ignores noise in %j', async (text) => {
    const fake = fakeDetector();
    expect(await detectLanguages(text, fake.detect)).toEqual({ main: null, parts: [] });
    expect(fake.calls).toEqual([]);
  });

  it('sends only Latin words to Chrome, once', async () => {
    const fake = fakeDetector();
    expect(
      await detectLanguages(
        'The, silver! kite وصل синий @ana #mesh ana@kite.example https://kite.example 😄 `khalas` 2026',
        fake.detect,
      ),
    ).toEqual({ main: 'en', parts: ['en', 'ar', 'other'] });
    expect(fake.calls).toEqual(['The silver kite']);
  });

  it('uses the language with the highest percentage', async () => {
    const fake = fakeDetector({
      isReliable: true,
      languages: [
        { language: 'en', percentage: 10 },
        { language: 'fr', percentage: 90 },
      ],
    });
    expect(await detectLanguages('Le cerf volant argenté', fake.detect)).toEqual({
      main: 'other',
      parts: ['other'],
    });
    expect(fake.calls).toEqual(['Le cerf volant argenté']);
  });

  it.each([
    { isReliable: false, languages: [{ language: 'fr', percentage: 90 }] },
    { isReliable: true, languages: [{ language: 'und', percentage: 100 }] },
    { isReliable: false, languages: [] },
  ])('defaults to English for %j', async (result) => {
    const fake = fakeDetector(result);
    expect(await detectLanguages('The silver kite', fake.detect)).toEqual({
      main: 'en',
      parts: ['en'],
    });
    expect(fake.calls).toEqual(['The silver kite']);
  });

  it.each(['3ala', 'ma3lesh', '7elw', 'delwa2ty', '2ana', '6aree2', '8areeb', '9a7bi'])(
    'counts %j as Franco at the 25 percent threshold',
    async (word) => {
      const fake = fakeDetector();
      expect(await detectLanguages(`${word} silver kite landed`, fake.detect)).toEqual({
        main: 'franco',
        parts: ['franco'],
      });
      expect(fake.calls).toEqual([]);
    },
  );

  it('calls Chrome below the Franco threshold', async () => {
    const fake = fakeDetector();
    expect(await detectLanguages('ana silver kite landed nearby', fake.detect)).toEqual({
      main: 'en',
      parts: ['en'],
    });
    expect(fake.calls).toEqual(['ana silver kite landed nearby']);
  });

  it('does not treat ambiguous words as Franco', async () => {
    const fake = fakeDetector();
    expect(await detectLanguages('bas eh fen law men ya el', fake.detect)).toEqual({
      main: 'en',
      parts: ['en'],
    });
    expect(fake.calls).toEqual(['bas eh fen law men ya el']);
  });

  it('ignores leading counts and words with fewer than two letters for Franco', async () => {
    const fake = fakeDetector();
    expect(await detectLanguages('42items 5k 9a7', fake.detect)).toEqual({
      main: 'en',
      parts: ['en'],
    });
    expect(fake.calls).toEqual(['42items 5k 9a7']);
  });

  it('does not count words that end in digits as Franco', async () => {
    const fake = fakeDetector();
    expect(await detectLanguages('send the mp3 web3 user123', fake.detect)).toEqual({
      main: 'en',
      parts: ['en'],
    });
    expect(fake.calls).toEqual(['send the mp3 web3 user123']);
  });

  it.each([
    ['وصل القطار ana mesh', { main: 'ar', parts: ['ar', 'franco'] }],
    ['ana mesh синий змей', { main: 'franco', parts: ['franco', 'other'] }],
    ['ANA MESH KEDA', { main: 'franco', parts: ['franco'] }],
  ])('handles ties and uppercase words in %j', async (text, expected) => {
    const fake = fakeDetector();
    expect(await detectLanguages(text, fake.detect)).toEqual(expected);
    expect(fake.calls).toEqual([]);
  });
});
