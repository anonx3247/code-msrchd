import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorToCallToolResult } from "@app/lib/mcp";
import { PublicationResource, Review } from "@app/resources/publication";
import { ExperimentResource } from "@app/resources/experiment";
import { SolutionResource } from "@app/resources/solutions";
import { err } from "@app/lib/error";
import { RunConfig } from "@app/runner/config";
import { computerId, Computer } from "@app/computer";
import { newID6 } from "@app/lib/utils";
import fs from "fs";
import path from "path";

const SERVER_NAME = "publications";

const SERVER_VERSION = "0.1.0";

export function writePublicationContent(reference: string, content: string): void {
  const publicationDir = path.join("publications", reference);
  const publicationFile = path.join(publicationDir, "publication.md");
  fs.mkdirSync(publicationDir, { recursive: true });
  fs.writeFileSync(publicationFile, content, "utf-8");
}

export function extractReferences(content: string): string[] {
  const regex = /\[([a-z0-9]{6}(?:\s*,\s*[a-z0-9]{6})*)\]/g;
  const matches: string[] = [];

  let match;
  while ((match = regex.exec(content)) !== null) {
    // Split by comma and trim whitespace to get individual IDs
    const ids = match[1].split(",").map((id) => id.trim());
    matches.push(...ids);
  }

  return matches;
}

export function getPublicationPath(reference: string): string {
  return path.join("publications", reference);
}

export function getPublicationFilePath(reference: string): string {
  return path.join(getPublicationPath(reference), "publication.md");
}

export function getPublicationContent(reference: string): string | null {
  try {
    const filePath = getPublicationFilePath(reference);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export const reviewHeader = (review: Review) => {
  return `\
reviewer=Agent ${review.author}
grade=${review.grade ?? "PENDING"}`;
};


export function getAttachmentPath(reference: string, filename?: string) {
  const pth = ["publications", reference];
  if (filename) {
    pth.push(path.basename(filename));
  }
  return path.join(...pth);
}

export const publicationHeader = (
  publication: PublicationResource,
) => {
  const reference = publication.toJSON().reference;

  const attachmentsDir = getAttachmentPath(reference);
  const attachments = fs.existsSync(attachmentsDir) ? fs.readdirSync(attachmentsDir) : [];

  return `\
reference=[${publication.toJSON().reference}]
title=${publication.toJSON().title}
author=Agent ${publication.toJSON().author}
reviews:${publication
      .toJSON()
      .reviews.map((r) => `${r.grade ?? "PENDING"}`)
      .join(", ")}
status=${publication.toJSON().status}
citations_count=${publication.toJSON().citations.to.length}
attachments=[${attachments.join(",")}]`;
};

export const renderListOfPublications = (
  publications: PublicationResource[],
) => {
  if (publications.length === 0) {
    return "(0 found)";
  }
  return publications
    .map((p) => {
      return publicationHeader(p);
    })
    .join("\n\n");
};

export async function createPublicationsServer(
  experiment: ExperimentResource,
  agentIndex: number,
  config: RunConfig,
): Promise<McpServer> {
  const server = new McpServer({
    name: SERVER_NAME,
    title: "Publications: Tools to submit, review and access publications.",
    version: SERVER_VERSION,
  });


  server.tool(
    "list_publications",
    "List publications available in the system.",
    {
      order: z
        .enum(["latest", "citations"])
        .optional()
        .describe(
          `\
Ordering to use:
\`latest\` lists the most recent publications.
\`citations\` lists the most cited publications.
Defaults to \`latest\`.`,
        ),
      status: z
        .enum(["PUBLISHED", "SUBMITTED", "REJECTED"])
        .optional()
        .describe(
          `The status of the publications to list. Defaults to \`PUBLISHED\``,
        ),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of publications to return. Defaults to 10."),
      offset: z
        .number()
        .optional()
        .describe("Offset for pagination. Defaults to 0."),
    },
    async ({
      order = "latest",
      status = "PUBLISHED",
      limit = 10,
      offset = 0,
    }) => {
      const publications = await PublicationResource.listPublishedByExperiment(
        experiment,
        {
          order,
          status,
          limit,
          offset,
        },
      );

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: renderListOfPublications(publications),
          },
        ],
      };
    },
  );

  server.tool(
    "get_publication",
    "Retrieve a specific publication.",
    {
      reference: z.string().describe("Reference of the publication."),
    },
    async ({ reference }) => {
      const publication = await PublicationResource.findByReference(
        experiment,
        reference,
      );
      if (!publication) {
        return errorToCallToolResult(
          err("not_found_error", "Publication not found"),
        );
      }

      const content = getPublicationContent(reference);
      if (!content) {
        return errorToCallToolResult(
          err("not_found_error", "Publication content not found"),
        );
      }

      return {
        isError: false,
        content: [
          {
            type: "text",
            text:
              `\
${publicationHeader(publication)}

${content}` +
              "\n\n" +
              (publication.toJSON().status === "PUBLISHED"
                ? `\
${publication
                  .toJSON()
                  .reviews.map((r) => {
                    return `\
${reviewHeader(r)}
${r.content}`;
                  })
                  .join("\n\n")}`
                : "(reviews are hidden until publication/rejection)"),
          },
        ],
      };
    },
  );

  server.tool(
    "submit_publication",
    "Submit a new publication for review and publication.",
    {
      title: z.string().describe("Title of the publication."),
      content: z
        .string()
        .describe(
          "Full content of the publication. Use [{ref}] or [{ref},{ref}] inlined in content for citations.",
        ),
      attachments: z
        .array(z.string())
        .optional()
        .describe(
          "Optional paths to files in your computer to attach to the publication.",
        ),
    },
    async ({ title, content, attachments }) => {
      const pendingReviews =
        await PublicationResource.listByExperimentAndReviewRequested(
          experiment,
          agentIndex,
        );
      if (pendingReviews.length > 0) {
        return errorToCallToolResult(
          err(
            "publication_error",
            "You have pending reviews. Please complete them before submitting a new publication.",
          ),
        );
      }

      // Validate references in content
      const references = extractReferences(content);
      const found = await PublicationResource.findByReferences(
        experiment,
        references,
      );

      const foundFilter = new Set(found.map((c) => c.toJSON().reference));
      const notFound = references.filter((r) => !foundFilter.has(r));

      if (notFound.length > 0) {
        return errorToCallToolResult(
          err(
            "reference_not_found_error",
            "Reference not found in publication submission content: " +
            notFound.join(","),
          ),
        );
      }

      const agentIndices = experiment.getAgentIndices();
      const pool = agentIndices.filter((idx) => idx !== agentIndex);
      if (pool.length < config.reviewers) {
        return errorToCallToolResult(
          err("publication_error", "Not enough reviewers available"),
        );
      }
      const reviewers = pool
        .sort(() => 0.5 - Math.random())
        .slice(0, config.reviewers);

      // Generate reference and write content to filesystem
      const reference = newID6();

      try {
        writePublicationContent(reference, content);
      } catch (error) {
        return errorToCallToolResult(
          err("reading_file_error", "Failed to write publication to filesystem", error),
        );
      }

      const publication = await PublicationResource.submit(
        experiment,
        agentIndex,
        {
          title,
          reference,
          citations: references,
        },
      );
      if (publication.isErr()) {
        return errorToCallToolResult(publication);
      }

      if (attachments) {
        const attachmentsDir = getAttachmentPath(reference);

        // Ensure attachments directory exists
        if (!fs.existsSync(attachmentsDir)) {
          fs.mkdirSync(attachmentsDir, { recursive: true });
        }

        for (const attachmentPath of attachments) {
          const localFilePath = getAttachmentPath(reference, attachmentPath);
          const copyRes = await Computer.copyFromComputer(
            computerId(experiment, agentIndex),
            attachmentPath,
            localFilePath,
          );

          if (copyRes.isErr()) {
            return errorToCallToolResult(copyRes);
          }
        }
      }

      const reviews = await publication.value.requestReviewers(reviewers);
      if (reviews.isErr()) {
        return errorToCallToolResult(reviews);
      }
      if (reviewers.length === 0) {
        await publication.value.maybePublishOrReject();
      }

      const res = publication.value.toJSON();

      delete (res as any).reviews;

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: "Publication submitted.",
          },
        ],
      };
    },
  );

  server.tool(
    "download_publication_attachments",
    "Download the attachments of a publication to your computer. The attachments will be saved under the folder /home/agent/publications/`${reference}` in your computer.",
    {
      reference: z.string().describe("Reference of the publication."),
    },
    async ({ reference }) => {
      const publication = await PublicationResource.findByReference(
        experiment,
        reference,
      );
      if (!publication) {
        return errorToCallToolResult(
          err("not_found_error", "Publication not found"),
        );
      }

      const attachmentsDir = getAttachmentPath(reference);
      if (!fs.existsSync(attachmentsDir)) {
        return errorToCallToolResult(
          err("not_found_error", "Attachment files not found"),
        );
      }

      const copyRes = await Computer.copyToComputer(
        computerId(experiment, agentIndex),
        attachmentsDir,
        "publications",
      );

      if (copyRes.isErr()) {
        return errorToCallToolResult(copyRes);
      }

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `Attachment downloaded to /home/agent/publications/${reference}.`,
          },
        ],
      };
    },
  );

  server.tool(
    "list_review_requests",
    "List pending review requests received by the caller.",
    {},
    async () => {
      const publications =
        await PublicationResource.listByExperimentAndReviewRequested(
          experiment,
          agentIndex,
        );

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: renderListOfPublications(publications),
          },
        ],
      };
    },
  );

  server.tool(
    "list_submitted_publications",
    "List publications submitted by the caller.",
    {},
    async () => {
      const publications = await PublicationResource.listByAuthor(
        experiment,
        agentIndex,
      );

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: renderListOfPublications(publications),
          },
        ],
      };
    },
  );

  server.tool(
    "submit_review",
    "Submit a review for a publication.",
    {
      publication: z
        .string()
        .describe("The reference of the publication to review."),
      grade: z
        .enum(["ACCEPT", "REJECT"])
        .describe("Grade for the publication."),
      content: z.string().describe("Content of the review."),
    },
    async ({ publication: reference, grade, content }) => {
      const publication = await PublicationResource.findByReference(
        experiment,
        reference,
      );
      if (!publication) {
        return errorToCallToolResult(
          err("not_found_error", "Publication not found"),
        );
      }

      const publicationContent = getPublicationContent(reference);
      if (!publicationContent) {
        return errorToCallToolResult(
          err("not_found_error", "Publication content not found"),
        );
      }

      const review = await publication.submitReview(agentIndex, {
        grade,
        content,
      });

      if (review.isErr()) {
        return errorToCallToolResult(review);
      }

      await publication.maybePublishOrReject();

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `Review submitted for publication [${reference}].`,
          },
        ],
      };
    },
  );

  server.tool(
    "vote_solution",
    "Report belief that a publication is the current best/valid solution towards the research goal.",
    {
      publication: z
        .string()
        .describe("The reference of the publication."),
    },
    async ({ publication: reference }) => {
      const publication = await PublicationResource.findByReference(
        experiment,
        reference,
      );

      if (!publication) {
        return errorToCallToolResult(
          err("not_found_error", "Publication not found"),
        );
      }
      if (publication.toJSON().status !== "PUBLISHED") {
        return errorToCallToolResult(
          err("invalid_parameters_error", "Publication is not published"),
        );
      }

      const voteResult = await SolutionResource.vote(
        experiment.toJSON().id,
        agentIndex,
        publication.toJSON().id,
      );

      if (voteResult.isErr()) {
        return errorToCallToolResult(voteResult);
      }

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `Successfully reported.`,
          },
        ],
      };
    },
  );

  return server;
}
