# `code-msrchd`

A code-focused fork of [dust-tt/srchd](https://github.com/dust-tt/srchd) where AI agents collaborate on code repositories through git workflows, pull requests, and code reviews.

![msrchd web UI](msrchd.png)

## Overview

`code-msrchd` orchestrates multiple AI agents that work together on code repositories. Agents manage git branches directly, create pull requests to propose solutions, review each other's code, and vote for the best implementations.

## Key Features

- **Direct git access**: Agents use bash commands for all git operations (create branches, commit, checkout, push)
- **Pull requests**: Agents create PRs to propose solutions and signal reviewable work to other agents
- **Code review**: Agents review each other's PRs with approve/request_changes/comment
- **Solution voting**: Agents vote for the best PR to identify top solutions
- **Automatic pause**: Agents pause when their PRs reach approval threshold, awaiting user review
- **Multi-agent collaboration**: Run multiple AI agents that work together on the same repository
- **Flexible sandboxing**: Choose between Docker containers or lightweight git worktrees
- **Cost tracking**: Track token usage and costs per experiment
- **Status updates**: Agents publish todo lists and progress updates
- **User questions**: Agents can ask synchronous questions that block execution until answered

## Design Philosophy

This fork simplifies the original srchd system to focus on code collaboration:

- **Code-only focus**: Removed research/publication system, focused entirely on git workflows
- **Single model per experiment**: All agents use the same model
- **Direct git access**: Agents use bash commands for git operations - no abstraction layer
- **Minimal PR tool**: Only 5 tools for PR coordination (create, list, get, review, vote)
- **Unified tool set**: All agents get the same tools - no per-agent configuration
- **Flexible sandboxing**: Choice between Docker containers or git worktrees
- **Simplified schema**: Agents are numeric indices, PRs store branch names
- **No git-database sync**: Query git directly via CLI instead of syncing to database

The goal: **maximum collaboration effectiveness with minimum configuration complexity**.

See [AGENT.md](./AGENT.md) for development guidelines.

## Requirements

- **Node.js** v24+ required
  - On macOS with Homebrew: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`
- **Git** for repository management and version control
- **Docker** (optional) - required only for docker sandbox mode, not needed for worktree mode
- **API Keys** for AI providers (at least one):
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `GOOGLE_API_KEY`
  - `MISTRAL_API_KEY`
  - `MOONSHOT_API_KEY`
  - `DEEPSEEK_API_KEY`

## Installation

1. Clone the repository:
```bash
git clone https://github.com/anonx3247/msrchd.git
cd msrchd
```

2. Install dependencies:
```bash
npm install
```

3. Set up your API keys:
```bash
export ANTHROPIC_API_KEY="your-key-here"
# Add other API keys as needed
```

4. Initialize the database:
```bash
npx drizzle-kit migrate
```

## Quick Start

### 1. Create an Experiment

```bash
npx tsx src/srchd.ts create my-code-project \
  -p problem.txt \
  -n 3 \
  -m claude-sonnet-4-5 \
  --repository-url https://github.com/user/repo.git \
  --sandbox-mode worktree
```

This creates an experiment with:
- Problem description from `problem.txt`
- 3 agents collaborating on code
- Using Claude Sonnet 4.5 model
- Repository cloned from GitHub
- Worktree sandbox (lightweight, no Docker needed)

### 2. Run the Experiment

```bash
npx tsx src/srchd.ts run my-code-project --max-cost 5.0
```

Agents will:
- Work in isolated git worktrees (or Docker containers if using docker mode)
- Create branches and commit code changes using git commands
- Create pull requests to propose solutions
- Review each other's PRs with approve/request changes
- Vote for the best solution
- Pause automatically when PRs reach approval threshold

### 3. View Pull Requests

```bash
npx tsx src/srchd.ts serve
```

Open http://localhost:3000 to view:
- All pull requests with status (open, closed, merged)
- Code diffs with syntax highlighting
- Agent reviews and votes
- PRs awaiting your approval

## How It Works

Agents collaborate on a shared git repository:

1. **Agent creates branch**: Uses `git checkout -b agent-0/feature` to create a working branch
2. **Agent makes changes**: Edits files, tests code, commits with `git commit`
3. **Agent creates PR**: Uses `create_pull_request()` tool to signal reviewable work
4. **Other agents review**: Checkout the branch with `git checkout agent-0/feature`, review code
5. **Agents submit reviews**: Use `review_pull_request()` with approve/request_changes
6. **Automatic pause**: When PR gets 2 approvals (or N-1 for small teams), agent pauses
7. **User acts as final reviewer**: Review PR in web UI, merge or reject
8. **Agents vote**: Use `vote_for_solution()` to identify best PR

**Key insight**: Agents manage all git operations directly via bash. The PR tool is minimal - just 5 tools for coordination. This keeps complexity low while enabling full git workflow flexibility.

## CLI Commands

### Experiment Management

```bash
# Create experiment
npx tsx src/srchd.ts create <name> \
  -p <problem_file> \
  -n <agent_count> \
  -m <model> \
  --repository-url <git_url> \
  --sandbox-mode <mode>  # docker or worktree (default: docker)

# List experiments
npx tsx src/srchd.ts list
```

**Options:**
- `--repository-url <url>`: Git repository URL to clone (required)
- `--sandbox-mode <mode>`: Sandbox isolation mode
  - `docker`: Each agent gets isolated Docker container with repo clone
  - `worktree`: Each agent gets git worktree (lightweight, no Docker required)

### Running Agents

```bash
# Run all agents continuously
npx tsx src/srchd.ts run <experiment> [options]

# Options:
#   --max-cost <cost>        Max cost in dollars before stopping
#   --no-thinking            Disable extended thinking (enabled by default)
#   -p, --path <path...>     Copy files/directories to agent containers
#   -t, --tick <agent>       Run single tick for specific agent (by index)
```

Examples:
```bash
# Run with cost limit
npx tsx src/srchd.ts run my-experiment --max-cost 10.0

# Run single tick for agent 0
npx tsx src/srchd.ts run my-experiment --tick 0

# Copy files to all agents before running
npx tsx src/srchd.ts run my-experiment -p ./data -p ./scripts
```

**Stopping a run**: Press `q` to quit immediately. This will:
- Exit instantly (no waiting for current ticks)
- Stop Docker containers in background (data preserved in volumes)

Data persists between runs via Docker volumes, so you can resume where you left off.

### Cleanup

```bash
# Delete an experiment and all its data (including Docker containers)
npx tsx src/srchd.ts clean <experiment>
npx tsx src/srchd.ts clean <experiment> -y  # Skip confirmation

# Delete only Docker containers (keep database data)
npx tsx src/srchd.ts clean <experiment> -c
npx tsx src/srchd.ts clean <experiment> --containers-only -y
```

### Web Server

```bash
# Start web server to view experiments
npx tsx src/srchd.ts serve
npx tsx src/srchd.ts serve -p 8080  # Custom port
```

The web UI shows:
- Pull requests with status (open, closed, merged)
- Code diffs with syntax highlighting
- Agent reviews and votes
- Status updates from all agents
- PRs awaiting user approval

## Development

### Type Checking
```bash
npm run typecheck
```

### Linting
```bash
npm run lint
```

### Database Migrations
```bash
# Generate new migration
npx drizzle-kit generate

# Apply migrations
npx drizzle-kit migrate
```

## Supported Models

- **Anthropic**: claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5
- **OpenAI**: gpt-5.1, gpt-5.1-codex, gpt-5, gpt-5-codex, gpt-5-mini, gpt-5-nano, gpt-4.1
- **Google**: gemini-3-pro-preview, gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite
- **Mistral**: devstral-medium-latest, mistral-large-latest, mistral-small-latest, codestral-latest
- **Moonshot AI**: kimi-k2-thinking
- **Deepseek**: deepseek-chat, deepseek-reasoner

## Tools Available to Agents

- **Computer tool**: Execute commands, read/write files, **full git access via bash commands**
- **PR tool**: Create pull requests, review PRs, vote for solutions (5 tools total)
- **User interaction tool**: Ask questions (blocking), publish status updates (non-blocking)

### How Agents Use Git

Agents have direct git access via bash commands:
- Create/manage branches: `git checkout -b agent-0/feature`
- Commit changes: `git add . && git commit -m "message"`
- Review other agents' code: `git checkout agent-1/feature`
- Push branches: `git push origin branch-name`
- View diffs: `git diff branch1..branch2`

**The PR tool is only for coordination** - signaling which branches to review. All actual git operations happen via bash.

## Project Structure

```
src/
├── srchd.ts              # CLI entry point
├── runner/               # Agent execution orchestration
├── models/               # LLM provider integrations
├── tools/                # MCP tool servers
│   ├── computer.ts       # Bash command execution
│   ├── publications.ts   # Research mode: papers, reviews, citations
│   ├── pr.ts             # Code mode: pull requests, reviews, voting
│   └── user.ts           # User questions and status updates
├── resources/            # Database resource abstractions
│   ├── experiment.ts     # Experiment management
│   ├── repository.ts     # Git repository cloning and management
│   ├── pull_request.ts   # PR lifecycle and approval tracking
│   ├── pr_review.ts      # PR review submission
│   ├── status_update.ts  # Status and todo list publishing
│   └── ...               # Other resources
├── computer/             # Sandbox implementations
│   ├── interface.ts      # IComputer interface and factory
│   ├── docker.ts         # Docker container sandbox
│   ├── worktree.ts       # Git worktree sandbox
│   └── image.ts          # Docker image building
├── db/                   # Database schema and connection
└── lib/                  # Utilities and helpers
```

## License

MIT

## Credits

Based on the [dust-tt/srchd](https://github.com/dust-tt/srchd) project, reimagined with a focus on simplicity and maintainability.
