-- CreateTable
CREATE TABLE `State` (
    `id` INTEGER NOT NULL,
    `last_fetched_info` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Game` (
    `app_id` INTEGER NOT NULL,
    `title` TINYTEXT NOT NULL,
    `description` TEXT NOT NULL,
    `owner_count` INTEGER NOT NULL,
    `release_date` VARCHAR(191) NOT NULL,
    `thumbnail_src` VARCHAR(191) NOT NULL,
    `review_positive` INTEGER NOT NULL,
    `review_negative` INTEGER NOT NULL,

    PRIMARY KEY (`app_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlayerCount` (
    `app_id` INTEGER NOT NULL,
    `count` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,

    PRIMARY KEY (`app_id`, `date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Genre` (
    `genre_name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`genre_name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_GameToGenre` (
    `A` INTEGER NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_GameToGenre_AB_unique`(`A`, `B`),
    INDEX `_GameToGenre_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PlayerCount` ADD CONSTRAINT `PlayerCount_app_id_fkey` FOREIGN KEY (`app_id`) REFERENCES `Game`(`app_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_GameToGenre` ADD CONSTRAINT `_GameToGenre_A_fkey` FOREIGN KEY (`A`) REFERENCES `Game`(`app_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_GameToGenre` ADD CONSTRAINT `_GameToGenre_B_fkey` FOREIGN KEY (`B`) REFERENCES `Genre`(`genre_name`) ON DELETE CASCADE ON UPDATE CASCADE;
