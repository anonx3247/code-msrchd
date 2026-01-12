import {
  sqliteTable,
  text,
  integer,
  real,
  unique,
  index,
} from "drizzle-orm/sqlite-core";
import { Message } from "@app/models";
import { Model } from "@app/models/provider";

export const experiments = sqliteTable(
  "experiments",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    name: text("name").notNull(),
    problem: text("problem").notNull(),

    // New fields for msrchd
    profile: text("profile").notNull().default("research"),
    model: text("model").$type<Model>().notNull(),
    agent_count: integer("agent_count").notNull().default(0),

    // New fields for code-msrchd
    sandbox_mode: text("sandbox_mode", {
      enum: ["docker", "worktree"],
    }).notNull().default("docker"),
    repository_url: text("repository_url"),
    repository_path: text("repository_path"),
  },
  (t) => [unique().on(t.name)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    experiment: integer("experiment")
      .notNull()
      .references(() => experiments.id),
    agent: integer("agent").notNull(),

    position: integer("position").notNull(),

    role: text("role", { enum: ["user", "agent"] as const })
      .$type<Message["role"]>()
      .notNull(),
    content: text("content", { mode: "json" })
      .$type<Message["content"]>()
      .notNull(),

    // Token tracking
    total_tokens: integer("total_tokens").notNull().default(0),
    cost: real("cost").notNull().default(0),
  },
  (t) => [unique().on(t.experiment, t.agent, t.position)],
);

export const publications = sqliteTable(
  "publications",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    experiment: integer("experiment")
      .notNull()
      .references(() => experiments.id),
    author: integer("author").notNull(),

    title: text("title").notNull(),
    status: text("status", {
      enum: ["SUBMITTED", "PUBLISHED", "REJECTED"],
    }).notNull(),
    reference: text("reference").notNull(),
  },
  (t) => {
    return [unique().on(t.experiment, t.reference)];
  },
);

export const citations = sqliteTable(
  "citations",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    experiment: integer("experiment")
      .notNull()
      .references(() => experiments.id),

    from: integer("from")
      .notNull()
      .references(() => publications.id),

    to: integer("to")
      .notNull()
      .references(() => publications.id),
  },
  (t) => [unique().on(t.from, t.to, t.experiment)],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    experiment: integer("experiment")
      .notNull()
      .references(() => experiments.id),
    publication: integer("publication")
      .notNull()
      .references(() => publications.id),
    author: integer("author").notNull(),

    grade: text("grade", {
      enum: ["ACCEPT", "REJECT"],
    }),
    content: text("content"),
  },
  (t) => [unique().on(t.author, t.publication)],
);

export const solutions = sqliteTable(
  "solutions",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    experiment: integer("experiment")
      .notNull()
      .references(() => experiments.id),
    pull_request: integer("pull_request")
      .notNull()
      .references(() => pull_requests.id),
    agent: integer("agent").notNull(),
  },
  (t) => [
    unique().on(t.experiment, t.agent),
    index("solutions_idx_experiment").on(t.experiment),
  ],
);

// New tables for code-msrchd

export const repositories = sqliteTable("repositories", {
  id: integer("id").primaryKey(),
  created: integer("created", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updated: integer("updated", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),

  experiment: integer("experiment")
    .notNull()
    .references(() => experiments.id),

  path: text("path").notNull(),
  remote_url: text("remote_url"),
  main_branch: text("main_branch").notNull().default("main"),
});

export const pull_requests = sqliteTable(
  "pull_requests",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    experiment: integer("experiment")
      .notNull()
      .references(() => experiments.id),
    repository: integer("repository")
      .notNull()
      .references(() => repositories.id),

    number: integer("number").notNull(),
    author: integer("author").notNull(),

    title: text("title").notNull(),
    description: text("description").notNull(),

    source_branch: text("source_branch").notNull(),
    target_branch: text("target_branch").notNull(),

    status: text("status", {
      enum: ["open", "closed", "merged"],
    })
      .notNull()
      .default("open"),
  },
  (t) => [
    unique().on(t.experiment, t.repository, t.number),
    index("prs_idx_author").on(t.author),
    index("prs_idx_status").on(t.status),
  ],
);

export const pr_reviews = sqliteTable(
  "pr_reviews",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    experiment: integer("experiment")
      .notNull()
      .references(() => experiments.id),
    pull_request: integer("pull_request")
      .notNull()
      .references(() => pull_requests.id),

    reviewer: integer("reviewer").notNull(),

    decision: text("decision", {
      enum: ["approve", "request_changes", "comment"],
    }),
    content: text("content"),
  },
  (t) => [
    unique().on(t.pull_request, t.reviewer),
    index("pr_reviews_idx_reviewer").on(t.reviewer),
  ],
);

export const status_updates = sqliteTable(
  "status_updates",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    experiment: integer("experiment")
      .notNull()
      .references(() => experiments.id),
    agent: integer("agent").notNull(),

    type: text("type", {
      enum: ["todo_list", "progress", "question"],
    }).notNull(),
    content: text("content").notNull(),
  },
  (t) => [
    index("status_updates_idx_agent").on(t.agent),
    index("status_updates_idx_type").on(t.type),
  ],
);
