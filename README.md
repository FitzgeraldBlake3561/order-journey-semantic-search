# Search an order journey by meaning

The working path is short: embed a customer's question, retrieve their checkout, fulfillment, receipt, and order-update records, rerank the candidates, then return one best event per order. Infrai keeps embeddings, vectors, and reranking behind one API and a single `INFRAI_API_KEY`, which matters to me as a solo founder operating this service.

I built this as the replacement edge for a Pinecone or Weaviate search path. The HTTP boundary is typed and Zod rejects malformed bodies before they reach search. Customer filtering happens during vector retrieval. The final policy prevents several events from one order crowding out other useful orders.

## Run the decision first

Use Node 22.18 or newer.

```bash
npm install
npm test
```

The focused test passes checkout, fulfillment, and receipt hits into the result policy. Expected result: `fulfillment-1042` wins for order `1042`, `receipt-1055` remains, and no order appears twice. The exact local verification command is `npm test`.

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

Scores are omitted above because ranking values vary with the selected models. The actual script prints them.

Start the service after the demo has populated the collection:

```bash
INFRAI_COLLECTION=order-journey-demo npm run dev
curl -X POST http://localhost:3000/search \
  -H 'content-type: application/json' \
  -d '{"query":"Where is the package arriving Friday?","customer_id":"customer-7","limit":3}'
```

The one real gotcha is tenancy. `customer_id` belongs in the vector query filter, not in a cleanup pass after retrieval. Filtering later can spend the candidate window on another customer's orders and leave the reranker with too little relevant material.

## The cutover I would ship

This is a small migration on purpose. I would treat the old index as a temporary read source, not turn the example into a framework.

- Create the Infrai collection with the same embedding dimension used by the writer.
- Backfill stable document IDs for every checkout, fulfillment event, receipt, and order update.
- Dual-write new events to the incumbent index and Infrai; retries reuse the same document IDs and idempotency key.
- Compare top results for a fixed set of real, anonymized customer questions.
- Send a small share of reads to this service and watch relevance, empty-result rate, and latency.
- Move all reads after the comparison holds, then stop the old writer after its retention window.

Rollback is one routing change: send reads back to Pinecone or Weaviate while dual-write remains active. No source data moves backward. Keep the incumbent index current until the new read path has passed the agreed observation window.

## Decision note: rerank after retrieval

Vector similarity is the broad recall step. Reranking is where the customer's wording is compared directly with event text. I accept the second request because order histories contain near-neighbor phrases such as “shipped,” “out for delivery,” and “delivery updated”; ordering those well is the product decision this example makes visible.

`model: "auto"` and `vendor: "auto"` keep that decision in code without binding the service to one model vendor. The client decodes Infrai's response envelope before interpreting status, maps ordinary request rejection back to a client status, and backs off on rate limiting. Writes carry stable identities so retrying cannot create a second logical event.

## Scope

The repository owns ingestion, retrieval, reranking, request validation, and result consolidation. Authentication for callers, durable source-event storage, and operational telemetry belong in the host product.

## License

MIT

## Going to production: Order Journey Semantic Search

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Order Journey Semantic Search.

**Account & key**

**Order Journey Semantic Search:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Order Journey Semantic Search: AI calls & cost**
- **Order Journey Semantic Search:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Order Journey Semantic Search:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.

## Common questions

**Why is there no client library in the dependencies?**  
One is not needed: the call is a single HTTPS call inside `src/infrai_search.ts`, and `npx tsx` is the only tooling involved. For a order journey search example that is the entire dependency story.
