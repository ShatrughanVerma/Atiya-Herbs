-- users.role (name) becomes users.role_id: the designation id from the view VW_EmpDesignationMaster.
ALTER TABLE `users` ADD COLUMN `role_id` INTEGER NOT NULL DEFAULT 14;

UPDATE `users` SET `role_id` = CASE `role`
  WHEN 'admin' THEN 1
  WHEN 'doctor' THEN 12
  WHEN 'customer' THEN 14
  WHEN 'distributor' THEN 15
  WHEN 'moderator' THEN 16
  ELSE 14
END;

ALTER TABLE `users` DROP COLUMN `role`;
CREATE INDEX `users_role_id_idx` ON `users`(`role_id`);
