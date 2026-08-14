CREATE TABLE `holding_positions` (
	`holding_id` text PRIMARY KEY NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`market` text DEFAULT 'kr' NOT NULL,
	`symbol` text DEFAULT '' NOT NULL,
	`current_value_krw` real,
	`benchmark` text DEFAULT 'kospi' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`holding_id`) REFERENCES `managed_holdings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_holding_positions_code` ON `holding_positions` (`code`);--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('time-nasdaq100-bond50', '0019K0', 'kr', '0019K0', 'nasdaq', '["nasdaq","bondMix","us"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('rise-samsung-hynix-bond50', '0162Z0', 'kr', '0162Z0', 'kospi', '["semi","bondMix","korea"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('kodex-kosdaq150', '229200', 'kr', '229200.KS', 'kosdaq', '["broad","growth","korea"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('kodex-200-us-treasury50', '284430', 'kr', '284430.KS', 'kospi', '["broad","bondMix","korea"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('kodex-top5-plus-tr', '315930', 'kr', '315930.KS', 'kospi', '["largeCap","semi","korea"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('rise-network-infra', '367760', 'kr', '367760.KS', 'kospi', '["network","aiInfra","korea"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('tiger-us-philadelphia-semi', '381180', 'kr', '381180.KS', 'sox', '["semi","us"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('hanaro-fn-k-semi', '395270', 'kr', '395270.KS', 'kospi', '["semi","korea"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('tiger-global-ai-cybersecurity', '418670', 'kr', '418670.KS', 'nasdaq', '["ai","cybersecurity","global"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('plus-global-hbm-semi', '442580', 'kr', '442580.KS', 'sox', '["semi","hbm","global"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('plus-k-defense', '449450', 'kr', '449450.KS', 'kospi', '["defense","korea"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('time-global-ai-active', '456600', 'kr', '456600.KS', 'nasdaq', '["ai","global"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('kodex-us-ai-power-infra', '487230', 'kr', '487230.KS', 'nasdaq', '["aiInfra","power","us"]');--> statement-breakpoint
INSERT OR IGNORE INTO `holding_positions` (`holding_id`, `code`, `market`, `symbol`, `benchmark`, `tags_json`) VALUES ('kodex-ai-power-equipment', '487240', 'kr', '487240.KS', 'kospi', '["aiInfra","power","korea"]');--> statement-breakpoint
PRAGMA optimize;
