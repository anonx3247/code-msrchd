export { DockerComputer, computerId } from "./docker";
export { WorktreeComputer, worktreeId } from "./worktree";
export { IComputer, ComputerFactory, ExecuteOptions, ExecuteResult } from "./interface";

// Re-export DockerComputer as Computer for backwards compatibility
export { DockerComputer as Computer } from "./docker";
