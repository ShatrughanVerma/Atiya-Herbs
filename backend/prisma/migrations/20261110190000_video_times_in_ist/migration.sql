-- consultationDateTime and createdOn of a video are now written as India time (IST = UTC + 5:30).
-- The rows written so far hold UTC: move them by 5 hours 30 minutes.
UPDATE `consult_videos`
   SET `createdOn` = DATE_ADD(`createdOn`, INTERVAL 330 MINUTE),
       `consultationDateTime` = DATE_ADD(`consultationDateTime`, INTERVAL 330 MINUTE);
