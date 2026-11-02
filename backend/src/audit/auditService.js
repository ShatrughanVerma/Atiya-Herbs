// The security trail: who logged in, from where, token reuse, profile changes.
// A failure to write the trail is logged but never breaks the request itself.

// Whatever a caller passes, anything that looks like a secret is dropped before it reaches the database
const SENSITIVE_KEY = /otp|code|token|password|secret|authorization/i;

function redactMetadata(metadata) {
  if (!metadata) {
    return null;
  }
  const clean = Object.fromEntries(Object.entries(metadata).filter(([key]) => !SENSITIVE_KEY.test(key)));
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

function createAuditService({prisma, logger = console}) {
  return {
    // entry: {action, userId?, ip?, userAgent?, metadata?}
    async record(entry) {
      try {
        await prisma.auditLog.create({
          data: {
            action: entry.action.slice(0, 64),
            userId: entry.userId ?? null,
            ip: entry.ip?.slice(0, 64) ?? null,
            userAgent: entry.userAgent?.slice(0, 255) ?? null,
            metadata: redactMetadata(entry.metadata),
          },
        });
      } catch (error) {
        logger.error(`Could not write audit log "${entry.action}": ${error.message}`);
      }
    },
  };
}

module.exports = {createAuditService, redactMetadata};
