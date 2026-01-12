import { Result } from "@app/lib/error";
import { ExperimentResource } from "@app/resources/experiment";

export interface ExecuteOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface IComputer {
  execute(cmd: string, options?: ExecuteOptions): Promise<Result<ExecuteResult>>;
  status(): Promise<string>;
  stop(): Promise<Result<boolean>>;
  terminate(): Promise<Result<boolean>>;
}

export class ComputerFactory {
  static async create(
    experiment: ExperimentResource,
    agentIndex: number,
  ): Promise<Result<IComputer>> {
    const expData = experiment.toJSON();
    const mode = expData.sandbox_mode || "docker";

    if (mode === "docker") {
      const { DockerComputer } = await import("./docker");
      return DockerComputer.create(experiment, agentIndex);
    } else {
      const { WorktreeComputer } = await import("./worktree");
      return WorktreeComputer.create(experiment, agentIndex);
    }
  }
}
