import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ExperimentResource } from "@app/resources/experiment";
import { StatusUpdateResource } from "@app/resources/status_update";
import { RunConfig } from "@app/runner/config";
import { db } from "@app/db";
import { user_questions } from "@app/db/schema";
import { eq, and } from "drizzle-orm";

const SERVER_NAME = "user";
const SERVER_VERSION = "0.1.0";

export async function createUserServer(
  experiment: ExperimentResource,
  agentIndex: number,
  _config: RunConfig,
): Promise<McpServer> {
  const server = new McpServer({
    name: SERVER_NAME,
    title: "User Interaction: Tools to communicate with the user.",
    version: SERVER_VERSION,
  });

  server.tool(
    "ask_user_question",
    "Ask the user a question and wait for their response. This blocks execution until the user answers.",
    {
      question: z.string().describe("The question to ask the user"),
      timeout_seconds: z
        .number()
        .optional()
        .describe("Timeout in seconds (default: 300 = 5 minutes)"),
    },
    async ({ question, timeout_seconds = 300 }) => {
      const expData = experiment.toJSON();

      // Store question in database
      const [questionRecord] = await db
        .insert(user_questions)
        .values({
          experiment: expData.id,
          agent: agentIndex,
          question,
          status: "pending",
        })
        .returning();

      console.log(`\n\x1b[1m\x1b[36m[USER QUESTION]\x1b[0m Agent ${agentIndex} asks:`);
      console.log(`\x1b[36m${question}\x1b[0m`);
      console.log(`\x1b[90m(Question ID: ${questionRecord.id})\x1b[0m`);
      console.log(`\x1b[90mWaiting for answer... (timeout: ${timeout_seconds}s)\x1b[0m`);
      console.log(`\x1b[90mAnswer at: http://localhost:3000/experiments/${expData.name}/status\x1b[0m\n`);

      // Poll for answer with timeout
      const startTime = Date.now();
      const pollInterval = 1000; // 1 second
      const timeoutMs = timeout_seconds * 1000;

      while (Date.now() - startTime < timeoutMs) {
        const [updated] = await db
          .select()
          .from(user_questions)
          .where(eq(user_questions.id, questionRecord.id))
          .limit(1);

        if (updated && updated.answer) {
          // Got an answer!
          await db
            .update(user_questions)
            .set({
              status: "answered",
              answered: new Date(),
            })
            .where(eq(user_questions.id, questionRecord.id));

          return {
            isError: false,
            content: [
              {
                type: "text",
                text: `User answered: ${updated.answer}`,
              },
            ],
          };
        }

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      // Timeout
      await db
        .update(user_questions)
        .set({ status: "timeout" })
        .where(eq(user_questions.id, questionRecord.id));

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `[Timeout] User did not answer within ${timeout_seconds} seconds. Proceeding without answer.`,
          },
        ],
      };
    },
  );

  server.tool(
    "get_problem_description",
    "Get the original problem description for this experiment.",
    {},
    async () => {
      const expData = experiment.toJSON();
      return {
        isError: false,
        content: [
          {
            type: "text",
            text: expData.problem,
          },
        ],
      };
    },
  );

  server.tool(
    "publish_status_update",
    "Publish a status update that the user can see (non-blocking).",
    {
      type: z
        .enum(["todo_list", "progress", "question"])
        .describe("Type of status update"),
      content: z.string().describe("Content of the update (markdown supported)"),
    },
    async ({ type, content }) => {
      const expData = experiment.toJSON();

      // Save status update to database
      await StatusUpdateResource.create({
        experiment: expData.id,
        agent: agentIndex,
        type,
        content,
      });

      // Log to console for immediate visibility
      const typeLabel = type === "todo_list" ? "TODO" : type === "progress" ? "PROGRESS" : "STATUS";
      console.log(`\n\x1b[1m\x1b[35m[${typeLabel}]\x1b[0m Agent ${agentIndex}:`);
      console.log(`\x1b[35m${content}\x1b[0m\n`);

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `Status update published (${type})`,
          },
        ],
      };
    },
  );

  return server;
}
