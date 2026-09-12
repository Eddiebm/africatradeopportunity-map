import { env } from "cloudflare:workers";

type DocStore = {
  DOCS?: KVNamespace;
};

function store(): KVNamespace {
  const docs = (env as typeof env & DocStore).DOCS;
  if (!docs) {
    throw new Error("Document store is unavailable. Bind the DOCS KV namespace before accepting uploads.");
  }
  return docs;
}

export async function putDocument(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await store().put(key, bytes, { metadata: { contentType } });
}

export async function getDocument(key: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const result = await store().getWithMetadata<{ contentType?: string }>(key, "arrayBuffer");
  if (!result.value) return null;
  return {
    body: result.value,
    contentType: result.metadata?.contentType || "application/octet-stream",
  };
}

export async function deleteDocument(key: string): Promise<void> {
  await store().delete(key);
}
