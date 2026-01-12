import { db } from "@app/db";
import { pull_requests, pr_reviews } from "@app/db/schema";
import { err, ok, Result } from "@app/lib/error";
import { eq, and, InferSelectModel, InferInsertModel, desc } from "drizzle-orm";

type PullRequest = InferSelectModel<typeof pull_requests>;

export class PullRequestResource {
  private data: PullRequest;

  private constructor(data: PullRequest) {
    this.data = data;
  }

  static async findById(id: number): Promise<Result<PullRequestResource>> {
    const result = await db
      .select()
      .from(pull_requests)
      .where(eq(pull_requests.id, id))
      .limit(1);

    return result[0]
      ? ok(new PullRequestResource(result[0]))
      : err("not_found_error", `Pull request ${id} not found.`);
  }

  static async findByNumber(
    experimentId: number,
    prNumber: number,
  ): Promise<Result<PullRequestResource>> {
    const result = await db
      .select()
      .from(pull_requests)
      .where(
        and(
          eq(pull_requests.experiment, experimentId),
          eq(pull_requests.number, prNumber),
        ),
      )
      .limit(1);

    return result[0]
      ? ok(new PullRequestResource(result[0]))
      : err("not_found_error", `Pull request #${prNumber} not found.`);
  }

  static async listByExperiment(
    experimentId: number,
    status?: "open" | "closed" | "merged",
  ): Promise<PullRequestResource[]> {
    const conditions = [eq(pull_requests.experiment, experimentId)];
    if (status) {
      conditions.push(eq(pull_requests.status, status));
    }

    const results = await db
      .select()
      .from(pull_requests)
      .where(and(...conditions))
      .orderBy(desc(pull_requests.created));

    return results.map((data) => new PullRequestResource(data));
  }

  static async listByAuthor(
    experimentId: number,
    authorIndex: number,
  ): Promise<PullRequestResource[]> {
    const results = await db
      .select()
      .from(pull_requests)
      .where(
        and(
          eq(pull_requests.experiment, experimentId),
          eq(pull_requests.author, authorIndex),
        ),
      )
      .orderBy(desc(pull_requests.created));

    return results.map((data) => new PullRequestResource(data));
  }

  static async getNextNumber(
    experimentId: number,
    repositoryId: number,
  ): Promise<number> {
    const results = await db
      .select({ number: pull_requests.number })
      .from(pull_requests)
      .where(
        and(
          eq(pull_requests.experiment, experimentId),
          eq(pull_requests.repository, repositoryId),
        ),
      )
      .orderBy(desc(pull_requests.number))
      .limit(1);

    return results[0] ? results[0].number + 1 : 1;
  }

  static async create(
    data: Omit<InferInsertModel<typeof pull_requests>, "id" | "created" | "updated">,
  ): Promise<PullRequestResource> {
    const [created] = await db.insert(pull_requests).values(data).returning();
    return new PullRequestResource(created);
  }

  async update(
    data: Partial<Omit<InferInsertModel<typeof pull_requests>, "id" | "created">>,
  ): Promise<PullRequestResource> {
    const [updated] = await db
      .update(pull_requests)
      .set({ ...data, updated: new Date() })
      .where(eq(pull_requests.id, this.data.id))
      .returning();

    this.data = updated;
    return this;
  }

  async delete(): Promise<void> {
    await db.delete(pull_requests).where(eq(pull_requests.id, this.data.id));
  }

  async getReviews(): Promise<InferSelectModel<typeof pr_reviews>[]> {
    return await db
      .select()
      .from(pr_reviews)
      .where(eq(pr_reviews.pull_request, this.data.id));
  }

  async getApprovalCount(): Promise<number> {
    const reviews = await this.getReviews();
    return reviews.filter((r) => r.decision === "approve").length;
  }

  async hasRequestedChanges(): Promise<boolean> {
    const reviews = await this.getReviews();
    return reviews.some((r) => r.decision === "request_changes");
  }

  toJSON() {
    return this.data;
  }

  get id() {
    return this.data.id;
  }

  get number() {
    return this.data.number;
  }

  get author() {
    return this.data.author;
  }

  get title() {
    return this.data.title;
  }

  get description() {
    return this.data.description;
  }

  get sourceBranch() {
    return this.data.source_branch;
  }

  get targetBranch() {
    return this.data.target_branch;
  }

  get status() {
    return this.data.status;
  }

  get experimentId() {
    return this.data.experiment;
  }

  get repositoryId() {
    return this.data.repository;
  }
}
