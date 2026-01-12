PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_solutions` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`experiment` integer NOT NULL,
	`pull_request` integer NOT NULL,
	`agent` integer NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_solutions`("id", "created", "experiment", "pull_request", "agent") SELECT "id", "created", "experiment", "pull_request", "agent" FROM `solutions`;--> statement-breakpoint
DROP TABLE `solutions`;--> statement-breakpoint
ALTER TABLE `__new_solutions` RENAME TO `solutions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `solutions_idx_experiment` ON `solutions` (`experiment`);--> statement-breakpoint
CREATE UNIQUE INDEX `solutions_experiment_agent_unique` ON `solutions` (`experiment`,`agent`);