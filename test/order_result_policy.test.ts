import assert from "node:assert/strict";
import test from "node:test";
import { bestHitPerOrder, type SearchHit } from "../src/infrai_search.ts";

test("returns one answer per order and keeps its strongest journey event", () => {
  const hits: SearchHit[] = [
    { id: "checkout-1042", order_id: "1042", kind: "checkout", text: "Paid", score: 0.74, occurred_at: "2026-08-20T09:00:00Z" },
    { id: "fulfillment-1042", order_id: "1042", kind: "fulfillment", text: "Arrives Friday", score: 0.96, occurred_at: "2026-08-21T15:00:00Z" },
    { id: "receipt-1055", order_id: "1055", kind: "receipt", text: "Linen shirt", score: 0.81, occurred_at: "2026-08-22T11:00:00Z" },
  ];

  assert.deepEqual(bestHitPerOrder(hits).map((hit) => hit.id), ["fulfillment-1042", "receipt-1055"]);
});
