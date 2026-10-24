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

  it('opens below the caret line when the field leaves no room above or below', () => {
    const field = rect(20, 16, 360, 760);
    const line = rect(40, 30, 0, 20);
    expect(placePopup(field, popup, viewport, line)).toEqual({ top: 66, left: 16 });
  });

  it('ignores the caret line when the popup fits outside the field', () => {
    expect(placePopup(rect(100, 200, 300, 40), popup, viewport, rect(110, 250, 0, 20))).toEqual({
      top: 146,
      left: 200,
    });
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
  it('sits just below the caret, centred on it', () => {
    expect(placeButton(rect(100, 300, 0, 20), viewport)).toEqual({ top: 124, left: 286 });
  });

  it('stays inside the viewport', () => {
    expect(placeButton(rect(780, 990, 0, 20), viewport)).toEqual({ top: 764, left: 964 });
  });
});
