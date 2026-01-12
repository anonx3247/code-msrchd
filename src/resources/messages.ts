import { db, Tx } from "@app/db";
import { messages } from "@app/db/schema";
import { eq, InferSelectModel, and, asc, sum } from "drizzle-orm";
import { ExperimentResource } from "./experiment";
import { Message } from "@app/models";

export class MessageResource {
  private data: InferSelectModel<typeof messages>;
  experiment: ExperimentResource;

  private constructor(
    data: InferSelectModel<typeof messages>,
    experiment: ExperimentResource,
  ) {
    this.data = data;
    this.experiment = experiment;
  }

  static async findById(
    experiment: ExperimentResource,
    agentIndex: number,
    id: number,
  ): Promise<MessageResource | null> {
    const result = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.experiment, experiment.toJSON().id),
          eq(messages.agent, agentIndex),
          eq(messages.id, id),
        ),
      )
      .limit(1);

    return result[0] ? new MessageResource(result[0], experiment) : null;
  }

  static async listMessagesByAgent(
    experiment: ExperimentResource,
    agentIndex: number,
  ): Promise<MessageResource[]> {
    const results = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.experiment, experiment.toJSON().id),
          eq(messages.agent, agentIndex),
        ),
      )
      .orderBy(asc(messages.position));

    return results.map((msg) => new MessageResource(msg, experiment));
  }

  static async listMessagesByExperiment(
    experiment: ExperimentResource,
  ): Promise<MessageResource[]> {
    const results = await db
      .select()
      .from(messages)
      .where(eq(messages.experiment, experiment.toJSON().id))
      .orderBy(asc(messages.position));

    return results.map((msg) => new MessageResource(msg, experiment));
  }

  static async create(
    experiment: ExperimentResource,
    agentIndex: number,
    message: Message,
    positon: number,
    totalTokens: number,
    cost: number,
    options?: { tx?: Tx },
  ): Promise<MessageResource> {
    const executor = options?.tx ?? db;
    const [created] = await executor
      .insert(messages)
      .values({
        experiment: experiment.toJSON().id,
        agent: agentIndex,
        ...message,
        position: positon,
        total_tokens: totalTokens,
        cost,
      })
      .returning();

    return new MessageResource(created, experiment);
  }

  id(): number {
    return this.data.id;
  }

  position(): number {
    return this.data.position;
  }

  created(): Date {
    return new Date(this.data.created);
  }

  toJSON(): Message & { id: number } {
    return {
      id: this.data.id,
      role: this.data.role,
      content: this.data.content,
    };
  }

  static async totalTokensForExperiment(
    experiment: ExperimentResource,
  ): Promise<number> {
    const results = await db
      .select({ total: sum(messages.total_tokens) })
      .from(messages)
      .where(eq(messages.experiment, experiment.toJSON().id));

    return Number(results[0]?.total ?? 0);
  }

  static async totalCostForExperiment(
    experiment: ExperimentResource,
  ): Promise<number> {
    const results = await db
      .select({ total: sum(messages.cost) })
      .from(messages)
      .where(eq(messages.experiment, experiment.toJSON().id));

    return Number(results[0]?.total ?? 0);
  }
}
