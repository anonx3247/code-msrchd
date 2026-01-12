import { Hono } from "hono";
import sanitizeHtml from "sanitize-html";
import { marked } from "marked";
import fs from "fs";
import path from "path";
import { ExperimentResource } from "@app/resources/experiment";
import { MessageResource } from "@app/resources/messages";
import { SolutionResource } from "@app/resources/solutions";
import { PullRequestResource } from "@app/resources/pull_request";
import { RepositoryResource } from "@app/resources/repository";
import { StatusUpdateResource } from "@app/resources/status_update";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const sanitizeText = (value: unknown): string => {
  const input =
    value === null || value === undefined
      ? ""
      : typeof value === "number"
        ? value.toLocaleString()
        : String(value);
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    textFilter: (text: string) =>
      text.replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
  });
};

const sanitizeMarkdown = (value: unknown): string => {
  const input = value === null || value === undefined ? "" : String(value);
  try {
    const html = marked.parse(input, { async: false });
    return sanitizeHtml(html, {
      allowedTags: [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "br",
        "hr",
        "ul",
        "ol",
        "li",
        "strong",
        "em",
        "code",
        "pre",
        "a",
        "blockquote",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        // KaTeX tags
        "span",
        "div",
        "math",
        "semantics",
        "mrow",
        "mi",
        "mo",
        "mn",
        "msup",
        "msub",
        "mfrac",
        "msubsup",
        "mtext",
        "mspace",
        "msqrt",
        "mroot",
        "mover",
        "munder",
        "munderover",
        "mtable",
        "mtr",
        "mtd",
        "annotation",
        "svg",
        "line",
        "path",
        "g",
      ],
      allowedAttributes: {
        a: ["href"],
        code: ["class"],
        pre: ["class"],
        // KaTeX attributes
        span: ["class", "style", "aria-hidden"],
        div: ["class", "style"],
        math: ["xmlns"],
        annotation: ["encoding"],
        svg: [
          "xmlns",
          "width",
          "height",
          "viewBox",
          "preserveAspectRatio",
          "style",
        ],
        line: ["x1", "y1", "x2", "y2", "stroke-width"],
        path: ["d"],
        g: ["stroke", "fill", "stroke-width"],
      },
    });
  } catch (_err) {
    return sanitizeHtml(input, {
      allowedTags: [],
      allowedAttributes: {},
    });
  }
};

const safeStatusClass = (status: string): string => {
  const statusClasses: Record<string, string> = {
    PUBLISHED: "status-published",
    SUBMITTED: "status-submitted",
    REJECTED: "status-rejected",
  };
  return statusClasses[status] || "status-unknown";
};

const baseTemplate = (title: string, content: string): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sanitizeText(title)} - msrchd</title>
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js" crossorigin="anonymous"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" crossorigin="anonymous"></script>
  <script>
    document.addEventListener("DOMContentLoaded", function() {
      renderMathInElement(document.body, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '$', right: '$', display: false},
          {left: '\\\\[', right: '\\\\]', display: true},
          {left: '\\\\(', right: '\\\\)', display: false}
        ],
        throwOnError: false
      });
    });
  </script>
</head>
<body>
  <nav>
    <a href="/" class="nav-brand">msrchd</a>
    <a href="/">Experiments</a>
  </nav>
  ${content}
</body>
</html>`;
};

export const createApp = () => {
  const app = new Hono();

  // Serve static files (CSS)
  app.get("/styles.css", (c) => {
    const cssPath = path.join(__dirname, "styles.css");
    const css = fs.readFileSync(cssPath, "utf-8");
    return c.text(css, 200, { "Content-Type": "text/css" });
  });

  // Home page - List all experiments
  app.get("/", async (c) => {
    const experiments = (await ExperimentResource.all()).sort(
      (a, b) => b.toJSON().created.getTime() - a.toJSON().created.getTime(),
    );

    // Calculate costs and publications for all experiments
    const experimentsWithMetadata = await Promise.all(
      experiments.map(async (exp) => {
        const cost = await MessageResource.totalCostForExperiment(exp);
        const formattedCost =
          cost < 0.01
            ? `$${cost.toFixed(6)}`
            : cost < 1
              ? `$${cost.toFixed(4)}`
              : `$${cost.toFixed(2)}`;

        const allPRs = await PullRequestResource.listByExperiment(exp.toJSON().id);
        const solutions = await SolutionResource.listByExperiment(exp);

        // Count votes per PR
        const votesByPR = solutions.reduce(
          (acc, sol) => {
            const pr = sol.toJSON().pullRequest;
            if (pr) {
              acc[pr.id] = (acc[pr.id] || 0) + 1;
            }
            return acc;
          },
          {} as Record<number, number>,
        );

        const topVoted = Object.entries(votesByPR).sort(
          (a, b) => b[1] - a[1],
        )[0];

        return {
          exp,
          cost: formattedCost,
          prsCount: allPRs.length,
          votesCount: solutions.length,
          topVoted: topVoted ? `${topVoted[1]} votes` : "No votes",
        };
      }),
    );

    const content =
      experimentsWithMetadata.length > 0
        ? `
      <h1>Experiments</h1>
      ${experimentsWithMetadata
        .map(({ exp, cost, prsCount, votesCount, topVoted }) => {
          const data = exp.toJSON();
          return `
          <div class="list-item">
            <div class="list-item-title">
              <a href="/experiments/${sanitizeText(data.name)}">${sanitizeText(data.name)}</a>
            </div>
            <div class="list-item-meta">
              Model: <strong>${sanitizeText(data.model)}</strong> |
              Agents: <strong>${sanitizeText(data.agent_count)}</strong> |
              Cost: <strong>${sanitizeText(cost)}</strong> |
              Pull Requests: <strong>${prsCount}</strong> |
              Votes: <strong>${votesCount}</strong> |
              Top: <strong>${sanitizeText(topVoted)}</strong>
            </div>
          </div>
        `;
        })
        .join("")}
    `
        : `
      <h1>Experiments</h1>
      <div class="empty-state">No experiments yet. Run <code>srchd run</code> to create one.</div>
    `;

    return c.html(baseTemplate("Experiments", content));
  });

  // Experiment overview
  app.get("/experiments/:name", async (c) => {
    const name = c.req.param("name");

    const experimentRes = await ExperimentResource.findByName(name);
    if (experimentRes.isErr()) {
      return c.notFound();
    }

    const experiment = experimentRes.value;
    const expData = experiment.toJSON();

    const solutions = await SolutionResource.listByExperiment(experiment);
    const cost = await MessageResource.totalCostForExperiment(experiment);
    const formattedCost =
      cost < 0.01
        ? `$${cost.toFixed(6)}`
        : cost < 1
          ? `$${cost.toFixed(4)}`
          : `$${cost.toFixed(2)}`;

    // Get PR statistics
    const allPRs = await PullRequestResource.listByExperiment(expData.id);
    const openPRs = allPRs.filter(pr => pr.status === "open");
    const mergedPRs = allPRs.filter(pr => pr.status === "merged");
    const closedPRs = allPRs.filter(pr => pr.status === "closed");

    // Count votes per PR
    const votesByPR = solutions.reduce(
      (acc, sol) => {
        const pr = sol.toJSON().pullRequest;
        if (pr) {
          acc[pr.id] = (acc[pr.id] || 0) + 1;
        }
        return acc;
      },
      {} as Record<number, number>,
    );

    const sortedVotes = Object.entries(votesByPR)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const votesContent =
      sortedVotes.length > 0
        ? sortedVotes
            .map(([prId, votes]) => {
              const pr = allPRs.find(
                (p) => p.toJSON().id === parseInt(prId),
              );
              if (!pr) return "";
              const prData = pr.toJSON();
              return `
            <div class="vote-item">
              <a href="/experiments/${sanitizeText(name)}/pulls/${prData.number}">
                PR #${prData.number}: ${sanitizeText(prData.title)}
              </a>
              - <strong>${votes} vote${votes > 1 ? "s" : ""}</strong>
            </div>
          `;
            })
            .join("")
        : "<div class='empty-state'>No votes yet</div>";

    const prsContent =
      allPRs.length > 0
        ? allPRs
            .sort(
              (a, b) =>
                b.toJSON().created.getTime() - a.toJSON().created.getTime(),
            )
            .slice(0, 10)
            .map((pr) => {
              const prData = pr.toJSON();
              const votes = votesByPR[prData.id] || 0;
              return `
        <div class="list-item">
          <div class="list-item-title">
            <a href="/experiments/${sanitizeText(name)}/pulls/${prData.number}">
              PR #${prData.number}: ${sanitizeText(prData.title)}
            </a>
          </div>
          <div class="list-item-meta">
            <span class="${safeStatusClass(prData.status)}">${sanitizeText(prData.status)}</span> |
            Author: <strong>Agent ${sanitizeText(prData.author)}</strong> |
            Branch: <strong>${sanitizeText(prData.source_branch)}</strong> |
            Votes: <strong>${votes}</strong>
          </div>
        </div>
      `;
            })
            .join("")
        : "<div class='empty-state'>No pull requests yet</div>";

    const content = `
      <a href="/" class="back-link">&larr; Back to Experiments</a>
      <h1>${sanitizeText(expData.name)}</h1>

      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${sanitizeText(expData.agent_count)}</div>
          <div class="stat-label">Agents</div>
        </div>
        <div class="stat-item">
          <div class="stat-value"><a href="/experiments/${sanitizeText(name)}/pulls">${openPRs.length} open</a></div>
          <div class="stat-label">Open PRs</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${mergedPRs.length}</div>
          <div class="stat-label">Merged PRs</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${solutions.length}</div>
          <div class="stat-label">Votes</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${sanitizeText(formattedCost)}</div>
          <div class="stat-label">Total Cost</div>
        </div>
      </div>

      <div style="margin: 1rem 0;">
        <a href="/experiments/${sanitizeText(name)}/pulls" class="back-link">View All Pull Requests &rarr;</a>
        <span style="margin: 0 1rem;">|</span>
        <a href="/experiments/${sanitizeText(name)}/status" class="back-link">View Status Updates &rarr;</a>
      </div>

      <div class="detail-section">
        <div class="detail-label">Model</div>
        <div class="detail-value">${sanitizeText(expData.model)}</div>

        <div class="detail-label">Problem</div>
        <div class="detail-value markdown-content">${sanitizeMarkdown(expData.problem)}</div>
      </div>

      <h2>Top Voted Solutions</h2>
      <div class="detail-section">
        ${votesContent}
      </div>

      <h2>Recent Pull Requests</h2>
      ${prsContent}
      <div style="margin-top: 1rem;">
        <a href="/experiments/${sanitizeText(name)}/pulls" class="back-link">View all ${allPRs.length} pull requests &rarr;</a>
      </div>
    `;

    return c.html(
      baseTemplate(`${sanitizeText(expData.name)} - Experiment`, content),
    );
  });


  // PR list route
  app.get("/experiments/:name/pulls", async (c) => {
    const experimentName = c.req.param("name");

    const experimentRes = await ExperimentResource.findByName(experimentName);
    if (experimentRes.isErr()) {
      return c.notFound();
    }

    const experiment = experimentRes.value;
    const expData = experiment.toJSON();

    // Get all PRs
    const allPRs = await PullRequestResource.listByExperiment(expData.id);
    const openPRs = allPRs.filter(pr => pr.status === "open");
    const closedPRs = allPRs.filter(pr => pr.status === "closed");
    const mergedPRs = allPRs.filter(pr => pr.status === "merged");

    const renderPRList = (prs: PullRequestResource[], emptyMsg: string) => {
      if (prs.length === 0) {
        return `<p class="list-empty">${emptyMsg}</p>`;
      }
      return prs.map(pr => {
        const prData = pr.toJSON();
        return `
          <a href="/experiments/${sanitizeText(experimentName)}/pulls/${sanitizeText(prData.number)}" class="list-item">
            <div class="list-item-title">#${sanitizeText(prData.number)}: ${sanitizeText(prData.title)}</div>
            <div class="list-item-meta">
              <span class="${safeStatusClass(prData.status)}">${sanitizeText(prData.status)}</span>
              <span>Agent ${sanitizeText(prData.author)}</span>
              <span>${sanitizeText(prData.source_branch)} → ${sanitizeText(prData.target_branch)}</span>
              <span>${sanitizeText(prData.created.toLocaleString())}</span>
            </div>
          </a>
        `;
      }).join("");
    };

    const pageContent = `
      <a href="/experiments/${sanitizeText(experimentName)}" class="back-link">&larr; Back to ${sanitizeText(experimentName)}</a>
      <h1>Pull Requests</h1>

      <h2>Open (${openPRs.length})</h2>
      <div class="list">
        ${renderPRList(openPRs, "No open pull requests")}
      </div>

      <h2>Merged (${mergedPRs.length})</h2>
      <div class="list">
        ${renderPRList(mergedPRs, "No merged pull requests")}
      </div>

      <h2>Closed (${closedPRs.length})</h2>
      <div class="list">
        ${renderPRList(closedPRs, "No closed pull requests")}
      </div>
    `;

    return c.html(
      baseTemplate(`Pull Requests - ${sanitizeText(experimentName)}`, pageContent),
    );
  });

  // PR detail route
  app.get("/experiments/:name/pulls/:number", async (c) => {
    const experimentName = c.req.param("name");
    const prNumber = parseInt(c.req.param("number"), 10);

    const experimentRes = await ExperimentResource.findByName(experimentName);
    if (experimentRes.isErr()) {
      return c.notFound();
    }

    const experiment = experimentRes.value;
    const expData = experiment.toJSON();

    const prResult = await PullRequestResource.findByNumber(expData.id, prNumber);
    if (prResult.isErr()) {
      return c.notFound();
    }

    const pr = prResult.value;
    const prData = pr.toJSON();

    // Get reviews
    const reviews = await pr.getReviews();
    const approvalCount = await pr.getApprovalCount();

    // Get repository info to run git diff
    const repoResult = await RepositoryResource.findByExperiment(expData.id);
    let diffContent = "";
    if (repoResult.isOk()) {
      const repo = repoResult.value;
      try {
        const { stdout } = await execAsync(
          `git -C "${repo.path}" diff ${prData.target_branch}..${prData.source_branch} --stat`,
        );
        diffContent = stdout;
      } catch (err) {
        diffContent = "Unable to generate diff";
      }
    }

    // Get votes for this PR
    const solutions = await SolutionResource.listByExperiment(experiment);
    const votes = solutions.filter(
      (sol) => {
        const pr = sol.toJSON().pullRequest;
        return pr && pr.id === prData.id;
      },
    ).length;

    const reviewsContent =
      reviews.length > 0
        ? `
      <h2>Reviews (${approvalCount} approved)</h2>
      ${reviews
        .map(
          (review) => `
        <div class="detail-section">
          <div class="detail-label">Agent ${sanitizeText(review.reviewer)}</div>
          <div class="detail-value">
            <span class="${review.decision === "approve" ? "status-published" : review.decision === "request_changes" ? "status-rejected" : "status-submitted"}">${sanitizeText(review.decision ?? "PENDING")}</span>
          </div>
          ${review.content ? `
          <div class="detail-label">Comments</div>
          <div class="detail-value markdown-content">${sanitizeMarkdown(review.content)}</div>
          ` : ""}
        </div>
      `,
        )
        .join("")}
    `
        : "<h2>Reviews</h2><p>No reviews yet</p>";

    const pageContent = `
      <a href="/experiments/${sanitizeText(experimentName)}/pulls" class="back-link">&larr; Back to PRs</a>
      <h1>PR #${sanitizeText(prData.number)}: ${sanitizeText(prData.title)}</h1>
      <div class="pub-meta">
        <span class="${safeStatusClass(prData.status)}">${sanitizeText(prData.status)}</span>
        <span>Agent ${sanitizeText(prData.author)}</span>
        <span>${sanitizeText(prData.source_branch)} → ${sanitizeText(prData.target_branch)}</span>
        <span>${votes} vote${votes !== 1 ? "s" : ""}</span>
        <span>${sanitizeText(prData.created.toLocaleString())}</span>
      </div>

      <div class="detail-section">
        <div class="detail-label">Description</div>
        <div class="detail-value markdown-content">${sanitizeMarkdown(prData.description)}</div>
      </div>

      <div class="detail-section">
        <div class="detail-label">Changes</div>
        <div class="detail-value">
          <pre style="background: #f5f5f5; padding: 1em; overflow-x: auto;">${sanitizeText(diffContent)}</pre>
          <a href="/experiments/${sanitizeText(experimentName)}/pulls/${sanitizeText(prData.number)}/diff" class="back-link">View full diff &rarr;</a>
        </div>
      </div>

      ${reviewsContent}
    `;

    return c.html(
      baseTemplate(`PR #${sanitizeText(prData.number)} - ${sanitizeText(experimentName)}`, pageContent),
    );
  });

  // PR full diff route
  app.get("/experiments/:name/pulls/:number/diff", async (c) => {
    const experimentName = c.req.param("name");
    const prNumber = parseInt(c.req.param("number"), 10);

    const experimentRes = await ExperimentResource.findByName(experimentName);
    if (experimentRes.isErr()) {
      return c.notFound();
    }

    const experiment = experimentRes.value;
    const expData = experiment.toJSON();

    const prResult = await PullRequestResource.findByNumber(expData.id, prNumber);
    if (prResult.isErr()) {
      return c.notFound();
    }

    const pr = prResult.value;
    const prData = pr.toJSON();

    // Get repository and generate full diff
    const repoResult = await RepositoryResource.findByExperiment(expData.id);
    let diffContent = "";
    if (repoResult.isOk()) {
      const repo = repoResult.value;
      try {
        const { stdout } = await execAsync(
          `git -C "${repo.path}" diff ${prData.target_branch}..${prData.source_branch}`,
        );
        diffContent = stdout || "No changes";
      } catch (err) {
        diffContent = `Error generating diff: ${err}`;
      }
    } else {
      diffContent = "Repository not found";
    }

    const pageContent = `
      <a href="/experiments/${sanitizeText(experimentName)}/pulls/${sanitizeText(prData.number)}" class="back-link">&larr; Back to PR #${sanitizeText(prData.number)}</a>
      <h1>Diff: ${sanitizeText(prData.source_branch)} → ${sanitizeText(prData.target_branch)}</h1>

      <div class="detail-section">
        <pre style="background: #f5f5f5; padding: 1em; overflow-x: auto; max-height: 80vh;">${sanitizeText(diffContent)}</pre>
      </div>
    `;

    return c.html(
      baseTemplate(`Diff - PR #${sanitizeText(prData.number)}`, pageContent),
    );
  });

  // Status updates route
  app.get("/experiments/:name/status", async (c) => {
    const experimentName = c.req.param("name");

    const experimentRes = await ExperimentResource.findByName(experimentName);
    if (experimentRes.isErr()) {
      return c.notFound();
    }

    const experiment = experimentRes.value;
    const expData = experiment.toJSON();

    const statusUpdates = await StatusUpdateResource.listByExperiment(expData.id);

    const statusContent = statusUpdates.length > 0
      ? statusUpdates.map(su => {
          const suData = su.toJSON();
          return `
            <div class="detail-section">
              <div class="detail-label">Agent ${sanitizeText(suData.agent)} - ${sanitizeText(suData.type)}</div>
              <div class="detail-value">${sanitizeText(suData.created.toLocaleString())}</div>
              <div class="detail-value markdown-content">${sanitizeMarkdown(suData.content)}</div>
            </div>
          `;
        }).join("")
      : "<p>No status updates yet</p>";

    const pageContent = `
      <a href="/experiments/${sanitizeText(experimentName)}" class="back-link">&larr; Back to ${sanitizeText(experimentName)}</a>
      <h1>Status Updates</h1>
      ${statusContent}
    `;

    return c.html(
      baseTemplate(`Status - ${sanitizeText(experimentName)}`, pageContent),
    );
  });

  return app;
};

export default createApp();
