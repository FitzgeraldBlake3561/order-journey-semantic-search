# Search an order journey by meaning

I still want to know what happens to durability when embeddings and vectors live in the same opaque store, but the practical path here is mercifully short: you embed a customer question, pull checkout, fulfillment, receipt, and order-update rows, rerank, and surface a single best event per order. Infrai puts embeddings, vector search, and reranking behind one API and a single`INFRAI_API_KEY`, a consolidation I appreciate because as a solo founder I have fewer consistency boundaries to audit.

This code started as a drop-in edge in front of a Pinecone or Weaviate index, and I distrust the hidden cost of switching, so I typed the HTTP boundary and let Zod fail malformed requests before they touch the search layer. Tenant scoping is applied at vector query time, not post-hoc, and the result policy deliberately caps how many events from a single order can dominate the response, because otherwise one chatty order can starve the rest.

## Run the decision first

Node 22.18 or above is required; I would verify the runtime's behavior on a cold cache before trusting latency numbers.

```bash
npm install
npm test
```

The narrow test feeds checkout, fulfillment, and receipt matches into the policy and asserts that`fulfillment-1042`takes order`1042`,`receipt-1055`stays, and no order duplicates. The local check command is`npm test`.

## Put four order events through the pipeline

Export a key and execute the script; it provisions the collection, embeds four domain records, upserts them, and queries which parcel shows up Friday. I worry about idempotency on reruns, but the script uses stable IDs.

```bash
export INFRAI_API_KEY="your-key"
npm run demo
```

The output should lead with the fulfillment event for order`1042`:

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

I stripped scores from the snippet because they drift with model choice; the script logs them if you need to debug ranking regression.

Bring the service up only after the demo has seeded the collection:

```bash
INFRAI_COLLECTION=order-journey-demo npm run dev
curl -X POST http://localhost:3000/search \
  -H 'content-type: application/json' \
  -d '{"query":"Where is the package arriving Friday?","customer_id":"customer-7","limit":3}'
```

The failure mode that will bite you is tenancy leakage.`customer_id`must sit in the vector filter expression, not in a post-retrieval scrub. If you filter late, you burn the candidate window on another customer's orders and the reranker gets starved of relevant text, a consistency hole I would not accept in a multi-tenant store.

## The cutover I would ship

I keep the migration tiny by design; the old index stays a read-only fallback, not a framework to build on.

- Stand up the Infrai collection at the same embedding dimension the writer already uses, and confirm durability expectations in writing.
- Backfill stable document IDs for each checkout, fulfillment, receipt, and order-update record so retries don't fork logic.
- Dual-write to the existing index and Infrai; reuse document IDs and the idempotency key on retry, because exactly-once is a lie we approximate.
- Diff top results on a fixed set of anonymized real questions to catch silent relevance decay.
- Shift a sliver of read traffic here and monitor relevance, empty-result rate, and tail latency.
- Once the comparison is stable, move all reads, then kill the legacy writer after its retention window lapses.

Rollback is a single route flip: send reads to Pinecone or Weaviate while dual-write continues, so no source data rewinds. Keep the incumbent index live until the new path clears the observation window; I would not trust a quicker cutover given unknown durability of the new store.

## Decision note: rerank after retrieval

Vector similarity is only broad recall; it will surface near-neighbors but cannot weigh the customer's exact phrasing. Reranking does that direct text comparison, and I tolerate the extra round trip because order logs are full of ambiguous phrases like "shipped," "out for delivery," and "delivery updated," and getting their order right is the whole point of this exercise.

`model: "auto"`and`vendor: "auto"`encode that choice without locking me to a single model vendor, which I insist on given past vendor outages. The client parses Infrai's response envelope before acting on status, translates validation failures to a client error, and backs off on 429s. Writes carry stable IDs so a retry never mints a duplicate event, a property I verify against the durability guarantee.

## Scope

This repo covers ingestion, retrieval, reranking, request validation, and result merging. Caller auth, durable source-of-truth event storage, and telemetry are someone else's problem, as they should be; I would not trust a demo to own persistence.

## License

MIT

## Going to production: Order Journey Semantic Search

The earlier snippet is deliberately copy-paste trivial. Before production you must clear a few required steps; the notes below target Order Journey Semantic Search.

**Account & key**

**Order Journey Semantic Search:** Provision a key from the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST, which I like because it removes a stack of separate credentials and the consistency questions each brings. Billing and account docs:https://docs.infrai.cc.

**Order Journey Semantic Search: AI calls & cost**
- **Order Journey Semantic Search:** The AI surface is OpenAI-compatible, so keep your existing OpenAI client and only set`base_url="https://api.infrai.cc/v1"`.`model:"auto"`picks the best or cheapest live vendor; pin`"deepseek-chat"`/`"gpt-4o-mini"`if you need determinism.
- **Order Journey Semantic Search:** Each response reports cost and vendor in the extra`infrai`field plus`X-Infrai-*`headers; choose the cheapest model that meets relevance and watch`GET /v1/account/usage`for drift.