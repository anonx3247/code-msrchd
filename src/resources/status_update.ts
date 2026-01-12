import { db } from "@app/db";
import { status_updates } from "@app/db/schema";
import { err, ok, Result } from "@app/lib/error";
import { eq, and, InferSelectModel, InferInsertModel, desc } from "drizzle-orm";

type StatusUpdate = InferSelectModel<typeof status_updates>;

export class StatusUpdateResource {
  private data: StatusUpdate;

  private constructor(data: StatusUpdate) {
    this.data = data;
  }

  static async findById(id: number): Promise<Result<StatusUpdateResource>> {
    const result = await db
      .select()
      .from(status_updates)
      .where(eq(status_updates.id, id))
      .limit(1);

    return result[0]
      ? ok(new StatusUpdateResource(result[0]))
      : err("not_found_error", `Status update ${id} not found.`);
  }

  static async listByExperiment(
    experimentId: number,
  ): Promise<StatusUpdateResource[]> {
    const results = await db
      .select()
      .from(status_updates)
      .where(eq(status_updates.experiment, experimentId))
      .orderBy(desc(status_updates.created));

    return results.map((data) => new StatusUpdateResource(data));
  }

  static async listByAgent(
    experimentId: number,
    agentIndex: number,
  ): Promise<StatusUpdateResource[]> {
    const results = await db
      .select()
      .from(status_updates)
      .where(
        and(
          eq(status_updates.experiment, experimentId),
          eq(status_updates.agent, agentIndex),
        ),
      )
      .orderBy(desc(status_updates.created));

    return results.map((data) => new StatusUpdateResource(data));
  }

  static async listByType(
    experimentId: number,
    type: "todo_list" | "progress" | "question",
  ): Promise<StatusUpdateResource[]> {
    const results = await db
      .select()
      .from(status_updates)
      .where(
        and(
          eq(status_updates.experiment, experimentId),
          eq(status_updates.type, type),
        ),
      )
      .orderBy(desc(status_updates.created));

    return results.map((data) => new StatusUpdateResource(data));
  }

  static async getLatestByAgent(
    experimentId: number,
    agentIndex: number,
  ): Promise<StatusUpdateResource | null> {
    const results = await db
      .select()
      .from(status_updates)
      .where(
        and(
          eq(status_updates.experiment, experimentId),
          eq(status_updates.agent, agentIndex),
        ),
      )
      .orderBy(desc(status_updates.created))
      .limit(1);

    return results[0] ? new StatusUpdateResource(results[0]) : null;
  }

  static async create(
    data: Omit<InferInsertModel<typeof status_updates>, "id" | "created">,
  ): Promise<StatusUpdateResource> {
    const [created] = await db.insert(status_updates).values(data).returning();
    return new StatusUpdateResource(created);
  }

  async delete(): Promise<void> {
    await db.delete(status_updates).where(eq(status_updates.id, this.data.id));
  }

  toJSON() {
    return this.data;
  }

  get id() {
    return this.data.id;
  }

  get experimentId() {
    return this.data.experiment;
  }

  get agent() {
    return this.data.agent;
  }

  get type() {
    return this.data.type;
  }

  get content() {
    return this.data.content;
  }

  get created() {
    return this.data.created;
  }
}
