import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Workspace accounts (formerly db.accounts)
  accounts: defineTable({
    accountId: v.string(), // slug/key e.g. "amazon_1234"
    name: v.string(),
    categories: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
      })
    ),
    icons: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        url: v.string(),
        iconType: v.optional(v.string()),
        catId: v.string(),
      })
    ),
    announcements: v.array(
      v.object({
        id: v.string(),
        globalId: v.optional(v.union(v.string(), v.null())),
        message: v.string(),
        timestamp: v.string(),
        severity: v.string(), // info | warning | critical
        sender: v.string(),
        senderEmail: v.optional(v.string()),
        imageUrl: v.optional(v.union(v.string(), v.null())),
        linkUrl: v.optional(v.union(v.string(), v.null())),
        isPinned: v.boolean(),
        updatedAt: v.optional(v.string()),
      })
    ),
    notes: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        content: v.string(),
        timestamp: v.string(),
        author: v.optional(v.string()),
      })
    ),
    users: v.array(v.string()), // array of email strings
  }).index("by_accountId", ["accountId"]),

  // User profiles (formerly db.userProfiles)
  userProfiles: defineTable({
    email: v.string(),
    nickname: v.string(),
    auxStatus: v.optional(v.string()),
    lastActive: v.optional(v.number()),
    lastAccount: v.optional(v.string()),
    checklist: v.optional(
      v.array(
        v.object({
          id: v.string(),
          text: v.string(),
          isDone: v.boolean(),
          isArchived: v.optional(v.boolean()),
          timestamp: v.string(),
          completedAt: v.optional(v.string()),
          sender: v.optional(v.string()),
        })
      )
    ),
    notes: v.optional(
      v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          content: v.string(),
          timestamp: v.string(),
          author: v.optional(v.string()),
        })
      )
    ),
    notifications: v.optional(
      v.array(
        v.object({
          type: v.string(),
          accountId: v.string(),
          approved: v.boolean(),
          requestType: v.optional(v.string()),
          timestamp: v.string(),
        })
      )
    ),
  }).index("by_email", ["email"]),

  // Global reminders (formerly db.reminders)
  reminders: defineTable({
    targetAccount: v.string(), // account id or 'ALL'
    message: v.string(),
    imageUrl: v.optional(v.union(v.string(), v.null())),
    sender: v.string(),
    senderEmail: v.string(),
    timestamp: v.string(),
    scheduledTime: v.string(),
    expiryTimestamp: v.optional(v.string()),
    durationHours: v.optional(v.number()),
    isRecurring: v.boolean(),
    recurrenceRule: v.optional(v.string()), // NONE | WEEKLY | MONTHLY
  }).index("by_targetAccount", ["targetAccount"]),

  // User feedback
  feedbacks: defineTable({
    sender: v.string(),
    email: v.string(),
    message: v.string(),
    timestamp: v.string(),
  }),

  // Access requests (formerly db.accessRequests)
  accessRequests: defineTable({
    email: v.string(),
    accountId: v.string(),
    nickname: v.string(),
    type: v.string(), // ACCESS | REMOVAL
    timestamp: v.string(),
  }).index("by_email", ["email"]),

  // Global maintenance mode flag
  maintenanceMode: defineTable({
    enabled: v.boolean(),
    updatedBy: v.optional(v.string()),
    updatedAt: v.optional(v.string()),
  }),
});
