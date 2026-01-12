import { db } from "@app/db";
import { solutions } from "@app/db/schema";
import { eq, InferSelectModel, and, desc } from "drizzle-orm";
import { ExperimentResource } from "./experiment";
import { concurrentExecutor } from "@app/lib/async";
import { PullRequestResource } from "./pull_request";
import { removeNulls } from "@app/lib/utils";
import { Result, ok, err } from "@app/lib/error";

type Solution = InferSelectModel<typeof solutions>;

export class SolutionResource {
  private data: Solution;
  private pullRequest: PullRequestResource;
  experiment: ExperimentResource;

  private constructor(
    data: Solution,
    experiment: ExperimentResource,
    pullRequest: PullRequestResource,
  ) {
    this.data = data;
    this.experiment = experiment;
    this.pullRequest = pullRequest;
  }

  static async findLatestByAgent(
    experiment: ExperimentResource,
    agentIndex: number,
  ): Promise<SolutionResource | null> {
    const [result] = await db
      .select()
      .from(solutions)
      .where(
        and(
          eq(solutions.experiment, experiment.toJSON().id),
          eq(solutions.agent, agentIndex),
        ),
      )
      .orderBy(desc(solutions.created))
      .limit(1);

    if (!result) {
      return null;
    }

    const prResult = await PullRequestResource.findById(result.pull_request);
    if (prResult.isErr()) {
      return null;
    }

    return new SolutionResource(result, experiment, prResult.value);
  }

  static async listByAgent(
    experiment: ExperimentResource,
    agentIndex: number,
  ): Promise<SolutionResource[]> {
    const results = await db
      .select()
      .from(solutions)
      .where(
        and(
          eq(solutions.experiment, experiment.toJSON().id),
          eq(solutions.agent, agentIndex),
        ),
      )
      .orderBy(desc(solutions.created));

    return removeNulls(
      await concurrentExecutor(
        results,
        async (sol) => {
          const prResult = await PullRequestResource.findById(sol.pull_request);
          if (prResult.isErr()) {
            return null;
          }
          return new SolutionResource(sol, experiment, prResult.value);
        },
        { concurrency: 8 },
      ),
    );
  }

  static async listByExperiment(
    experiment: ExperimentResource,
  ): Promise<SolutionResource[]> {
    const results = await db
      .select()
      .from(solutions)
      .where(and(eq(solutions.experiment, experiment.toJSON().id)))
      .orderBy(desc(solutions.created));

    return removeNulls(
      await concurrentExecutor(
        results,
        async (sol) => {
          const prResult = await PullRequestResource.findById(sol.pull_request);
          if (prResult.isErr()) {
            return null;
          }
          return new SolutionResource(sol, experiment, prResult.value);
        },
        { concurrency: 8 },
      ),
    );
  }

  static async vote(
    experimentId: number,
    agentIndex: number,
    pullRequestId: number,
  ): Promise<Result<void>> {
    try {
      await db
        .insert(solutions)
        .values({
          experiment: experimentId,
          agent: agentIndex,
          pull_request: pullRequestId,
        })
        .onConflictDoUpdate({
          target: [solutions.experiment, solutions.agent],
          set: {
            pull_request: pullRequestId,
          },
        });

      return ok(undefined);
    } catch (error) {
      return err("resource_creation_error", "Failed to vote for PR solution", error);
    }
  }

  static async getVoteCount(experimentId: number): Promise<number> {
    const results = await db
      .select()
      .from(solutions)
      .where(eq(solutions.experiment, experimentId));
    return results.length;
  }

  static async allAgentsHaveVoted(experiment: ExperimentResource): Promise<boolean> {
    const expData = experiment.toJSON();
    const voteCount = await this.getVoteCount(expData.id);
    return voteCount >= expData.agent_count;
  }

  toJSON() {
    return {
      ...this.data,
      pullRequest: this.pullRequest.toJSON(),
    };
  }
}
