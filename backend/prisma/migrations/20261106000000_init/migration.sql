-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `mobile` VARCHAR(15) NOT NULL,
    `name` VARCHAR(100) NULL,
    `email` VARCHAR(254) NULL,
    `role` ENUM('customer', 'doctor', 'distributor', 'moderator', 'admin') NOT NULL DEFAULT 'customer',
    `status` ENUM('active', 'blocked') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastLoginAt` DATETIME(3) NULL,

    UNIQUE INDEX `users_mobile_key`(`mobile`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `otp_challenges` (
    `id` CHAR(36) NOT NULL,
    `mobile` VARCHAR(15) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `requestIp` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `otp_challenges_mobile_createdAt_idx`(`mobile`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `userAgent` VARCHAR(255) NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `refresh_tokens_userId_idx`(`userId`),
    INDEX `refresh_tokens_familyId_idx`(`familyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` CHAR(36) NULL,
    `action` VARCHAR(64) NOT NULL,
    `ip` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `metadata` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `audit_logs_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `icon` VARCHAR(64) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `concerns` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `icon` VARCHAR(64) NOT NULL,
    `tint` VARCHAR(16) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `categoryId` VARCHAR(64) NOT NULL,
    `price` INTEGER NOT NULL,
    `mrp` INTEGER NOT NULL,
    `stock` INTEGER NOT NULL DEFAULT 0,
    `images` JSON NOT NULL,
    `description` TEXT NOT NULL,
    `benefits` JSON NULL,
    `howToUse` TEXT NULL,
    `ingredients` TEXT NULL,
    `size` VARCHAR(60) NULL,
    `badge` VARCHAR(40) NULL,
    `bestseller` BOOLEAN NOT NULL DEFAULT false,
    `rating` DOUBLE NOT NULL DEFAULT 0,
    `reviewCount` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `products_categoryId_active_idx`(`categoryId`, `active`),
    INDEX `products_active_bestseller_idx`(`active`, `bestseller`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_concerns` (
    `productId` VARCHAR(64) NOT NULL,
    `concernId` VARCHAR(64) NOT NULL,

    INDEX `product_concerns_concernId_idx`(`concernId`),
    PRIMARY KEY (`productId`, `concernId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `banners` (
    `id` CHAR(36) NOT NULL,
    `badge` VARCHAR(60) NULL,
    `title` VARCHAR(150) NOT NULL,
    `image` VARCHAR(500) NOT NULL,
    `gradient` VARCHAR(200) NULL,
    `concernId` VARCHAR(64) NULL,
    `categoryId` VARCHAR(64) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupons` (
    `code` VARCHAR(32) NOT NULL,
    `percent` INTEGER NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `minSubtotal` INTEGER NOT NULL DEFAULT 0,
    `maxDiscount` INTEGER NULL,
    `expiresAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `addresses` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(10) NOT NULL,
    `pincode` VARCHAR(6) NOT NULL,
    `city` VARCHAR(80) NOT NULL,
    `state` VARCHAR(80) NOT NULL,
    `line1` VARCHAR(200) NOT NULL,
    `line2` VARCHAR(200) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `addresses_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` CHAR(36) NOT NULL,
    `orderNumber` VARCHAR(24) NOT NULL,
    `userId` CHAR(36) NULL,
    `status` ENUM('placed', 'confirmed', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'placed',
    `paymentMethod` ENUM('cod') NOT NULL DEFAULT 'cod',
    `subtotal` INTEGER NOT NULL,
    `discount` INTEGER NOT NULL DEFAULT 0,
    `shippingFee` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL,
    `couponCode` VARCHAR(32) NULL,
    `shippingAddress` JSON NOT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_orderNumber_key`(`orderNumber`),
    INDEX `orders_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `orders_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_items` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `productId` VARCHAR(64) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `image` VARCHAR(500) NULL,
    `price` INTEGER NOT NULL,
    `qty` INTEGER NOT NULL,

    INDEX `order_items_orderId_idx`(`orderId`),
    INDEX `order_items_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `call_logs` (
    `id` CHAR(36) NOT NULL,
    `externalId` VARCHAR(64) NULL,
    `kind` ENUM('voice', 'video', 'conference', 'meeting') NOT NULL,
    `callerMobile` VARCHAR(15) NOT NULL,
    `calleeMobile` VARCHAR(15) NULL,
    `meetingId` VARCHAR(32) NULL,
    `title` VARCHAR(120) NULL,
    `outcome` VARCHAR(20) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,
    `durationSec` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `call_logs_externalId_key`(`externalId`),
    INDEX `call_logs_callerMobile_startedAt_idx`(`callerMobile`, `startedAt`),
    INDEX `call_logs_calleeMobile_startedAt_idx`(`calleeMobile`, `startedAt`),
    INDEX `call_logs_meetingId_idx`(`meetingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meeting_messages` (
    `id` CHAR(36) NOT NULL,
    `externalId` VARCHAR(64) NULL,
    `meetingId` VARCHAR(32) NOT NULL,
    `fromMobile` VARCHAR(15) NOT NULL,
    `fromName` VARCHAR(100) NOT NULL,
    `toMobile` VARCHAR(15) NULL,
    `text` VARCHAR(1000) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `meeting_messages_externalId_key`(`externalId`),
    INDEX `meeting_messages_meetingId_sentAt_idx`(`meetingId`, `sentAt`),
    INDEX `meeting_messages_fromMobile_idx`(`fromMobile`),
    INDEX `meeting_messages_toMobile_idx`(`toMobile`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_concerns` ADD CONSTRAINT `product_concerns_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_concerns` ADD CONSTRAINT `product_concerns_concernId_fkey` FOREIGN KEY (`concernId`) REFERENCES `concerns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `addresses` ADD CONSTRAINT `addresses_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

