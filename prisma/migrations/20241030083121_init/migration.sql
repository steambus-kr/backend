-- CreateTable
CREATE TABLE `Game` (
    `app_id` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `owner_count` INTEGER NOT NULL,
    `release_date` DATETIME(3) NOT NULL,
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
CREATE TABLE `Game__Genre` (
    `genre_id` INTEGER NOT NULL,
    `app_id` INTEGER NOT NULL,

    PRIMARY KEY (`genre_id`, `app_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Genre` (
    `genre_id` INTEGER NOT NULL,
    `genre_name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`genre_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PlayerCount` ADD CONSTRAINT `PlayerCount_app_id_fkey` FOREIGN KEY (`app_id`) REFERENCES `Game`(`app_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Game__Genre` ADD CONSTRAINT `Game__Genre_genre_id_fkey` FOREIGN KEY (`genre_id`) REFERENCES `Genre`(`genre_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Game__Genre` ADD CONSTRAINT `Game__Genre_app_id_fkey` FOREIGN KEY (`app_id`) REFERENCES `Game`(`app_id`) ON DELETE CASCADE ON UPDATE CASCADE;
