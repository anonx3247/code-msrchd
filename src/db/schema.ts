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
    publication: integer("publication")
      .notNull()
      .references(() => publications.id),
    agent: integer("agent").notNull(),
  },
  (t) => [
    unique().on(t.experiment, t.agent),
    index("solutions_idx_experiment").on(t.experiment),
  ],
);
