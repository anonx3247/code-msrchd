import { db } from "@app/db";
import { pr_reviews } from "@app/db/schema";
import { err, ok, Result } from "@app/lib/error";
import { eq, and, InferSelectModel, InferInsertModel } from "drizzle-orm";

type PRReview = InferSelectModel<typeof pr_reviews>;

export class PRReviewResource {
  private data: PRReview;

  private constructor(data: PRReview) {
    this.data = data;
  }

  static async findById(id: number): Promise<Result<PRReviewResource>> {
    const result = await db
      .select()
      .from(pr_reviews)
      .where(eq(pr_reviews.id, id))
      .limit(1);

    return result[0]
      ? ok(new PRReviewResource(result[0]))
      : err("not_found_error", `PR review ${id} not found.`);
  }

  static async findByPRAndReviewer(
    pullRequestId: number,
    reviewerIndex: number,
  ): Promise<Result<PRReviewResource>> {
    const result = await db
      .select()
      .from(pr_reviews)
      .where(
        and(
          eq(pr_reviews.pull_request, pullRequestId),
          eq(pr_reviews.reviewer, reviewerIndex),
        ),
      )
      .limit(1);

    return result[0]
      ? ok(new PRReviewResource(result[0]))
      : err(
          "not_found_error",
          `Review by agent ${reviewerIndex} for PR ${pullRequestId} not found.`,
        );
  }

  static async listByPR(pullRequestId: number): Promise<PRReviewResource[]> {
    const results = await db
      .select()
      .from(pr_reviews)
      .where(eq(pr_reviews.pull_request, pullRequestId));

    return results.map((data) => new PRReviewResource(data));
  }

  static async listByReviewer(
    experimentId: number,
    reviewerIndex: number,
  ): Promise<PRReviewResource[]> {
    const results = await db
      .select()
      .from(pr_reviews)
      .where(
        and(
          eq(pr_reviews.experiment, experimentId),
          eq(pr_reviews.reviewer, reviewerIndex),
        ),
      );

    return results.map((data) => new PRReviewResource(data));
  }

  static async create(
    data: Omit<InferInsertModel<typeof pr_reviews>, "id" | "created" | "updated">,
  ): Promise<PRReviewResource> {
    const [created] = await db.insert(pr_reviews).values(data).returning();
    return new PRReviewResource(created);
  }

  async update(
    data: Partial<Omit<InferInsertModel<typeof pr_reviews>, "id" | "created">>,
  ): Promise<PRReviewResource> {
    const [updated] = await db
      .update(pr_reviews)
      .set({ ...data, updated: new Date() })
      .where(eq(pr_reviews.id, this.data.id))
      .returning();

    this.data = updated;
    return this;
  }

  async delete(): Promise<void> {
    await db.delete(pr_reviews).where(eq(pr_reviews.id, this.data.id));
  }

  toJSON() {
    return this.data;
  }

  get id() {
    return this.data.id;
  }

  get pullRequestId() {
    return this.data.pull_request;
  }

  get reviewer() {
    return this.data.reviewer;
  }

  get decision() {
    return this.data.decision;
  }

  get content() {
    return this.data.content;
  }

  get experimentId() {
    return this.data.experiment;
  }
}
