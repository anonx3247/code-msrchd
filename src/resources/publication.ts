import { db } from "@app/db";
import { citations, publications, reviews } from "@app/db/schema";
import {
  eq,
  InferSelectModel,
  InferInsertModel,
  and,
  desc,
  inArray,
  count,
  isNull,
  getTableColumns,
} from "drizzle-orm";
import { ExperimentResource } from "./experiment";
import { Result, err, ok } from "@app/lib/error";
import { removeNulls } from "@app/lib/utils";
import { concurrentExecutor } from "@app/lib/async";
import { assertNever } from "@app/lib/assert";

export type Publication = InferSelectModel<typeof publications>;
export type Review = InferSelectModel<typeof reviews>;
export type Citation = InferInsertModel<typeof citations>;

export class PublicationResource {
  private data: Publication;
  private citations: { from: Citation[]; to: Citation[] };
  private reviews: Review[];
  experiment: ExperimentResource;

  private constructor(data: Publication, experiment: ExperimentResource) {
    this.data = data;
    this.citations = { from: [], to: [] };
    this.reviews = [];
    this.experiment = experiment;
  }

  private async finalize(): Promise<PublicationResource> {
    const fromCitationsQuery = db
      .select()
      .from(citations)
      .where(eq(citations.from, this.data.id));
    const toCitationsQuery = db
      .select()
      .from(citations)
      .where(eq(citations.to, this.data.id));
    const reviewsQuery = db
      .select()
      .from(reviews)
      .where(eq(reviews.publication, this.data.id));

    const [fromCitationsResults, toCitationsResults, reviewsResults] =
      await Promise.all([
        fromCitationsQuery,
        toCitationsQuery,
        reviewsQuery,
      ]);

    this.citations.from = fromCitationsResults;
    this.citations.to = toCitationsResults;
    this.reviews = reviewsResults;

    return this;
  }

  static async findById(
    experiment: ExperimentResource,
    id: number,
  ): Promise<PublicationResource | null> {
    const [result] = await db
      .select()
      .from(publications)
      .where(eq(publications.id, id))
      .limit(1);

    if (!result) return null;

    return await new PublicationResource(result, experiment).finalize();
  }

  static async listPublishedByExperiment(
    experiment: ExperimentResource,
    options: {
      order: "latest" | "citations";
      status: "PUBLISHED" | "SUBMITTED" | "REJECTED";
      limit: number;
      offset: number;
    },
  ): Promise<PublicationResource[]> {
    const { order, limit, offset } = options;

    const baseQuery = db
      .select({
        ...getTableColumns(publications),
        citationsCount: count(citations.id),
      })
      .from(publications)
      .leftJoin(citations, eq(citations.to, publications.id))
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          eq(publications.status, "PUBLISHED"),
        ),
      )
      .groupBy(publications.id)
      .limit(limit)
      .offset(offset);

    const query = (() => {
      switch (order) {
        case "latest": {
          return baseQuery.orderBy(desc(publications.created));
        }
        case "citations": {
          return baseQuery.orderBy(desc(count(citations.id)));
        }
        default:
          assertNever(order);
      }
    })();
    const results = await query;

    return await concurrentExecutor(
      results,
      async (data) => {
        return await new PublicationResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );
  }

  static async listByExperimentAndReviewRequested(
    experiment: ExperimentResource,
    reviewerIndex: number,
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.experiment, experiment.toJSON().id),
          eq(reviews.author, reviewerIndex),
          isNull(reviews.grade),
        ),
      );

    if (results.length === 0) return [];

    const publicationIds = results.map((r) => r.publication);
    const publicationsQuery = db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          inArray(publications.id, publicationIds),
        ),
      );

    const publicationsResults = await publicationsQuery;

    return await concurrentExecutor(
      publicationsResults,
      async (data) => {
        return await new PublicationResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );
  }

  static async listByAuthor(
    experiment: ExperimentResource,
    authorIndex: number,
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          eq(publications.author, authorIndex),
        ),
      );

    return await concurrentExecutor(
      results,
      async (data) => {
        return await new PublicationResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );
  }

  static async listByExperiment(
    experiment: ExperimentResource,
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(publications)
      .where(eq(publications.experiment, experiment.toJSON().id))
      .orderBy(desc(publications.created));

    return await concurrentExecutor(
      results,
      async (data) => {
        return await new PublicationResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );
  }

  static async findByReference(
    experiment: ExperimentResource,
    reference: string,
  ): Promise<PublicationResource | null> {
    const [r] = await PublicationResource.findByReferences(experiment, [
      reference,
    ]);

    return r ?? null;
  }

  static async findByReferences(
    experiment: ExperimentResource,
    references: string[],
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          inArray(publications.reference, references),
        ),
      );

    return await concurrentExecutor(
      results,
      async (data) => {
        return await new PublicationResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );
  }

  static async submit(
    experiment: ExperimentResource,
    authorIndex: number,
    data: {
      title: string;
      reference: string;
      citations: string[];
    },
  ): Promise<Result<PublicationResource>> {
    const [created] = await db
      .insert(publications)
      .values({
        experiment: experiment.toJSON().id,
        author: authorIndex,
        title: data.title,
        reference: data.reference,
        status: "SUBMITTED",
      })
      .returning();

    // Create citation records
    if (data.citations.length > 0) {
      const citedPublications = await PublicationResource.findByReferences(
        experiment,
        data.citations,
      );

      if (citedPublications.length > 0) {
        await db.insert(citations).values(
          citedPublications.map((cited) => ({
            experiment: experiment.toJSON().id,
            from: created.id,
            to: cited.toJSON().id,
          })),
        );
      }
    }

    const resource = await new PublicationResource(created, experiment).finalize();
    return ok(resource);
  }

  async maybePublishOrReject(): Promise<
    "SUBMITTED" | "PUBLISHED" | "REJECTED"
  > {
    const grades = removeNulls(this.reviews.map((r) => r.grade ?? null));

    if (grades.length < this.reviews.length) {
      return "SUBMITTED";
    }

    if (grades.some((g) => g === "REJECT")) {
      await this.reject();
    } else {
      await this.publish();
    }

    return this.data.status;
  }

  async publish() {
    try {
      const [updated] = await db
        .update(publications)
        .set({
          status: "PUBLISHED",
          updated: new Date(),
        })
        .where(eq(publications.id, this.data.id))
        .returning();

      if (!updated) {
        return err("not_found_error", "Publication not found");
      }

      this.data = updated;
      return ok(this);
    } catch (error) {
      return err(
        "resource_update_error",
        "Failed to publish publication",
        error,
      );
    }
  }

  async reject() {
    try {
      const [updated] = await db
        .update(publications)
        .set({
          status: "REJECTED",
          updated: new Date(),
        })
        .where(eq(publications.id, this.data.id))
        .returning();

      if (!updated) {
        return err("not_found_error", "Publication not found");
      }

      this.data = updated;
      return ok(this);
    } catch (error) {
      return err(
        "resource_update_error",
        "Failed to reject publication",
        error,
      );
    }
  }

  async requestReviewers(
    reviewerIndices: number[],
  ): Promise<Result<Review[]>> {
    if (this.reviews.length > 0) {
      return err(
        "resource_creation_error",
        "Reviews already exist for this publication",
      );
    }

    const created = await db
      .insert(reviews)
      .values(
        reviewerIndices.map((reviewerIndex) => ({
          experiment: this.experiment.toJSON().id,
          publication: this.data.id,
          author: reviewerIndex,
        })),
      )
      .returning();

    this.reviews = created;

    return ok(this.reviews);
  }

  async submitReview(
    reviewerIndex: number,
    data: Omit<
      InferInsertModel<typeof reviews>,
      "id" | "created" | "updated" | "experiment" | "publication" | "author"
    >,
  ): Promise<Result<Review>> {
    const idx = this.reviews.findIndex((r) => r.author === reviewerIndex);
    if (idx === -1) {
      return err(
        "resource_creation_error",
        "Review submitted does not match any review request.",
      );
    }

    const [updated] = await db
      .update(reviews)
      .set({
        grade: data.grade,
        content: data.content,
        updated: new Date(),
      })
      .where(
        and(
          eq(reviews.experiment, this.experiment.toJSON().id),
          eq(reviews.publication, this.data.id),
          eq(reviews.author, reviewerIndex),
        ),
      )
      .returning();

    if (!updated) {
      return err("not_found_error", "Review not found");
    }

    this.reviews[idx] = updated;

    return ok(this.reviews[idx]);
  }

  toJSON() {
    return {
      ...this.data,
      citations: this.citations,
      reviews: this.reviews,
    };
  }
}
