#!/usr/bin/env node

import { Command } from "commander";
import { readFileContent } from "./lib/fs";
import { Err, err, SrchdError } from "./lib/error";
import { ExperimentResource } from "./resources/experiment";
import { Runner } from "./runner";
import { isArrayOf, isString, removeNulls } from "./lib/utils";
import { buildComputerImage } from "./computer/image";
import { computerId, Computer } from "./computer";
import { Model, isModel } from "./models/provider";
import { MessageResource } from "./resources/messages";
import { db } from "./db";
import {
  messages,
  reviews,
  citations,
  solutions,
  publications,
} from "./db/schema";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";

const exitWithError = (err: Err<SrchdError>) => {
  console.error(
    `\x1b[31mError [${err.error.code}] ${err.error.message}\x1b[0m`,
  );
  if (err.error.cause) {
    console.error(`\x1b[31mCause: ${err.error.cause.message}\x1b[0m`);
  }
  process.exit(1);
};

const DEFAULT_AGENT_COUNT = 0;
const DEFAULT_MODEL: Model = "claude-sonnet-4-5";

const program = new Command();

program
  .name("srchd")
  .description("Research experiment management CLI")
  .version("1.0.0");

// Create command
program
  .command("create <name>")
  .description("Create a new experiment")
  .requiredOption(
    "-p, --problem <problem_file>",
    "Problem description file path",
  )
  .option(
    "-m, --model <model>",
    "AI model to use for all agents",
    DEFAULT_MODEL,
  )
  .option(
    "-n, --agent-count <count>",
    "Number of agents in the experiment",
    DEFAULT_AGENT_COUNT.toString(),
  )
  .option(
    "--profile <profile>",
    "Profile to use (research, formal-math, security)",
    "research",
  )
  .action(async (name, options) => {
    console.log(`Creating experiment: ${name}`);

    // Read problem from file
    const problem = await readFileContent(options.problem);
    if (problem.isErr()) {
      return exitWithError(problem);
    }

    // Validate model
    if (!isModel(options.model)) {
      return exitWithError(
        err("invalid_parameters_error", `Invalid model: ${options.model}`),
      );
    }

    // Validate agent count
    const agentCount = parseInt(options.agentCount);
    if (isNaN(agentCount) || agentCount < 1) {
      return exitWithError(
        err(
          "invalid_parameters_error",
          "Agent count must be a positive integer",
        ),
      );
    }

    // Validate profile
    const validProfiles = ["research", "formal-math", "security", "arc-agi"];
    if (!validProfiles.includes(options.profile)) {
      return exitWithError(
        err(
          "invalid_parameters_error",
          `Invalid profile: ${options.profile}. Must be one of: ${validProfiles.join(", ")}`,
        ),
      );
    }

    const experiment = await ExperimentResource.create({
      name,
      problem: problem.value,
      model: options.model,
      agent_count: agentCount,
      profile: options.profile,
    });

    const e = experiment.toJSON();
    console.log(`\nExperiment created:`);
    console.log(`  Name:    ${e.name}`);
    console.log(`  Model:   ${e.model}`);
    console.log(`  Agents:  ${e.agent_count}`);
    console.log(`  Profile: ${e.profile}`);
  });

// List command
program
  .command("list")
  .description("List all experiments")
  .action(async () => {
    const experiments = await ExperimentResource.all();

    if (experiments.length === 0) {
      console.log("No experiments found.");
      return;
    }

    console.log(`\nExperiments (${experiments.length}):\n`);
    for (const exp of experiments) {
      const e = exp.toJSON();
      console.log(`  ${e.name}`);
      console.log(`    Model: ${e.model}, Agents: ${e.agent_count}, Profile: ${e.profile}`);
      console.log();
    }
  });


// Run command - runs all agents in an experiment
program
  .command("run <experiment>")
  .description("Run all agents in an experiment")
  .option("-p, --path <path...>", "Add a file or directory to the computer")
  .option(
    "-t, --tick <agent>",
    "Run one tick for a specific agent (by index)",
  )
  .option("--max-cost <cost>", "Max cost (in dollars) before stopping run")
  .option("--no-thinking", "Disable extended thinking (enabled by default)")
  .action(async (experimentName, options) => {
    // Find experiment
    const experimentRes = await ExperimentResource.findByName(experimentName);
    if (experimentRes.isErr()) {
      return exitWithError(experimentRes);
    }
    const experiment = experimentRes.value;
    const agentCount = experiment.toJSON().agent_count;

    // Calculate reviewers: 4 unless we have less than 5 agents
    const reviewers = agentCount >= 5 ? 4 : agentCount - 1;

    // Determine which agents to run
    const agentIndices: number[] = [];

    if (options.tick !== undefined) {
      // Run single tick for specific agent
      const agentIndex = parseInt(options.tick);
      if (isNaN(agentIndex) || agentIndex < 0 || agentIndex >= agentCount) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            `Invalid agent index: ${options.tick}. Must be between 0 and ${agentCount - 1}`,
          ),
        );
      }
      agentIndices.push(agentIndex);
    } else {
      // Run all agents
      for (let i = 0; i < agentCount; i++) {
        agentIndices.push(i);
      }
    }

    // Build Docker image
    const experimentData = experiment.toJSON();
    console.log(`Building Docker image for ${experimentData.profile} profile...`);
    const buildRes = await buildComputerImage(experimentData.profile);
    if (buildRes.isErr()) {
      return exitWithError(buildRes);
    }
    console.log("Docker image built successfully.");

    // Copy paths to computers if specified
    if (options.path && isArrayOf(options.path, isString)) {
      for (const agentIndex of agentIndices) {
        for (const pathStr of options.path) {
          const res = await Computer.copyToComputer(
            computerId(experiment, agentIndex),
            pathStr,
          );
          if (res.isErr()) {
            return exitWithError(res);
          }
        }
      }
    }

    // Parse max cost
    let maxCost: number | undefined;
    if (options.maxCost) {
      maxCost = parseFloat(options.maxCost);
      if (isNaN(maxCost) || maxCost < 0) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            "Max cost must be a valid number greater than 0",
          ),
        );
      }
    }

    // Build runners for all agents
    const builders = await Promise.all(
      agentIndices.map((agentIndex) =>
        Runner.builder(experiment, agentIndex, {
          reviewers,
          thinking: options.thinking,
        }),
      ),
    );
    for (const res of builders) {
      if (res.isErr()) {
        return exitWithError(res);
      }
    }
    const runners = removeNulls(
      builders.map((res) => {
        if (res.isOk()) {
          return res.value;
        }
        return null;
      }),
    );

    // Run single tick if specified
    if (options.tick !== undefined) {
      const tickResults = await Promise.all(runners.map((r) => r.tick()));
      for (const tick of tickResults) {
        if (tick.isErr()) {
          return exitWithError(tick);
        }
      }
      // Stop containers after single tick
      await Computer.stopByExperiment(experimentName);
      return;
    }

    // Check every 20 ticks except when near the max value
    const shouldCheck = (
      tickCount: number,
      lastVal: number,
      maxVal: number,
    ): boolean => (lastVal / maxVal) < 0.95 ? tickCount % 20 === 0 : true;

    let tickCount = 0;
    let lastCost = await MessageResource.totalCostForExperiment(experiment);

    // Fast shutdown - spawn background process to stop containers and exit immediately
    const fastShutdown = (reason: string) => {
      console.log(`\n\x1b[33m${reason}\x1b[0m`);
      console.log("Stopping containers in background...");

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }

      // Spawn detached process to stop containers in background
      const child = spawn(
        process.execPath,
        [
          "-e",
          `require("${__dirname}/computer").Computer.stopByExperiment("${experimentName}").then(() => process.exit(0))`,
        ],
        {
          detached: true,
          stdio: "ignore",
          cwd: process.cwd(),
          env: process.env,
        },
      );
      child.unref();

      process.exit(0);
    };

    // Set up keyboard listener for 'q' to quit
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", (key) => {
        const char = key.toString();
        if (char === "q" || char === "Q") {
          fastShutdown("Quit requested.");
        }
        // Also handle Ctrl+C
        if (char === "\x03") {
          fastShutdown("Interrupted.");
        }
      });
    }

    // Display instructions
    console.log("\x1b[36mPress 'q' to quit (containers will be stopped in background, data preserved)\x1b[0m\n");

    // For continuous running, start each agent in its own independent loop
    const runnerPromises = runners.map(async (runner) => {
      while (true) {
        if (maxCost && shouldCheck(tickCount, lastCost, maxCost)) {
          lastCost = await MessageResource.totalCostForExperiment(experiment);
          if (lastCost > maxCost) {
            console.log(`\nCost limit reached: $${lastCost.toFixed(2)}`);
            fastShutdown("Cost limit reached.");
            return;
          }
        }

        const tick = await runner.tick();
        tickCount++;
        if (tick.isErr()) {
          // eslint-disable-next-line
          throw tick;
        }
      }
    });

    // Wait for agents to finish or stop
    try {
      await Promise.all(runnerPromises);
    } catch (error) {
      fastShutdown("Error occurred.");
      return exitWithError(error as any);
    }
  });

// Clean command - delete an experiment and all its data
program
  .command("clean <experiment>")
  .description("Delete an experiment and all its data")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("-c, --containers-only", "Only delete Docker containers, keep database data")
  .action(async (experimentName, options) => {
    // Handle containers-only mode
    if (options.containersOnly) {
      if (!options.yes) {
        const readline = await import("readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(
            `Delete Docker containers for experiment '${experimentName}'? (y/N) `,
            resolve,
          );
        });
        rl.close();

        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.log("Aborted.");
          return;
        }
      }

      console.log(`Deleting Docker containers for '${experimentName}'...`);
      const terminateRes = await Computer.terminateByExperiment(experimentName);
      if (terminateRes.isErr()) {
        return exitWithError(terminateRes);
      }
      console.log(`Deleted ${terminateRes.value} container(s).`);
      return;
    }

    // Find experiment
    const experimentRes = await ExperimentResource.findByName(experimentName);
    if (experimentRes.isErr()) {
      return exitWithError(experimentRes);
    }
    const experiment = experimentRes.value;
    const expId = experiment.toJSON().id;

    // Confirm unless -y flag is passed
    if (!options.yes) {
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          `Delete experiment '${experimentName}' and all its data? (y/N) `,
          resolve,
        );
      });
      rl.close();

      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log("Aborted.");
        return;
      }
    }

    console.log(`Deleting experiment '${experimentName}'...`);

    // Delete Docker containers first
    console.log("  Deleting Docker containers...");
    const terminateRes = await Computer.terminateByExperiment(experimentName);
    if (terminateRes.isOk()) {
      console.log(`    Deleted ${terminateRes.value} container(s).`);
    }

    // Delete in order respecting foreign key constraints
    console.log("  Deleting messages...");
    db.delete(messages).where(eq(messages.experiment, expId)).run();

    console.log("  Deleting reviews...");
    db.delete(reviews).where(eq(reviews.experiment, expId)).run();

    console.log("  Deleting citations...");
    db.delete(citations).where(eq(citations.experiment, expId)).run();

    console.log("  Deleting solutions...");
    db.delete(solutions).where(eq(solutions.experiment, expId)).run();

    console.log("  Deleting publications...");
    db.delete(publications).where(eq(publications.experiment, expId)).run();

    console.log("  Deleting experiment...");
    await experiment.delete();

    console.log(`\nExperiment '${experimentName}' deleted.`);
  });

// Serve command - start web server
program
  .command("serve")
  .description("Start web server to view experiments")
  .option("-p, --port <port>", "Port to listen on", "3000")
  .option("-h, --host <host>", "Host to bind to", "localhost")
  .action(async (options) => {
    const port = parseInt(options.port);
    if (isNaN(port) || port < 1 || port > 65535) {
      return exitWithError(
        err("invalid_parameters_error", "Port must be between 1 and 65535"),
      );
    }

    const { createApp } = await import("./server");
    const app = createApp();

    console.log(`Starting web server on http://${options.host}:${port}`);
    console.log(`Press Ctrl+C to stop`);

    const { serve } = await import("@hono/node-server");
    serve({
      fetch: app.fetch,
      port,
      hostname: options.host,
    });
  });

program.parse();
