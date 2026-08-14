CREATE TABLE `holding_store_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `managed_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_managed_holdings_name` ON `managed_holdings` (`name`);--> statement-breakpoint
CREATE INDEX `idx_managed_holdings_sort_order` ON `managed_holdings` (`sort_order`);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('time-nasdaq100-bond50', 'TIME 미국나스닥100채권혼합50액티브', 1);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('rise-samsung-hynix-bond50', 'RISE 삼성전자SK하이닉스채권혼합50', 2);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('kodex-kosdaq150', 'KODEX 코스닥150', 3);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('kodex-200-us-treasury50', 'KODEX 200미국채혼합50', 4);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('kodex-top5-plus-tr', 'KODEX Top5 PlusTR', 5);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('rise-network-infra', 'RISE 네트워크인프라', 6);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('tiger-us-philadelphia-semi', 'TIGER 미국필라델피아반도체나스닥', 7);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('hanaro-fn-k-semi', 'HANARO Fn K-반도체', 8);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('tiger-global-ai-cybersecurity', 'TIGER 글로벌AI사이버보안', 9);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('plus-global-hbm-semi', 'PLUS 글로벌HBM반도체', 10);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('plus-k-defense', 'PLUS K방산', 11);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('time-global-ai-active', 'TIME 글로벌AI인공지능액티브', 12);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('kodex-us-ai-power-infra', 'KODEX 미국AI전력핵심인프라', 13);--> statement-breakpoint
INSERT OR IGNORE INTO `managed_holdings` (`id`, `name`, `sort_order`) VALUES ('kodex-ai-power-equipment', 'KODEX AI전력핵심설비', 14);--> statement-breakpoint
INSERT OR REPLACE INTO `holding_store_meta` (`key`, `value`) VALUES ('managed_holdings_seed_version', '1');--> statement-breakpoint
PRAGMA optimize;
