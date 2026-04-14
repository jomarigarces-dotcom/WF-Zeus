import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

const OPENROUTER_API_KEY: string | undefined =
  // eslint-disable-next-line no-undef
  typeof process !== "undefined" ? (process as NodeJS.Process).env.OPENROUTER_API_KEY : undefined;

type SOPChunk = {
  text: string;
  fileName: string;
  score: number;
};

export const searchSOPs = action({
  args: { query: v.string() },
  handler: async (ctx, args): Promise<SOPChunk[]> => {
    // 1. Generate embedding for the search query
    const embeddingResponse = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: args.query,
      }),
    });

    if (!embeddingResponse.ok) {
      throw new Error(`Failed to generate embedding: ${await embeddingResponse.text()}`);
    }

    const { data }: { data: Array<{ embedding: number[] }> } = await embeddingResponse.json();
    const queryEmbedding: number[] = data[0].embedding;

    // 2. Perform vector search in Convex
    const results = await ctx.vectorSearch("sops", "by_embedding", {
      vector: queryEmbedding,
      limit: 5,
    });

    // 3. Fetch the actual text for the search results
    const chunks: SOPChunk[] = await Promise.all(
      results.map(async (result): Promise<SOPChunk> => {
        const doc = await ctx.runQuery(api.sops.getSOPChunkById, { id: result._id });
        return {
          text: (doc as { text: string; fileName: string }).text,
          fileName: (doc as { text: string; fileName: string }).fileName,
          score: result._score,
        };
      })
    );

    return chunks;
  },
});

export const chatWithSOPs = action({
  args: {
    message: v.string(),
    history: v.array(v.object({ role: v.string(), content: v.string() })),
  },
  handler: async (ctx, args): Promise<string> => {
    // 1. Search for relevant context
    const contextResults: SOPChunk[] = await ctx.runAction(api.sopActions.searchSOPs, {
      query: args.message,
    });
    const contextText: string = contextResults
      .map((c: SOPChunk) => `[Source: ${c.fileName}]\n${c.text}`)
      .join("\n\n---\n\n");

    // 2. Build the prompt
    const systemPrompt = `You are the WF Zeus SOP Assistant. Your goal is to help users with questions about Standard Operating Procedures (SOPs).
Use the following context from official SOP documents to answer the user's question. 
If the answer isn't in the context, say that you don't know based on the current SOPs, but offer to help based on general knowledge if appropriate (stating it's general knowledge).
Always try to cite the source file name.

CONTEXT:
${contextText}`;

    // 3. Call OpenRouter
    const chatResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          { role: "system", content: systemPrompt },
          ...args.history,
          { role: "user", content: args.message },
        ],
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });

    if (!chatResponse.ok) {
      throw new Error(`OpenRouter API error: ${await chatResponse.text()}`);
    }

    const chatData: { choices: Array<{ message: { content: string } }> } =
      await chatResponse.json();
    return chatData.choices[0].message.content;
  },
});
