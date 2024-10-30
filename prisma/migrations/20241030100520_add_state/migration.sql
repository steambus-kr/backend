-- CreateTable
CREATE TABLE `State` (
    `id` INTEGER NOT NULL,
    `last_fetched_info` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
