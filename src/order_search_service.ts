import { createServer } from "node:http";
import { z } from "zod";
import { InfraiError, InfraiSearch } from "./infrai_search.ts";

const searchBody = z.object({
  query: z.string().trim().min(2).max(300),
  customer_id: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(10).default(5),
}).strict();

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const search = new InfraiSearch(apiKey, process.env.INFRAI_COLLECTION ?? "order-journey");

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new RangeError("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.url !== "/search") {
    response.writeHead(404).end(JSON.stringify({ error: "Route not found" }));
    return;
  }

  try {
    const body = searchBody.parse(await readJson(request));
    const results = await search.search(body.query, body.customer_id, body.limit);
    response.writeHead(200).end(JSON.stringify({ query: body.query, results }));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError) {
      response.writeHead(400).end(JSON.stringify({ error: "Invalid request body" }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.code, message: error.message }));
      return;
    }
    response.writeHead(502).end(JSON.stringify({ error: "Search dependency error" }));
  }
});

server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log("Order search listening on http://localhost:3000");
});
