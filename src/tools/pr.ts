import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorToCallToolResult } from "@app/lib/mcp";
import { PullRequestResource } from "@app/resources/pull_request";
import { PRReviewResource } from "@app/resources/pr_review";
import { ExperimentResource } from "@app/resources/experiment";
import { RepositoryResource } from "@app/resources/repository";
import { SolutionResource } from "@app/resources/solutions";
import { err } from "@app/lib/error";
import { RunConfig } from "@app/runner/config";

const SERVER_NAME = "pr";
const SERVER_VERSION = "0.1.0";

export const prHeader = (pr: PullRequestResource) => {
  const data = pr.toJSON();
  return `\
#${data.number}
title=${data.title}
author=Agent ${data.author}
source_branch=${data.source_branch}
target_branch=${data.target_branch}
status=${data.status}`;
};

export const renderListOfPRs = (prs: PullRequestResource[]) => {
  if (prs.length === 0) {
    return "(0 PRs found)";
  }
  return prs.map((pr) => prHeader(pr)).join("\n\n");
};

export async function createPRServer(
  experiment: ExperimentResource,
  agentIndex: number,
  config: RunConfig,
): Promise<McpServer> {
  const server = new McpServer({
    name: SERVER_NAME,
    title: "Pull Requests: Tools to create, review, and vote on pull requests.",
    version: SERVER_VERSION,
  });

  server.tool(
    "create_pull_request",
    "Create a new pull request to propose code changes.",
    {
      title: z.string().describe("Title of the pull request"),
      description: z.string().describe("Description of the changes"),
      source_branch: z.string().describe("Branch name containing your changes"),
      target_branch: z
        .string()
        .optional()
        .describe("Branch to merge into (defaults to main)"),
    },
    async ({ title, description, source_branch, target_branch }) => {
      const expData = experiment.toJSON();

      // Get repository
      const repoResult = await RepositoryResource.findByExperiment(expData.id);
      if (repoResult.isErr()) {
        return errorToCallToolResult(repoResult);
      }
      const repo = repoResult.value;

      // Get next PR number
      const prNumber = await PullRequestResource.getNextNumber(
        expData.id,
        repo.id,
      );

      // Create PR
      const pr = await PullRequestResource.create({
        experiment: expData.id,
        repository: repo.id,
        number: prNumber,
        author: agentIndex,
        title,
        description,
        source_branch,
        target_branch: target_branch || repo.mainBranch,
        status: "open",
      });

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `Pull request #${prNumber} created successfully!\n\n${prHeader(pr)}`,
          },
        ],
      };
    },
  );

  server.tool(
    "list_pull_requests",
    "List pull requests in the experiment.",
    {
      status: z
        .enum(["open", "closed", "merged"])
        .optional()
        .describe("Filter by PR status. If not specified, shows all PRs."),
    },
    async ({ status }) => {
      const expData = experiment.toJSON();
      const prs = await PullRequestResource.listByExperiment(
        expData.id,
        status,
      );

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: renderListOfPRs(prs),
          },
        ],
      };
    },
  );

  server.tool(
    "get_pull_request",
    "Get details of a specific pull request including reviews.",
    {
      pr_number: z.number().describe("Pull request number"),
    },
    async ({ pr_number }) => {
      const expData = experiment.toJSON();
      const prResult = await PullRequestResource.findByNumber(
        expData.id,
        pr_number,
      );

      if (prResult.isErr()) {
        return errorToCallToolResult(prResult);
      }

      const pr = prResult.value;
      const reviews = await pr.getReviews();

      const reviewsText =
        reviews.length > 0
          ? reviews
              .map(
                (r) => `\
Agent ${r.reviewer}: ${r.decision || "PENDING"}
${r.content || ""}`,
              )
              .join("\n\n")
          : "No reviews yet";

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `${prHeader(pr)}

DESCRIPTION:
${pr.description}

REVIEWS:
${reviewsText}`,
          },
        ],
      };
    },
  );

  server.tool(
    "review_pull_request",
    "Submit a review for a pull request.",
    {
      pr_number: z.number().describe("Pull request number to review"),
      decision: z
        .enum(["approve", "request_changes", "comment"])
        .describe(
          "Your review decision: 'approve' if code looks good, 'request_changes' if changes needed, 'comment' for general feedback",
        ),
      content: z.string().describe("Your review comments"),
    },
    async ({ pr_number, decision, content }) => {
      const expData = experiment.toJSON();

      // Get PR
      const prResult = await PullRequestResource.findByNumber(
        expData.id,
        pr_number,
      );
      if (prResult.isErr()) {
        return errorToCallToolResult(prResult);
      }

      const pr = prResult.value;

      // Check if agent is not the author
      if (pr.author === agentIndex) {
        return errorToCallToolResult(
          err("tool_error", "You cannot review your own pull request"),
        );
      }

      // Check if already reviewed
      const existingReview = await PRReviewResource.findByPRAndReviewer(
        pr.id,
        agentIndex,
      );

      if (existingReview.isOk()) {
        // Update existing review
        await existingReview.value.update({
          decision,
          content,
        });

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `Review updated for PR #${pr_number}: ${decision}`,
            },
          ],
        };
      }

      // Create new review
      await PRReviewResource.create({
        experiment: expData.id,
        pull_request: pr.id,
        reviewer: agentIndex,
        decision,
        content,
      });

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `Review submitted for PR #${pr_number}: ${decision}`,
          },
        ],
      };
    },
  );

  server.tool(
    "vote_for_solution",
    "Vote for a pull request as the best solution to the problem.",
    {
      pr_number: z.number().describe("Pull request number to vote for"),
    },
    async ({ pr_number }) => {
      const expData = experiment.toJSON();

      // Get PR
      const prResult = await PullRequestResource.findByNumber(
        expData.id,
        pr_number,
      );
      if (prResult.isErr()) {
        return errorToCallToolResult(prResult);
      }

      const pr = prResult.value;

      // Vote for PR (will create or update vote)
      const voteResult = await SolutionResource.vote(
        expData.id,
        agentIndex,
        pr.toJSON().id,
      );

      if (voteResult.isErr()) {
        return errorToCallToolResult(voteResult);
      }

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `Voted for PR #${pr_number} as the best solution`,
          },
        ],
      };
    },
  );

  return server;
}
