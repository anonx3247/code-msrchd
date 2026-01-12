CREATE TABLE `citations` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`from` integer NOT NULL,
	`to` integer NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `citations_from_to_experiment_unique` ON `citations` (`from`,`to`,`experiment`);--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`name` text NOT NULL,
	`problem` text NOT NULL,
	`profile` text DEFAULT 'research' NOT NULL,
	`model` text NOT NULL,
	`agent_count` integer DEFAULT 0 NOT NULL,
	`sandbox_mode` text DEFAULT 'docker' NOT NULL,
	`repository_url` text,
	`repository_path` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_name_unique` ON `experiments` (`name`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`agent` integer NOT NULL,
	`position` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_experiment_agent_position_unique` ON `messages` (`experiment`,`agent`,`position`);--> statement-breakpoint
CREATE TABLE `pr_reviews` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`pull_request` integer NOT NULL,
	`reviewer` integer NOT NULL,
	`decision` text,
	`content` text,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pr_reviews_idx_reviewer` ON `pr_reviews` (`reviewer`);--> statement-breakpoint
CREATE UNIQUE INDEX `pr_reviews_pull_request_reviewer_unique` ON `pr_reviews` (`pull_request`,`reviewer`);--> statement-breakpoint
CREATE TABLE `publications` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`author` integer NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`reference` text NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_experiment_reference_unique` ON `publications` (`experiment`,`reference`);--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`repository` integer NOT NULL,
	`number` integer NOT NULL,
	`author` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`source_branch` text NOT NULL,
	`target_branch` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repository`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `prs_idx_author` ON `pull_requests` (`author`);--> statement-breakpoint
CREATE INDEX `prs_idx_status` ON `pull_requests` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `pull_requests_experiment_repository_number_unique` ON `pull_requests` (`experiment`,`repository`,`number`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`path` text NOT NULL,
	`remote_url` text,
	`main_branch` text DEFAULT 'main' NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`publication` integer NOT NULL,
	`author` integer NOT NULL,
	`grade` text,
	`content` text,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`publication`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_author_publication_unique` ON `reviews` (`author`,`publication`);--> statement-breakpoint
CREATE TABLE `solutions` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`experiment` integer NOT NULL,
	`publication` integer NOT NULL,
	`agent` integer NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`publication`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `solutions_idx_experiment` ON `solutions` (`experiment`);--> statement-breakpoint
CREATE UNIQUE INDEX `solutions_experiment_agent_unique` ON `solutions` (`experiment`,`agent`);--> statement-breakpoint
CREATE TABLE `status_updates` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`experiment` integer NOT NULL,
	`agent` integer NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `status_updates_idx_agent` ON `status_updates` (`agent`);--> statement-breakpoint
CREATE INDEX `status_updates_idx_type` ON `status_updates` (`type`);