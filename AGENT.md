# Agent Development Guidelines

This document contains guidelines and best practices for AI agents working on this codebase.

## Git Workflow

### Before Pushing

**ALWAYS** run these checks before pushing:

```bash
npm run typecheck && npm run lint
```

Only push if both commands succeed with no errors.

### Force Pushing

When force-pushing is necessary (e.g., after amending commits), **ALWAYS** use `--force-with-lease` instead of `-f`:

```bash
# ✅ Correct
git push --force-with-lease

# ❌ Wrong
git push -f
```

`--force-with-lease` is safer because it will fail if someone else has pushed changes to the remote branch since your last fetch, preventing accidental overwrites.

## Development Workflow

1. Create a new branch for each feature/fix
2. Make incremental commits that compile and pass linting
3. Run `npm run typecheck && npm run lint` before each push
4. Push with `git push` (first time) or `git push --force-with-lease` (when rewriting history)
5. Create PR when ready for review

## Code Style

### Naming Conventions

- **TypeScript**: Use `camelCase` for variables, functions, and parameters
- **Database/Schema**: Use `snake_case` for table names and column names

```typescript
// ✅ Correct
const resourcesWithNulls = await fetchData();
const userId = user.id;

// ❌ Wrong
const resources_with_nulls = await fetchData();
const user_id = user.id;
```

## Error Handling in Resources

Resources follow these error handling patterns:

### Database Queries

- **Finder methods** (`findById`, `findByName`, etc.): Return `null` when not found, never throw
- **List methods** (`listByAgent`, `listByExperiment`, etc.): Silently filter out items that can't be loaded using `removeNulls()`, never throw
- **Create methods**: Take required related resources as parameters (not IDs) to ensure they exist before creation

### Example

```typescript
// ✅ Correct - finder returns null
static async findById(id: number): Promise<Resource | null> {
  const [result] = await db.select().from(table).where(eq(table.id, id));
  return result ? new Resource(result) : null;
}

// ✅ Correct - list filters nulls
static async listAll(): Promise<Resource[]> {
  const results = await db.select().from(table);
  return removeNulls(
    await concurrentExecutor(
      results,
      async (r) => {
        const dependency = await loadDependency(r);
        if (!dependency) return null; // Silent fail
        return new Resource(r, dependency);
      },
      { concurrency: 8 }
    )
  );
}

// ❌ Wrong - don't throw in list methods
static async listAll(): Promise<Resource[]> {
  // ...
  if (!dependency) {
    throw new Error("Dependency not found"); // Don't do this
  }
}

// ✅ Correct - create takes resource directly
static async create(
  experiment: ExperimentResource,
  dependency: DependencyResource, // Pass resource, not ID
  data: { name: string }
): Promise<Resource> {
  const [created] = await db
    .insert(table)
    .values({
      ...data,
      experiment: experiment.toJSON().id,
      dependency: dependency.toJSON().id,
    })
    .returning();
  return new Resource(created, experiment, dependency);
}

// ❌ Wrong - don't take ID and look it up
static async create(
  experiment: ExperimentResource,
  dependencyId: number, // Don't do this
  data: { name: string }
): Promise<Resource | null> {
  const dependency = await DependencyResource.findById(dependencyId);
  if (!dependency) return null; // This adds unnecessary null checks
  // ...
}
```

### Result Types

- Use `Result<T>` types for operations that can fail in expected ways (validation, business logic)
- Don't use Result types for simple DB queries (use null instead)
- Resources generally return nulls when DB entities aren't found, not Result errors

## Key References

- For Docker implementation: See commit `878e0e9` (pre-Kubernetes migration)
- For simplified architecture: See `minified.md`
