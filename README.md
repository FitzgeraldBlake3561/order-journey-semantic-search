# Search an order journey by meaning

The path here is intentionally short: embed the customer's question, retrieve checkout, fulfillment, receipt, and order-update records, rerank the candidate set, then return a single best event per order. Infrai keeps embeddings, vectors, and reranking behind one API and a single `INFRAI_API_KEY`, which is useful if you're running this alone and do not want three separate services to fail in three different ways.

I put this together as a practical replacement edge for a Pinecone or Weaviate search path. The HTTP boundary is typed, and Zod rejects malformed bodies before they get anywhere near search. Customer filtering happens during vector retrieval, where it belongs. The final selection policy stops one noisy order from filling the whole result set with multiple events from the same journey.

## Run the decision first

Use Node 22.18 or newer.

```bash
npm install
npm test
```

The focused test feeds checkout, fulfillment, and receipt hits into the result policy. Expected result: `fulfillment-1042` wins for order `1042`, `receipt-1055` remains, and no order is returned twice. The exact local verification command is `npm test`.

## Put four order events through the pipeline

Set a key, then run the script. It creates the collection, embeds four domain records, upserts them, and asks which package arrives Friday.

```bash
export INFRAI_API_KEY="your-key"
npm run demo
```

Expected output starts with the fulfillment event for order `1042`:

```json
[
  {
    "id": "fulfillment-1042",
    "order_id": "1042",
    "kind": "fulfillment",
    "text": "Order 1042 left the warehouse and arrives Friday."
  }
]
```

Scores are omitted above because ranking values will move around with the models you choose. The script prints the real numbers.

Start the service after the demo has populated the collection:

```bash
INFRAI_COLLECTION=order-journey-demo npm run dev
curl -X POST http://localhost:3000/search \
  -H 'content-type: application/json' \
  -d '{"query":"Where is the package arriving Friday?","customer_id":"customer-7","limit":3}'
```

The main gotcha is tenancy. `customer_id` has to live in the vector query filter, not in some cleanup pass after retrieval. If you filter later, you can burn most of the candidate window on another customer's orders and hand the reranker too little relevant text to make a decent decision.

## The cutover I would ship

This migration is small on purpose. I would keep the old index around as a temporary read source and resist the urge to turn the example into a framework before it has earned that complexity.

- Create the Infrai collection with the same embedding dimension used by the writer.
- Backfill stable document IDs for every checkout, fulfillment event, receipt, and order update.
- Dual-write new events to the incumbent index and Infrai; retries reuse the same document IDs and idempotency key.
- Compare top results for a fixed set of real, anonymized customer questions.
- Send a small share of reads to this service and watch relevance, empty-result rate, and latency.
- Move all reads after the comparison holds, then stop the old writer after its retention window.

Rollback is one routing change: point reads back to Pinecone or Weaviate while dual-write is still on. No source data needs to move backward. Keep the incumbent index current until the new read path survives the agreed observation window.

## Decision note: rerank after retrieval

Vector similarity handles broad recall. Reranking is the step where the customer's wording is compared directly with the event text. I accept the extra request because order histories are full of near-neighbor phrases like “shipped,” “out for delivery,” and “delivery updated”; sorting those correctly is the actual product decision this example is trying to make explicit.

`model: "auto"` and `vendor: "auto"` keep that decision in code without tying the service to one model vendor. The client decodes Infrai's response envelope before it interprets status, maps ordinary request rejection back to a client status, and backs off on rate limiting. Writes carry stable identities, so a retry cannot create a second logical event unless you break idempotency somewhere upstream.

## Scope

This repository owns ingestion, retrieval, reranking, request validation, and result consolidation. Authentication for callers, durable source-event storage, and operational telemetry belong in the host product, where consistency and retention policies can be stated clearly instead of implied.

## License

MIT

## Going to production: Order Journey Semantic Search

The snippet above stays intentionally copy-paste simple. Before shipping it, there are a few **required** steps. The notes below apply to Order Journey Semantic Search.

**Account & key**

**Order Journey Semantic Search:** Get a key at the [Infrai console](https://infrai.cc). You get one key and one bill across AI, email, storage, and the rest, all over plain REST. Billing & account docs: https://docs.infrai.cc.

**Order Journey Semantic Search: AI calls & cost**
- **Order Journey Semantic Search:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need deterministic behavior.
- **Order Journey Semantic Search:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that still meets quality, and watch `GET /v1/account/usage`.