import { Result, err, ok } from "@app/lib/error";
import { ExperimentResource } from "@app/resources/experiment";
import { IComputer, ExecuteOptions, ExecuteResult } from "./interface";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

export function worktreeId(experiment: ExperimentResource, agentIndex: number) {
  return `${experiment.toJSON().name}-agent-${agentIndex}`;
}

export class WorktreeComputer implements IComputer {
  private id: string;
  private worktreePath: string;
  private repositoryPath: string;

  private constructor(
    id: string,
    worktreePath: string,
    repositoryPath: string,
  ) {
    this.id = id;
    this.worktreePath = worktreePath;
    this.repositoryPath = repositoryPath;
  }

  static async create(
    experiment: ExperimentResource,
    agentIndex: number,
  ): Promise<Result<WorktreeComputer>> {
    const expData = experiment.toJSON();
    const id = worktreeId(experiment, agentIndex);

    if (!expData.repository_path) {
      return err(
        "computer_run_error",
        "Repository path not set for experiment. Clone a repository first.",
      );
    }

    const repositoryPath = expData.repository_path;
    const worktreePath = path.join(repositoryPath, "..", `worktree-agent-${agentIndex}`);

    try {
      // Create worktree for this agent
      const branchName = `agent-${agentIndex}-main`;

      // Check if worktree already exists
      if (fs.existsSync(worktreePath)) {
        // Worktree exists, just return it
        return ok(new WorktreeComputer(id, worktreePath, repositoryPath));
      }

      // Create new worktree
      await execAsync(
        `git -C "${repositoryPath}" worktree add "${worktreePath}" -b "${branchName}"`,
      );

      return ok(new WorktreeComputer(id, worktreePath, repositoryPath));
    } catch (error: any) {
      return err(
        "computer_run_error",
        `Failed to create worktree: ${error.message}`,
        error,
      );
    }
  }

  static async findById(
    worktreeId: string,
    repositoryPath: string,
  ): Promise<WorktreeComputer | null> {
    const match = worktreeId.match(/^(.+)-agent-(\d+)$/);
    if (!match) return null;

    const agentIndex = parseInt(match[2], 10);
    const worktreePath = path.join(
      repositoryPath,
      "..",
      `worktree-agent-${agentIndex}`,
    );

    if (fs.existsSync(worktreePath)) {
      return new WorktreeComputer(worktreeId, worktreePath, repositoryPath);
    }

    return null;
  }

  async status(): Promise<string> {
    try {
      if (fs.existsSync(this.worktreePath)) {
        return "running";
      }
      return "NotFound";
    } catch {
      return "NotFound";
    }
  }

  async stop(): Promise<Result<boolean>> {
    try {
      // For worktrees, "stopping" means removing the worktree
      if (fs.existsSync(this.worktreePath)) {
        await execAsync(
          `git -C "${this.repositoryPath}" worktree remove "${this.worktreePath}" --force`,
        );
      }
      return ok(true);
    } catch (error: any) {
      return err(
        "computer_run_error",
        `Failed to remove worktree: ${error.message}`,
        error,
      );
    }
  }

  async terminate(): Promise<Result<boolean>> {
    // For worktrees, terminate is the same as stop
    return this.stop();
  }

  async execute(
    cmd: string,
    options?: ExecuteOptions,
  ): Promise<Result<ExecuteResult>> {
    const timeoutMs = options?.timeoutMs ?? 120000;
    const cwd = options?.cwd
      ? path.join(this.worktreePath, options.cwd)
      : this.worktreePath;

    try {
      // Build environment
      const env = {
        ...process.env,
        GIT_WORKTREE_PATH: this.worktreePath,
        HOME: this.worktreePath,
        ...(options?.env ?? {}),
      };

      const startTs = Date.now();
      const { stdout, stderr } = await execAsync(cmd, {
        cwd,
        env,
        timeout: timeoutMs,
        maxBuffer: 8196 * 1024, // 8MB buffer
      });

      return ok({
        exitCode: 0,
        stdout,
        stderr,
        durationMs: Date.now() - startTs,
      });
    } catch (error: any) {
      const exitCode = error.code ?? 127;
      const stdout = error.stdout ?? "";
      const stderr = error.stderr ?? error.message ?? "";

      if (error.killed || error.signal === "SIGTERM") {
        return err(
          "computer_run_error",
          `Command execution timed out: ${stderr}`,
          error,
        );
      }

      // Non-zero exit code is not an error in our case, just return the result
      return ok({
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - Date.now(),
      });
    }
  }

  get path() {
    return this.worktreePath;
  }
}
