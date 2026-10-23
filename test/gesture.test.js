import test from "node:test";
import assert from "node:assert/strict";
import { lockAxis, pageDirection, rubber } from "../src/lib/gesture.js";

test("axis lock waits for movement, then picks the dominant axis", () => {
  assert.equal(lockAxis(3, 2), null);
  assert.equal(lockAxis(30, 4), "x");
  assert.equal(lockAxis(4, 30), "y");
  assert.equal(lockAxis(20, 18), "y"); // diagonal drags count as scrolling
});

test("page direction: far enough or fast enough", () => {
  assert.equal(pageDirection(-150, 390, 600), 1);   // left swipe = next page
  assert.equal(pageDirection(150, 390, 600), -1);   // right swipe = previous page
  assert.equal(pageDirection(-30, 390, 600), 0);    // too short and slow
  assert.equal(pageDirection(-60, 390, 80), 1);     // a quick flick
  assert.equal(pageDirection(-10, 390, 10), 0);     // tiny movement is never a flick
});

test("rubber band slows the drag", () => {
  assert.equal(rubber(100), 30);
});
