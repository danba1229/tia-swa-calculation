import test from "node:test";
import assert from "node:assert/strict";
import { readTotalCount, assessPageCompleteness } from "../lib/tiaApi.js";

test("missing upstream total is unknown, not zero", () => {
  assert.equal(readTotalCount({totalCount: null}), null);
  assert.equal(readTotalCount({totalCount: "", matchCount: 12}), 12);
  assert.equal(readTotalCount({response:{body:{totalCount:0}}}), 0);
});

test("nominally complete pages with a repeated single project are not complete business coverage", () => {
  const pages = Array.from({length:55}, (_,index) => ({
    responseItemCount:index === 54 ? 30 : 100,
    uniqueItemCount:1,
  }));
  const result = assessPageCompleteness(pages,5430);
  assert.equal(result.receivedRowCount,5430);
  assert.equal(result.complete,false);
  assert.ok(result.reasons.includes("REPEATED_SINGLE_PROJECT_PAGES"));
});

test("ordinary duplicate rows do not automatically invalidate otherwise complete pages", () => {
  assert.equal(assessPageCompleteness([
    {responseItemCount:100,uniqueItemCount:85},
    {responseItemCount:5,uniqueItemCount:5},
  ],105).complete,true);
  assert.equal(assessPageCompleteness([{responseItemCount:20,uniqueItemCount:20}],100).complete,false);
  assert.equal(assessPageCompleteness([{responseItemCount:20,uniqueItemCount:20}],20,true).complete,false);
});
