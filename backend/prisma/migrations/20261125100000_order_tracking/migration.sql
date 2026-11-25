-- The tracking id staff give an order once it is confirmed, and who carries it. Both empty until then.
ALTER TABLE `orders`
  ADD COLUMN `trackingId` VARCHAR(40) NULL,
  ADD COLUMN `courier` VARCHAR(60) NULL;
