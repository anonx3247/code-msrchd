import { readFile } from "fs/promises";
import { Result } from "../lib/error";
import path from "path";
import { buildImage } from "@app/lib/image";

export function getDockerfilePathForProfile(profile: string): string {
  return path.join(__dirname, "../../profiles", profile, "Dockerfile");
}

async function dockerFile(dockerfilePath: string): Promise<string> {
  return await readFile(dockerfilePath, "utf8");
}

export async function buildComputerImage(
  profile: string,
): Promise<Result<void>> {
  const dockerfilePath = getDockerfilePathForProfile(profile);
  const df = await dockerFile(dockerfilePath);
  const imageName = `agent-computer:${profile}`;

  return buildImage(imageName, df);
}
