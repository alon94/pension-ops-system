import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

/**
 * EmbeddingProvider — חישוב embedding וקטורי 1536-dim ל-AGENT_CONTEXT (§5.6).
 *
 * • בפרודקשן: ספק חיצוני (Voyage AI / OpenAI) מוזרק דרך env (VOYAGE_API_KEY).
 * • בפיתוח: fallback דטרמיניסטי המבוסס על hash של הטקסט — סמנטית לא משמעותי אבל
 *   round-trip יציב, ומאפשר להדגים את ה-pipeline ללא תלות חיצונית.
 */
@Injectable()
export class EmbeddingProvider {
  private readonly log = new Logger('Embedding');
  private readonly voyageKey = process.env.VOYAGE_API_KEY;
  private readonly voyageModel = process.env.VOYAGE_MODEL ?? 'voyage-3';
  readonly dims = 1536;

  async embed(text: string): Promise<number[]> {
    if (this.voyageKey) return this.voyage(text);
    return this.localFallback(text);
  }

  /** Voyage AI (https://docs.voyageai.com) — recommendation אנתרופיק לעבריות. */
  private async voyage(text: string): Promise<number[]> {
    try {
      const resp = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.voyageKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: [text], model: this.voyageModel, output_dimension: this.dims }),
      });
      if (!resp.ok) throw new Error(`Voyage ${resp.status}: ${await resp.text()}`);
      const data = (await resp.json()) as { data: { embedding: number[] }[] };
      return data.data[0].embedding;
    } catch (e) {
      this.log.warn(`Voyage failed (${(e as Error).message}) — נופל ל-local fallback`);
      return this.localFallback(text);
    }
  }

  /**
   * Fallback דטרמיניסטי: שרשור SHA-256 של (text + counter) כדי לייצר 1536 float32-נורמלים.
   * הוקטור מנורמל ל-L2=1, כך ש-cosine_sim בין שני וקטורים = inner product רגיל.
   */
  private localFallback(text: string): number[] {
    const out: number[] = [];
    const need = this.dims;
    let counter = 0;
    while (out.length < need) {
      const h = createHash('sha256').update(`${counter}:${text}`).digest();
      // 8 floats per 32 bytes (4 bytes each, normalized to [-1, 1])
      for (let i = 0; i < h.length / 4 && out.length < need; i++) {
        const u = h.readUInt32BE(i * 4);
        out.push((u / 0xffffffff) * 2 - 1);
      }
      counter++;
    }
    // L2 normalize
    const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
    return out.map((v) => v / norm);
  }
}

/** עוזר: cosine similarity בין שני וקטורים מנורמלים. */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // a, b נורמלו → cosine = dot
}
