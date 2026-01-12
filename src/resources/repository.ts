import { db } from "@app/db";
import { repositories } from "@app/db/schema";
import { err, ok, Result } from "@app/lib/error";
import { eq, InferSelectModel, InferInsertModel } from "drizzle-orm";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

type Repository = InferSelectModel<typeof repositories>;

export class RepositoryResource {
  private data: Repository;

  private constructor(data: Repository) {
    this.data = data;
  }

  static async findByExperiment(
    experimentId: number,
  ): Promise<Result<RepositoryResource>> {
    const result = await db
      .select()
      .from(repositories)
      .where(eq(repositories.experiment, experimentId))
      .limit(1);

    return result[0]
      ? ok(new RepositoryResource(result[0]))
      : err(
          "not_found_error",
          `Repository for experiment ${experimentId} not found.`,
        );
  }

  static async findById(id: number): Promise<RepositoryResource | null> {
    const result = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, id))
      .limit(1);

    return result[0] ? new RepositoryResource(result[0]) : null;
  }

  static async create(
    data: Omit<InferInsertModel<typeof repositories>, "id" | "created" | "updated">,
  ): Promise<RepositoryResource> {
    const [created] = await db.insert(repositories).values(data).returning();
    return new RepositoryResource(created);
  }

  /**
   * Clone a repository from a remote URL
   */
  static async clone(
    experimentId: number,
    remoteUrl: string,
    basePath: string,
  ): Promise<Result<RepositoryResource>> {
    const repoPath = path.join(basePath, `repo-${experimentId}`);

    try {
      // Clone the repository
      await execAsync(`git clone "${remoteUrl}" "${repoPath}"`);

      // Get the main branch name
      const { stdout } = await execAsync(
        `git -C "${repoPath}" rev-parse --abbrev-ref HEAD`,
      );
      const mainBranch = stdout.trim();

      // Create repository record
      const repo = await RepositoryResource.create({
        experiment: experimentId,
        path: repoPath,
        remote_url: remoteUrl,
        main_branch: mainBranch,
      });

      return ok(repo);
    } catch (error) {
      return err(
        "computer_run_error",
        `Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async update(
    data: Partial<Omit<InferInsertModel<typeof repositories>, "id" | "created">>,
  ): Promise<RepositoryResource> {
    const [updated] = await db
      .update(repositories)
      .set({ ...data, updated: new Date() })
      .where(eq(repositories.id, this.data.id))
      .returning();

    this.data = updated;
    return this;
  }

  async delete(): Promise<void> {
    await db.delete(repositories).where(eq(repositories.id, this.data.id));
  }

  toJSON() {
    return this.data;
  }

  get id() {
    return this.data.id;
  }

  get path() {
    return this.data.path;
  }

  get remoteUrl() {
    return this.data.remote_url;
  }

  get mainBranch() {
    return this.data.main_branch;
  }
}
