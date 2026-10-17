import { describe, expect, it } from 'vitest';
import { placeButton, placePopup, type Rect } from './position';

const viewport = { width: 1000, height: 800 };
const popup = { width: 440, height: 300 };

function rect(top: number, left: number, width: number, height: number): Rect {
  return { top, left, right: left + width, bottom: top + height };
}

describe('placePopup', () => {
  it('opens below the anchor, left-aligned with it', () => {
    expect(placePopup(rect(100, 200, 300, 40), popup, viewport)).toEqual({ top: 146, left: 200 });
  });

  it('opens above the anchor when there is no room below', () => {
    expect(placePopup(rect(600, 200, 300, 40), popup, viewport)).toEqual({ top: 294, left: 200 });
  });

  it('keeps the side with more room when neither side fits, clamped to the viewport', () => {
    const tall = { width: 440, height: 700 };
    expect(placePopup(rect(300, 200, 300, 40), tall, viewport)).toEqual({ top: 92, left: 200 });
    expect(placePopup(rect(100, 200, 300, 40), tall, viewport)).toEqual({ top: 92, left: 200 });
  });

  it('clamps to the right and left edges with an 8 px margin', () => {
    expect(placePopup(rect(100, 800, 100, 20), popup, viewport).left).toBe(552);
    expect(placePopup(rect(100, -50, 100, 20), popup, viewport).left).toBe(8);
  });

  it('pins to the top-left margin when the popup is larger than the viewport', () => {
    const small = { width: 300, height: 200 };
    expect(placePopup(rect(50, 50, 100, 20), popup, small)).toEqual({ top: 8, left: 8 });
  });
});

describe('placeButton', () => {
  it('sits inside the bottom-right corner of a field', () => {
    expect(placeButton(rect(100, 100, 400, 60), 'field', viewport)).toEqual({
      top: 128,
      left: 468,
    });
  });

  it('sits just below the end of a rich selection', () => {
    expect(placeButton(rect(100, 100, 200, 20), 'rich', viewport)).toEqual({
      top: 124,
      left: 272,
    });
  });

  it('stays inside the viewport', () => {
    expect(placeButton(rect(780, 950, 100, 20), 'rich', viewport)).toEqual({
      top: 764,
      left: 964,
    });
  });
});
