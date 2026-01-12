import { JSONSchema7 } from "json-schema";
import {
  LLM,
  Message,
  TextContent,
  Thinking,
  Tool,
  ToolResult,
  ToolUse,
} from "@app/models";
import { ExperimentResource } from "@app/resources/experiment";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { withRetries, Result, err, ok } from "@app/lib/error";
import { MessageResource } from "@app/resources/messages";
import assert from "assert";
import { PublicationResource } from "@app/resources/publication";
import { renderListOfPublications } from "@app/tools/publications";
import { createClientServerPair, errorToCallToolResult } from "@app/lib/mcp";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { concurrentExecutor } from "@app/lib/async";
import { assertNever } from "@app/lib/assert";
import { createComputerServer, createPublicationsServer } from "@app/tools";
import { RunConfig } from "./config";
import { createLLM } from "@app/models/provider";
import { readFileSync } from "fs";
import { join } from "path";

function loadPromptForProfile(profile: string): string {
  const promptPath = join(__dirname, "../../profiles", profile, "prompt.md");
  return readFileSync(promptPath, "utf-8");
}

export class Runner {
  private experiment: ExperimentResource;
  private agentIndex: number;
  private mcpClients: Client[];
  private model: LLM;

  private contextPruning: {
    lastAgentLoopStartIdx: number;
    lastAgentLoopInnerStartIdx: number;
  };
  private messages: MessageResource[]; // ordered by position asc

  private constructor(
    experiment: ExperimentResource,
    agentIndex: number,
    mcpClients: Client[],
    model: LLM,
  ) {
    this.experiment = experiment;
    this.agentIndex = agentIndex;
    this.mcpClients = mcpClients;
    this.model = model;

    this.messages = [];
    this.contextPruning = {
      lastAgentLoopStartIdx: 0,
      lastAgentLoopInnerStartIdx: 0,
    };
  }

  public static async builder(
    experiment: ExperimentResource,
    agentIndex: number,
    config: RunConfig,
  ): Promise<Result<Runner>> {
    const servers = await Promise.all([
      createComputerServer(experiment, agentIndex),
      createPublicationsServer(experiment, agentIndex, config),
    ]);
    const clients = await Promise.all(
      servers.map(async (s) => {
        const [client] = await createClientServerPair(s);
        return client;
      }),
    );

    const model = createLLM(experiment.toJSON().model, {
      thinking: config.thinking,
    });

    const runner = await Runner.initialize(
      experiment,
      agentIndex,
      clients,
      model,
    );
    if (runner.isErr()) {
      return runner;
    }

    return ok(runner.value);
  }

  public static async initialize(
    experiment: ExperimentResource,
    agentIndex: number,
    mcpClients: Client[],
    model: LLM,
  ): Promise<Result<Runner>> {
    const runner = new Runner(
      experiment,
      agentIndex,
      mcpClients,
      model,
    );

    const messages = await MessageResource.listMessagesByAgent(
      runner.experiment,
      runner.agentIndex,
    );

    runner.messages = messages;

    return ok(runner);
  }

  async tools(): Promise<Result<Tool[]>> {
    const tools: Tool[] = [];

    for (const client of this.mcpClients) {
      try {
        const ct = await client.listTools();
        for (const tool of ct.tools) {
          tools.push({
            name: `${client.getServerVersion()?.name}-${tool.name}`,
            description: tool.description,
            inputSchema: tool.inputSchema as JSONSchema7,
          });
        }
      } catch (error) {
        return err(
          "tool_error",
          `Error listing tools from client ${client.getServerVersion()?.name}`,
          error,
        );
      }
    }

    return ok(tools);
  }

  async executeTool(t: ToolUse): Promise<ToolResult> {
    for (const client of this.mcpClients) {
      try {
        const ct = await client.listTools();
        for (const tool of ct.tools) {
          if (`${client.getServerVersion()?.name}-${tool.name}` === t.name) {
            const result = await client.callTool({
              name: tool.name,
              arguments: t.input,
            });

            const toolResult: ToolResult = {
              type: "tool_result",
              toolUseId: t.id,
              toolUseName: t.name,
              content: result.content as CallToolResult["content"],
              isError: (result.isError ?? false) as boolean,
            };
            return toolResult;
          }
        }
      } catch (error) {
        return {
          type: "tool_result",
          toolUseId: t.id,
          toolUseName: t.name,
          content: errorToCallToolResult(
            err(
              "tool_execution_error",
              `Error executing tool ${t.name}`,
              error,
            ),
          ).content,
          isError: true,
        };
      }
    }

    return {
      type: "tool_result",
      toolUseId: t.id,
      toolUseName: t.name,
      content: errorToCallToolResult(
        err(
          "tool_execution_error",
          `No MCP client found to execute tool ${t.name}`,
        ),
      ).content,
      isError: true,
    };
  }

  isNewUserMessageNeeded(): boolean {
    if (this.messages.length === 0) {
      return true;
    }

    // If the role is agent it means we had no tool use in the last tick and we need a user message.
    const last = this.messages[this.messages.length - 1];
    if (last.toJSON().role === "agent") {
      return true;
    }

    return false;
  }

  async newUserMessage(): Promise<Result<MessageResource>> {
    const position =
      this.messages.length > 0
        ? this.messages[this.messages.length - 1].position() + 1
        : 0;

    const reviews =
      await PublicationResource.listByExperimentAndReviewRequested(
        this.experiment,
        this.agentIndex,
      );

    const publications = await PublicationResource.listByAuthor(
      this.experiment,
      this.agentIndex,
    );

    const m: Message = {
      role: "user",
      content: [
        {
          type: "text",
          text: `\
SUBMITTED_PUBLICATIONS:
${renderListOfPublications(publications)}

PENDING_REVIEWS (to prioritize):
${renderListOfPublications(reviews)}

<system>
This is an automated system message and there is no user available to respond. Proceed autonomously, making sure to use tools as only tools have visible effects on the system. Never stay idle and always pro-actively work on furthering your research (even if your publications are under review or accepted as current best solutions). Never consider your research effort as complete.
<system>
`,
          provider: null,
        },
      ],
    };

    const message = await MessageResource.create(
      this.experiment,
      this.agentIndex,
      m,
      position,
      0, // User messages have no token usage
      0, // User messages have no cost
    );

    return ok(message);
  }

  private isAgentLoopStartMessage(message: Message): boolean {
    // A user message with only text content marks the start of an agentic loop.
    return (
      message.role === "user" && message.content.every((c) => c.type === "text")
    );
  }

  private isAgentLoopInnerStartMessage(m: Message): boolean {
    // We prune at tool_uses because it ensures the conversation is valid (since any following
    // tool_result is guaranteed to have its corresponding tool_use before it).
    return m.role === "agent" && m.content.some((c) => c.type === "tool_use");
  }

  shiftContextPruning(): Result<void> {
    /**
     * We bump lastAgentLoopInnerStartIdx whilst ensuring that the conversation is valid. This is
     * done by pruning messages before a tool_use (since any following tool_result is guaranteed to
     * have its corresponding tool_use before it).
     */
    assert(
      this.contextPruning.lastAgentLoopInnerStartIdx < this.messages.length,
      "lastLoopInnerStartIdx is out of bounds.",
    );

    let idx =
      this.contextPruning.lastAgentLoopInnerStartIdx >
        this.contextPruning.lastAgentLoopStartIdx
        ? this.contextPruning.lastAgentLoopInnerStartIdx + 1
        : /* This avoids an unneeded iteration, without this, if they were equal, the result of the
           * iteration would have been: lastAgentLoopInnerStartIdx === lastAgentLoopStartIdx + 1.
           * Which results in no change to `messages` since:
           * forall idx, messages.slice(idx) === [messages[idx], ...messages.slice(idx+1)] */
        this.contextPruning.lastAgentLoopInnerStartIdx + 2;
    let foundNewAgenticLoop = false;

    for (; idx < this.messages.length; idx++) {
      const m = this.messages[idx].toJSON();
      if (this.isAgentLoopInnerStartMessage(m)) {
        break;
      }
      if (this.isAgentLoopStartMessage(m)) {
        foundNewAgenticLoop = true;
        break;
      }
    }

    if (idx >= this.messages.length) {
      return err(
        "agent_loop_overflow_error",
        "No agentic loop start position found after last.",
      );
    }

    if (foundNewAgenticLoop) {
      this.contextPruning.lastAgentLoopStartIdx = idx;
    }
    this.contextPruning.lastAgentLoopInnerStartIdx = idx;

    return ok(undefined);
  }

  /**
   * Render past agent messages to the model handling truncation to fit the model context window as
   * needed.
   *
   * @param systemPrompt System prompt to use for the model call.
   * @param tools Tools to provide to the model.
   */
  async renderForModel(
    systemPrompt: string,
    tools: Tool[],
  ): Promise<Result<Message[]>> {
    /**
     * Invariants:
     * (1) The agent loop is always started by a user message (with only text content).
     * (2) Tool Result must be preceded by a corresponding (i.e. same tool_use_id) Tool Use.
     *
     * - If lastAgentLoopInnerStartIdx === lastAgentLoopStartIdx: we have a full agent loop. And we
     * select all messages from lastAgentLoopStartIdx (messages[lastAgentLoopInnerStartIdx]
     * verifies (1)). And since the agent loop is not pruned we also automatically verify (2).
     *
     * If lastAgentLoopInnerStartIdx > lastAgentLoopStartIdx: we prune messages *in* the agent loop.
     * We select messages from lastAgentLoopInnerStartIdx (messages[lastAgentLoopInnerStartIdx]
     * verifies (2)). BUT we also need to include the user text message at the start of the agent
     * loop (at lastAgentLoopStartIdx) to ensure (1).
     */
    let tokenCount = 0;
    do {
      // Prune messages before contextPruning.lastAgentLoopInnerStartIdx.
      let messages = [...this.messages]
        .slice(this.contextPruning.lastAgentLoopInnerStartIdx)
        .map((m) => m.toJSON());

      // console.log(`Inner: ${this.contextPruning.lastAgentLoopInnerStartIdx}`);
      // console.log(`Start: ${this.contextPruning.lastAgentLoopStartIdx}`);

      if (
        this.contextPruning.lastAgentLoopInnerStartIdx >
        this.contextPruning.lastAgentLoopStartIdx
      ) {
        // A valid conversation must begin with a user message. In this case we use the
        // user message at the start of the agent loop. Ensuring (1).
        const agentLoopStartUserMessage =
          this.messages[this.contextPruning.lastAgentLoopStartIdx].toJSON();
        messages = [agentLoopStartUserMessage, ...messages];
      }

      const res = await this.model.tokens(messages, systemPrompt, tools);
      if (res.isErr()) {
        console.log("Agent: " + this.agentIndex);
        console.log(messages.length);
        messages.forEach((m) => {
          console.log(m.role);
          console.log(m.content);
          console.log("----");
        });
        return res;
      }
      tokenCount = res.value;
      // console.log("TOKEN COUNT: " + tokenCount);

      if (tokenCount > this.model.maxTokens()) {
        const res = this.shiftContextPruning();
        if (res.isErr()) {
          return res;
        }
      } else {
        return ok(messages);
      }
    } while (tokenCount > this.model.maxTokens());

    return err("agent_loop_overflow_error", "Unreachable");
  }

  /**
   * Logs message content during runner execution to display progress.
   */
  logContent(
    c: TextContent | ToolUse | ToolResult | Thinking,
    messageId?: number,
  ) {
    let out = `\x1b[1m\x1b[37mAgent ${this.agentIndex}\x1b[0m`; // name: bold white
    if (messageId) {
      out += ` \x1b[1m\x1b[33m#${messageId}\x1b[0m`; // message id: bold yellow if available
    }
    switch (c.type) {
      case "thinking": {
        out += ` \x1b[90m>\x1b[0m `; // separator: grey
        out += `\x1b[1m\x1b[95mThinking:\x1b[0m `; // label: bold magenta/purple
        out += `\x1b[90m${c.thinking.replace(/\n/g, " ")}\x1b[0m`; // text: grey
        break;
      }
      case "text": {
        out += ` \x1b[90m>\x1b[0m `; // separator: grey
        out += `\x1b[1m\x1b[38;5;208mText:\x1b[0m `; // label: bold orange (256-color)
        out += `\x1b[90m${c.text.replace(/\n/g, " ")}\x1b[0m`; // content: grey
        break;
      }
      case "tool_use": {
        out += ` \x1b[90m>\x1b[0m `; // separator: grey
        out += `\x1b[1m\x1b[32mToolUse:\x1b[0m `; // label: bold green
        out += `${c.name}`;
        break;
      }
      case "tool_result": {
        out += ` \x1b[90m<\x1b[0m `; // separator: grey
        out += `\x1b[1m\x1b[34mToolResult:\x1b[0m `; // label: bold blue
        out +=
          `${c.toolUseName} ` +
          `${c.isError
            ? "\x1b[1m\x1b[31m[error]\x1b[0m"
            : "\x1b[1m\x1b[32m[success]\x1b[0m"
          }`;
        break;
      }
      default:
        assertNever(c);
    }
    console.log(out);
  }

  /**
   * Advance runer by one tick (one agent call + associated tools executions).
   */
  async tick(): Promise<Result<void>> {
    const tools = await this.tools();
    if (tools.isErr()) {
      return tools;
    }

    if (this.isNewUserMessageNeeded()) {
      const newMessage = await this.newUserMessage();
      if (newMessage.isErr()) {
        return newMessage;
      }
      this.messages.push(newMessage.value);
    }

    const profile = this.experiment.toJSON().profile;
    const systemPrompt = loadPromptForProfile(profile).replace(
      "{{PROBLEM}}",
      this.experiment.toJSON().problem,
    );

    const messagesForModel = await this.renderForModel(
      systemPrompt,
      tools.value,
    );
    if (messagesForModel.isErr()) {
      return messagesForModel;
    }

    const res = await withRetries(async () => {
      return this.model.run(messagesForModel.value, systemPrompt, tools.value);
    })({});
    if (res.isErr()) {
      return res;
    }

    const { message, tokenUsage } = res.value;

    if (message.content.length === 0) {
      console.log(
        `WARNING: Skipping empty agent response content for agent ${this.agentIndex}`,
      );
      return ok(undefined);
    }

    const toolResults = await concurrentExecutor(
      message.content.filter((content) => content.type === "tool_use"),
      async (t: ToolUse) => {
        return await this.executeTool(t);
      },
      { concurrency: 8 },
    );

    const last = this.messages[this.messages.length - 1];

    // Calculate cost and tokens for this message
    const totalTokens = tokenUsage?.total ?? 0;
    const cost = tokenUsage ? this.model.cost([tokenUsage]) : 0;

    const agentMessage = await MessageResource.create(
      this.experiment,
      this.agentIndex,
      message,
      last.position() + 1,
      totalTokens,
      cost,
    );
    this.messages.push(agentMessage);

    message.content.forEach((c) => {
      this.logContent(c, agentMessage.toJSON().id);
    });

    if (toolResults.length > 0) {
      const toolResultsMessage = await MessageResource.create(
        this.experiment,
        this.agentIndex,
        {
          role: "user",
          content: toolResults,
        },
        last.position() + 2,
        0, // Tool results have no token usage
        0, // Tool results have no cost
      );
      this.messages.push(toolResultsMessage);

      toolResults.forEach((tr) => {
        this.logContent(tr, toolResultsMessage.toJSON().id);
        if (tr.isError) {
          console.error(tr.content);
        }
      });
    }

    return ok(undefined);
  }
}
