import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const clearSOPs = mutation({
  args: {},
  handler: async (ctx) => {
    const sops = await ctx.db.query("sops").collect();
    for (const sop of sops) {
      await ctx.db.delete(sop._id);
    }
  },
});

export const ingestSOPChunk = mutation({
  args: {
    fileName: v.string(),
    text: v.string(),
    embedding: v.array(v.number()),
    metadata: v.optional(
      v.object({
        pageNumber: v.optional(v.number()),
        source: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("sops", {
      fileName: args.fileName,
      text: args.text,
      embedding: args.embedding,
      metadata: args.metadata,
    });
  },
});

export const getSOPCount = query({
  args: {},
  handler: async (ctx) => {
    const sops = await ctx.db.query("sops").collect();
    return sops.length;
  },
});

export const getSOPChunkById = query({
  args: { id: v.id("sops") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc) throw new Error("SOP chunk not found");
    return doc;
  },
});
export const getChunkCount = query({
  args: {},
  handler: async (ctx) => {
    const chunks = await ctx.db.query("sops").collect();
    return chunks.length;
  },
});
