import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ExperimentResource } from "@app/resources/experiment";
import { StatusUpdateResource } from "@app/resources/status_update";
import { RunConfig } from "@app/runner/config";

const SERVER_NAME = "user";
const SERVER_VERSION = "0.1.0";

// Simple in-memory queue for user questions
// In a production system, this would be persisted to disk/database
const userQuestionQueue: Map<string, {
  question: string;
  answer: string | null;
  timestamp: number;
}> = new Map();

export async function createUserServer(
  experiment: ExperimentResource,
  agentIndex: number,
  config: RunConfig,
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
      const questionId = `${expData.name}-agent-${agentIndex}-${Date.now()}`;

      // Add question to queue
      userQuestionQueue.set(questionId, {
        question,
        answer: null,
        timestamp: Date.now(),
      });

      console.log(`\n\x1b[1m\x1b[36m[USER QUESTION]\x1b[0m Agent ${agentIndex} asks:`);
      console.log(`\x1b[36m${question}\x1b[0m`);
      console.log(`\x1b[90m(Question ID: ${questionId})\x1b[0m`);
      console.log(`\x1b[90mWaiting for answer... (timeout: ${timeout_seconds}s)\x1b[0m\n`);

      // Poll for answer with timeout
      const startTime = Date.now();
      const pollInterval = 1000; // 1 second
      const timeoutMs = timeout_seconds * 1000;

      while (Date.now() - startTime < timeoutMs) {
        const entry = userQuestionQueue.get(questionId);
        if (entry && entry.answer !== null) {
          // Got an answer!
          const answer = entry.answer;
          userQuestionQueue.delete(questionId);

          return {
            isError: false,
            content: [
              {
                type: "text",
                text: `User answered: ${answer}`,
              },
            ],
          };
        }

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      // Timeout
      userQuestionQueue.delete(questionId);
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

// Export function to answer user questions (to be called from CLI)
export function answerUserQuestion(questionId: string, answer: string): boolean {
  const entry = userQuestionQueue.get(questionId);
  if (!entry) {
    return false;
  }

  entry.answer = answer;
  userQuestionQueue.set(questionId, entry);
  return true;
}

// Export function to list pending questions (for CLI)
export function listPendingQuestions(): Array<{ id: string; question: string; timestamp: number }> {
  const pending: Array<{ id: string; question: string; timestamp: number }> = [];
  userQuestionQueue.forEach((entry, id) => {
    if (entry.answer === null) {
      pending.push({
        id,
        question: entry.question,
        timestamp: entry.timestamp,
      });
    }
  });
  return pending;
}
