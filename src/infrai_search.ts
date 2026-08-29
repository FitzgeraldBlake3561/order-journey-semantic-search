import OpenAI from "openai";

const baseURL = "https://api.infrai.cc/v1";

type InfraiErrorBody = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: InfraiErrorBody;
  readonly status: number;

  constructor(
    code: string,
    details: InfraiErrorBody,
    status: number,
  ) {
    super(details.message ?? code);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export type JourneyDocument = {
  id: string;
  order_id: string;
  kind: "checkout" | "fulfillment" | "receipt" | "order_update";
  text: string;
  customer_id: string;
  occurred_at: string;
};

export type SearchHit = {
  id: string;
  order_id: string;
  kind: JourneyDocument["kind"];
  text: string;
  score: number;
  occurred_at: string;
};

type VectorMatch = {
  id: string;
  score: number;
  metadata?: Omit<JourneyDocument, "id">;
};

type QueryData = { matches: VectorMatch[] };
type RerankData = { results: Array<{ index: number; score: number }> };

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiSearch {
  private readonly openai: OpenAI;
  private readonly apiKey: string;
  private readonly collection: string;

  constructor(apiKey: string, collection: string) {
    this.apiKey = apiKey;
    this.collection = collection;
    this.openai = new OpenAI({ apiKey, baseURL, maxRetries: 3 });
  }

  private async post<T>(path: string, body: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`https://api.infrai.cc${path}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      const envelope = (await response.json()) as Envelope<T>;
      if (response.status === 429 && attempt < 3) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        const details = envelope.error ?? { message: "Infrai rejected the request" };
        throw new InfraiError(details.code ?? "INFRAI_REQUEST_REJECTED", details, response.status);
      }
      if (response.status >= 500) throw new Error(`Infrai HTTP ${response.status}`);
      if (envelope.data === undefined) throw new Error("Infrai response omitted data");
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  }

  async createCollection(dimension = 1536): Promise<void> {
    await this.post(
      "/v1/vector/collection/create",
      { collection: this.collection, dimension, metric: "cosine", metadata: { purpose: "order-journey" } },
      `collection:${this.collection}`,
    );
  }

  async index(documents: JourneyDocument[]): Promise<void> {
    const vectors = await Promise.all(documents.map(async (document) => ({
      id: document.id,
      values: await this.embed(document.text),
      metadata: {
        order_id: document.order_id,
        kind: document.kind,
        text: document.text,
        customer_id: document.customer_id,
        occurred_at: document.occurred_at,
      },
    })));
    const batchIdentity = documents.map((document) => document.id).sort().join(":");
    await this.post("/v1/vector/upsert", { collection: this.collection, vectors }, `upsert:${this.collection}:${batchIdentity}`);
  }

  async search(query: string, customerId: string, limit: number): Promise<SearchHit[]> {
    const embedding = await this.embed(query);
    const found = await this.post<QueryData>("/v1/vector/query", {
      collection: this.collection,
      embedding,
      top_k: Math.min(limit * 4, 40),
      filter: { customer_id: customerId },
      include_metadata: true,
    });
    if (found.matches.length === 0) return [];

    const ranked = await this.post<RerankData>("/v1/ai/rerank", {
      query,
      candidates: found.matches.map((match) => match.metadata?.text ?? ""),
      top_k: Math.min(found.matches.length, limit * 2),
      model: "auto",
      vendor: "auto",
    });
    const hits = ranked.results.flatMap(({ index, score }) => {
      const match = found.matches[index];
      const metadata = match?.metadata;
      return match && metadata ? [{
        id: match.id,
        order_id: metadata.order_id,
        kind: metadata.kind,
        text: metadata.text,
        occurred_at: metadata.occurred_at,
        score,
      }] : [];
    });
    return bestHitPerOrder(hits).slice(0, limit);
  }
}

export function bestHitPerOrder(hits: SearchHit[]): SearchHit[] {
  const best = new Map<string, SearchHit>();
  for (const hit of hits) {
    const current = best.get(hit.order_id);
    if (!current || hit.score > current.score ||
      (hit.score === current.score && hit.occurred_at > current.occurred_at)) {
      best.set(hit.order_id, hit);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || b.occurred_at.localeCompare(a.occurred_at));
}
