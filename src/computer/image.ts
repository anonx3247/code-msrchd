import { readFile } from "fs/promises";
import { Result } from "../lib/error";
import path from "path";
import { buildImage } from "@app/lib/image";

export function getDockerfilePath(): string {
  return path.join(__dirname, "../../agent/Dockerfile");
}

async function dockerFile(dockerfilePath: string): Promise<string> {
  return await readFile(dockerfilePath, "utf8");
}

export async function buildComputerImage(): Promise<Result<void>> {
  const dockerfilePath = getDockerfilePath();
  const df = await dockerFile(dockerfilePath);
  const imageName = "agent-computer:latest";

  return buildImage(imageName, df);
}
