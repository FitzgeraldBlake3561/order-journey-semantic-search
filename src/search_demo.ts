import { InfraiSearch, type JourneyDocument } from "./infrai_search.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the demo");

const search = new InfraiSearch(apiKey, process.env.INFRAI_COLLECTION ?? "order-journey-demo");
const documents: JourneyDocument[] = [
  { id: "checkout-1042", order_id: "1042", kind: "checkout", text: "Order 1042 paid with express delivery selected.", customer_id: "customer-7", occurred_at: "2026-08-20T09:00:00Z" },
  { id: "fulfillment-1042", order_id: "1042", kind: "fulfillment", text: "Order 1042 left the warehouse and arrives Friday.", customer_id: "customer-7", occurred_at: "2026-08-21T15:00:00Z" },
  { id: "receipt-1055", order_id: "1055", kind: "receipt", text: "Receipt for order 1055 includes a linen shirt and tax.", customer_id: "customer-7", occurred_at: "2026-08-22T11:00:00Z" },
  { id: "update-1061", order_id: "1061", kind: "order_update", text: "Order 1061 delivery address was updated before dispatch.", customer_id: "customer-7", occurred_at: "2026-08-23T13:00:00Z" },
];

await search.createCollection();
await search.index(documents);
const results = await search.search("Which package arrives Friday?", "customer-7", 3);
console.log(JSON.stringify(results, null, 2));
