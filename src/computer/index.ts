import Docker, { Container } from "dockerode";
import { Writable } from "stream";
import { Result, err, ok } from "@app/lib/error";
import { ExperimentResource } from "@app/resources/experiment";
import tar from "tar-stream";
import fs from "fs";
import path from "path";
import { addDirectoryToTar } from "@app/lib/image";

const docker = new Docker();
const DEFAULT_COMPUTER_IMAGE = "agent-computer:research";
const VOLUME_PREFIX = "srchd_computer_";
const NAME_PREFIX = "srchd-computer-";
const DEFAULT_WORKDIR = "/home/agent";

function containerName(id: string) {
  return `${NAME_PREFIX}${id}`;
}

function volumeName(id: string) {
  return `${VOLUME_PREFIX}${id}`;
}

export function computerId(
  experiment: ExperimentResource,
  agentIndex: number,
) {
  return `${experiment.toJSON().name}-agent-${agentIndex}`;
}

async function ensureImage(image: string): Promise<Result<void>> {
  try {
    await docker.getImage(image).inspect();
    return ok(undefined);
  } catch {
    return err("image_error", `Docker image not found: ${image}`);
  }
}

async function ensureVolume(name: string): Promise<Result<void>> {
  try {
    await docker.getVolume(name).inspect();
  } catch {
    await docker.createVolume({ Name: name });
  }
  return ok(undefined);
}

export class Computer {
  private id: string;
  private container: Container;

  private constructor(id: string, container: Container) {
    this.id = id;
    this.container = container;
  }

  static async create(
    computerId: string,
    imageName?: string,
  ): Promise<Result<Computer>> {
    try {
      const name = containerName(computerId);
      const volume = volumeName(computerId);
      const image = imageName ?? DEFAULT_COMPUTER_IMAGE;

      const imageRes = await ensureImage(image);
      if (imageRes.isErr()) {
        return imageRes;
      }

      const volumeRes = await ensureVolume(volume);
      if (volumeRes.isErr()) {
        return volumeRes;
      }

      const container = await docker.createContainer({
        name,
        Image: image,
        WorkingDir: DEFAULT_WORKDIR,
        Tty: true,
        User: "agent:agent",
        HostConfig: {
          Binds: [`${volume}:${DEFAULT_WORKDIR}:rw`],
          Memory: 512 * 1024 * 1024, // 512MB limit
          MemorySwap: 1024 * 1024 * 1024, // Swap limit
          NanoCpus: 1e9, // 1 vCPU limit
          CpuShares: 512,
          PidsLimit: 4096,
          Ulimits: [
            { Name: "nproc", Soft: 65535, Hard: 65535 },
            { Name: "nofile", Soft: 1048576, Hard: 1048576 },
          ],
          CapAdd: [],
          CapDrop: [],
          SecurityOpt: [],
          Privileged: false,
          UsernsMode: "1000:100000:65536",
          NetworkMode: "bridge",
          IpcMode: "",
          PidMode: "",
          Tmpfs: {
            "/tmp": "rw,noexec,nosuid,size=100m",
            "/var/tmp": "rw,noexec,nosuid,size=100m",
          },
        },
        Cmd: ["/bin/bash", "-c", "tail -f /dev/null"],
      });

      await container.start();
      await container.inspect();

      return ok(new Computer(computerId, container));
    } catch (error: any) {
      return err(
        "computer_run_error",
        `Failed to create computer: ${error.message}`,
        error,
      );
    }
  }

  static async findById(computerId: string): Promise<Computer | null> {
    const name = containerName(computerId);
    try {
      const container = docker.getContainer(name);
      await container.inspect();
      return new Computer(computerId, container);
    } catch (_err) {
      return null;
    }
  }

  static async ensure(
    computerId: string,
    imageName?: string,
  ): Promise<Result<Computer>> {
    const expectedImage = imageName ?? DEFAULT_COMPUTER_IMAGE;
    const c = await Computer.findById(computerId);
    if (c) {
      const status = await c.status();
      const currentImage = await c.getImage();

      // Recreate container if not running or using wrong image
      if (status !== "running" || currentImage !== expectedImage) {
        await c.terminate();
        return Computer.create(computerId, imageName);
      }
      return ok(c);
    }
    return Computer.create(computerId, imageName);
  }

  static async listComputerIds(): Promise<Result<string[]>> {
    try {
      const list = await docker.listContainers({
        all: true,
        filters: { name: [NAME_PREFIX] },
      });
      const computerIds = list
        .map((c) => c.Names?.[0]?.slice(NAME_PREFIX.length + 1))
        .filter((id): id is string => !!id);
      return ok(computerIds);
    } catch (error: any) {
      return err("computer_run_error", "Failed to list computers", error);
    }
  }

  static async stopByExperiment(
    experimentName: string,
  ): Promise<Result<number>> {
    const prefix = `${experimentName}-agent-`;
    const listRes = await Computer.listComputerIds();
    if (listRes.isErr()) {
      return listRes;
    }

    const matchingIds = listRes.value.filter((id) => id.startsWith(prefix));
    let stopped = 0;

    for (const id of matchingIds) {
      const computer = await Computer.findById(id);
      if (computer) {
        const res = await computer.stop();
        if (res.isOk()) {
          stopped++;
        }
      }
    }

    return ok(stopped);
  }

  static async terminateByExperiment(
    experimentName: string,
  ): Promise<Result<number>> {
    const prefix = `${experimentName}-agent-`;
    const listRes = await Computer.listComputerIds();
    if (listRes.isErr()) {
      return listRes;
    }

    const matchingIds = listRes.value.filter((id) => id.startsWith(prefix));
    let terminated = 0;

    for (const id of matchingIds) {
      const computer = await Computer.findById(id);
      if (computer) {
        const res = await computer.terminate();
        if (res.isOk()) {
          terminated++;
        }
      }
    }

    return ok(terminated);
  }

  static async copyToComputer(
    computerId: string,
    localPath: string,
    destinationDir?: string,
  ): Promise<Result<void>> {
    const computer = await Computer.findById(computerId);
    if (!computer) {
      return err("computer_run_error", `Computer ${computerId} not found`);
    }

    if (!fs.existsSync(localPath)) {
      return err("reading_file_error", `Path ${localPath} does not exist`);
    }

    const stat = fs.statSync(localPath);
    const name = path.basename(localPath);

    const pack = tar.pack();
    if (stat.isFile()) {
      const content = fs.readFileSync(localPath);
      pack.entry({ name }, content);
    } else if (stat.isDirectory()) {
      await addDirectoryToTar(pack, localPath, name);
    } else {
      return err(
        "reading_file_error",
        `Path ${localPath} is neither a file nor a directory`,
      );
    }
    pack.finalize();

    const destinationPath = destinationDir
      ? `${DEFAULT_WORKDIR}/${destinationDir}`
      : DEFAULT_WORKDIR;

    // Ensure destination directory exists before copying
    if (destinationDir) {
      const mkdirRes = await computer.execute(`mkdir -p "${destinationPath}"`);
      if (mkdirRes.isErr()) {
        return err(
          "copy_file_error",
          `Failed to create destination directory: ${mkdirRes.error.message}`,
          mkdirRes.error.cause,
        );
      }
    }

    try {
      await computer.container.putArchive(pack, { path: destinationPath });
      return ok(undefined);
    } catch (error: any) {
      return err(
        "copy_file_error",
        `Failed to copy to computer: ${error.message}`,
        error,
      );
    }
  }

  static async copyFromComputer(
    computerId: string,
    remotePath: string,
    localPath: string,
  ): Promise<Result<void>> {
    const computer = await Computer.findById(computerId);
    if (!computer) {
      return err("computer_run_error", `Computer ${computerId} not found`);
    }

    try {
      const stream = await computer.container.getArchive({
        path: remotePath,
      });

      const extract = tar.extract();
      const remoteName = path.basename(remotePath);

      return new Promise((resolve) => {
        let found = false;

        extract.on("entry", (header, entryStream, next) => {
          if (header.name === remoteName || header.name === `./${remoteName}`) {
            found = true;
            const writeStream = fs.createWriteStream(localPath);
            entryStream.pipe(writeStream);
            entryStream.on("end", () => {
              next();
              resolve(ok(undefined));
            });
            entryStream.on("error", (error) => {
              resolve(
                err(
                  "copy_file_error",
                  `Failed to copy from computer: ${error.message}`,
                  error,
                ),
              );
            });
          } else {
            entryStream.resume();
            next();
          }
        });

        extract.on("finish", () => {
          if (!found) {
            resolve(
              err("not_found_error", `File ${remotePath} not found in computer`),
            );
          }
        });

        extract.on("error", (error) => {
          resolve(
            err(
              "copy_file_error",
              `Failed to extract archive: ${error.message}`,
              error,
            ),
          );
        });

        stream.pipe(extract);
      });
    } catch (error: any) {
      return err(
        "copy_file_error",
        `Failed to copy from computer: ${error.message}`,
        error,
      );
    }
  }

  async status(): Promise<string> {
    try {
      const inspect = await this.container.inspect();
      return inspect.State.Status;
    } catch (_err) {
      return "NotFound";
    }
  }

  async getImage(): Promise<string | null> {
    try {
      const inspect = await this.container.inspect();
      return inspect.Config.Image;
    } catch (_err) {
      return null;
    }
  }

  async stop(): Promise<Result<boolean>> {
    try {
      try {
        await this.container.stop({ t: 5 });
      } catch (_err) {
        // ignore if already stopped
      }
      await this.container.remove({ v: false, force: true });
      return ok(true);
    } catch (error: any) {
      return err(
        "computer_run_error",
        `Failed to stop computer: ${error.message}`,
        error,
      );
    }
  }

  async terminate(): Promise<Result<boolean>> {
    const volume = volumeName(this.id);

    try {
      try {
        await this.container.stop({ t: 5 });
      } catch (_err) {
        // ignore if already stopped
      }
      await this.container.remove({ v: false, force: true });
      try {
        await docker.getVolume(volume).remove();
      } catch (_err) {
        // ignore if volume doesn't exist
      }
      return ok(true);
    } catch (error: any) {
      return err(
        "computer_run_error",
        `Failed to terminate computer: ${error.message}`,
        error,
      );
    }
  }

  async execute(
    cmd: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<
    Result<{
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
    }>
  > {
    const timeoutMs = options?.timeoutMs ?? 120000;
    const cwd = options?.cwd ?? DEFAULT_WORKDIR;

    try {
      // Build the command with environment variables and working directory
      let fullCmd = "";
      if (options?.env) {
        const envVars = Object.entries(options.env)
          .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
          .join("; ");
        fullCmd += envVars + "; ";
      }
      fullCmd += `cd "${cwd.replace(/"/g, '\\"')}" && ${cmd}`;

      const exec = await this.container.exec({
        Cmd: ["/bin/bash", "-lc", fullCmd],
        AttachStdout: true,
        AttachStderr: true,
        User: "agent:agent",
      });

      const startTs = Date.now();
      const stream = await exec.start({ hijack: true, stdin: false });

      let stdout = "";
      let stderr = "";

      try {
        const streamPromise = new Promise<void>((resolve, reject) => {
          if (
            this.container.modem &&
            typeof this.container.modem.demuxStream === "function"
          ) {
            const outChunks: Buffer[] = [];
            const errChunks: Buffer[] = [];

            const outStream = new Writable({
              write(chunk, _encoding, callback) {
                outChunks.push(Buffer.from(chunk));
                callback();
              },
            });

            const errStream = new Writable({
              write(chunk, _encoding, callback) {
                errChunks.push(Buffer.from(chunk));
                callback();
              },
            });

            this.container.modem.demuxStream(stream, outStream, errStream);

            stream.on("end", () => {
              stdout = Buffer.concat(outChunks).toString("utf-8");
              stderr = Buffer.concat(errChunks).toString("utf-8");
              resolve();
            });

            stream.on("error", (e: Error) => {
              reject(e);
            });
          } else {
            // Fallback for non-demuxed streams
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => {
              stdout = Buffer.concat(chunks).toString("utf-8");
              resolve();
            });
            stream.on("error", (e: Error) => {
              reject(e);
            });
          }
        });

        let timeoutHandle: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            stream.destroy();
            reject(
              new Error(
                "Command execution interrupted by timeout, the command is likely still running.",
              ),
            );
          }, timeoutMs);
        });

        try {
          await Promise.race([streamPromise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutHandle!);
        }
      } catch (error: any) {
        return err(
          "computer_run_error",
          `Command execution timed out: ${error.message}`,
          error,
        );
      }

      const inspect = await exec.inspect();
      const exitCode = inspect.ExitCode ?? 127;

      return ok({
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startTs,
      });
    } catch (error: any) {
      return err(
        "computer_run_error",
        `Failed to execute on computer: ${error.message}`,
        error,
      );
    }
  }
}
